import { access } from 'node:fs/promises';
import { NORMALIZER_VERSION } from '@who-ruined/parser-adapter';
import {
  participationRatingReportSchema,
  participationSidecarSchema,
  participationSidecarSchemaVersion,
  type MatchArtifact,
  type ParticipationRatingReport,
  type ParticipationSidecar
} from '@who-ruined/contracts';
import {
  assertParticipationSidecarBinding,
  assertParticipationSidecarFingerprint,
  canonicalJson,
  parseParticipationSidecar,
  participationSidecarRelativePath as artifactParticipationSidecarRelativePath,
  sha256Canonical,
} from '@who-ruined/artifacts';
import {
  buildActiveParticipationRating,
  H2_PARTICIPATION_RATING_POLICY,
  PARTICIPATION_FAMILY_POLICY_DIGEST,
  PARTICIPATION_MODEL_VERSION,
  PARTICIPATION_SIDECAR_POLICY_IDENTITIES,
  PARTICIPATION_REFERENCE_VERSION,
} from '@who-ruined/scoring';
import { ApplicationError } from './application/application-error.js';
import { safeDataPath } from './storage.js';
import { readBoundedGzipJson } from './bounded-gzip.js';

export function participationSidecarRelativePath(matchId: string, fileSha256: string): string {
  try {
    return artifactParticipationSidecarRelativePath(
      matchId,
      fileSha256,
      participationSidecarSchemaVersion,
      PARTICIPATION_FAMILY_POLICY_DIGEST,
    );
  } catch {
    throw new ApplicationError('PARTICIPATION_SIDECAR_STALE', 'Идентификатор prepared sidecar не соответствует матчу.', 409);
  }
}

function expectedPolicies(): Array<{ id: string; digest: string; harmMultiplier: number }> {
  return PARTICIPATION_SIDECAR_POLICY_IDENTITIES.map(({ id, digest, harmMultiplier }) => ({ id, digest, harmMultiplier }));
}

function validateFrozenIdentity(sidecar: ParticipationSidecar): void {
  if (sidecar.model.preparedInputModel !== PARTICIPATION_MODEL_VERSION || sidecar.model.preparedInputDigest !== PARTICIPATION_FAMILY_POLICY_DIGEST || sidecar.model.referenceVersion !== PARTICIPATION_REFERENCE_VERSION) {
    throw new ApplicationError('PARTICIPATION_SIDECAR_POLICY_MISMATCH', 'Prepared sidecar создан для другой версии входной модели или reference.', 409);
  }
  const actual = [...sidecar.model.policies].sort((left, right) => left.id.localeCompare(right.id));
  const expected = expectedPolicies().sort((left, right) => left.id.localeCompare(right.id));
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new ApplicationError(
      'PARTICIPATION_SIDECAR_POLICY_MISMATCH',
      'Prepared sidecar не содержит совместимые замороженные policy identities.',
      409
    );
  }
}

function validateFingerprint(sidecar: ParticipationSidecar): void {
  try {
    assertParticipationSidecarFingerprint(sidecar);
  } catch {
    throw new ApplicationError('PARTICIPATION_SIDECAR_FINGERPRINT_MISMATCH', 'Контрольная сумма prepared sidecar не совпадает с его содержимым.', 409);
  }
}

export async function readParticipationSidecarForApi(
  artifact: MatchArtifact,
  rawFilePath: string | null
): Promise<ParticipationSidecar> {
  const { match } = artifact;
  const relative = participationSidecarRelativePath(match.matchId, match.fileSha256);
  let decoded: unknown;
  try {
    decoded = await readBoundedGzipJson(relative);
  } catch (error) {
    if ((error as Error).message !== 'BOUNDED_GZIP_MISSING') throw new ApplicationError('PARTICIPATION_SIDECAR_INVALID', 'Prepared sidecar не удалось безопасно прочитать.', 409);
    if (!rawFilePath) throw new ApplicationError('PARTICIPATION_SIDECAR_UNAVAILABLE_REQUIRES_ORIGINAL_DEMO', 'Prepared sidecar отсутствует, а исходная демка недоступна.', 409);
    try {
      await access(safeDataPath(rawFilePath));
    } catch {
      throw new ApplicationError('PARTICIPATION_SIDECAR_UNAVAILABLE_REQUIRES_ORIGINAL_DEMO', 'Prepared sidecar отсутствует, а исходная демка недоступна.', 409);
    }
    throw new ApplicationError('PARTICIPATION_SIDECAR_BACKFILL_REQUIRED', 'Prepared sidecar отсутствует; запустите контролируемую backfill-команду для исходной демки.', 409);
  }

  if ((decoded as { schemaVersion?: unknown } | null)?.schemaVersion !== participationSidecarSchemaVersion) {
    throw new ApplicationError('PARTICIPATION_SIDECAR_SCHEMA_MISMATCH', 'Версия prepared sidecar не поддерживается этим endpoint.', 409);
  }
  let sidecar: ParticipationSidecar;
  try {
    sidecar = parseParticipationSidecar(decoded);
  } catch {
    const parsed = participationSidecarSchema.safeParse(decoded);
    throw new ApplicationError('PARTICIPATION_SIDECAR_INVALID', 'Prepared sidecar не соответствует типизированному контракту.', 409, {
      issues: parsed.success ? [] : parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code }))
    });
  }
  try {
    assertParticipationSidecarBinding(sidecar, {
      matchId: match.matchId,
      fileSha256: match.fileSha256,
      parserVersion: match.provenance.parserVersion,
      normalizerVersion: NORMALIZER_VERSION,
    });
  } catch {
    throw new ApplicationError('PARTICIPATION_SIDECAR_STALE', 'Prepared sidecar не соответствует матчу или версиям parser/normalizer.', 409);
  }
  validateFrozenIdentity(sidecar);
  validateFingerprint(sidecar);
  return sidecar;
}

export function buildParticipationRatingReport(
  artifact: MatchArtifact,
  sidecar: ParticipationSidecar
): ParticipationRatingReport {
  const { match } = artifact;
  if (match.players.length !== 10 || match.teams.length !== 2 || match.teams.some((team) => team.playerIds.length !== 5)) {
    throw new ApplicationError('UNSUPPORTED_ROSTER_SIZE', 'Participation rating применим только к каноническому матчу 5v5.', 422);
  }
  const profileByPlayer = new Map(sidecar.profiles.map((profile) => [profile.playerId, profile]));
  if (profileByPlayer.size !== 10 || match.players.some((player) => !profileByPlayer.has(player.id))) {
    throw new ApplicationError('PARTICIPATION_SIDECAR_ROSTER_MISMATCH', 'Prepared sidecar не соответствует каноническому составу матча.', 409);
  }
  for (const profile of sidecar.profiles) {
    if (profile.prepared.profileKey !== profile.profileKey || profile.prepared.playerId !== profile.playerId || profile.prepared.teamId !== profile.teamId) {
      throw new ApplicationError('PARTICIPATION_SIDECAR_ROSTER_MISMATCH', 'В prepared sidecar нарушена привязка player/profile/team.', 409);
    }
    const identity = match.players.find((player) => player.id === profile.playerId);
    if (!identity || identity.teamId !== profile.teamId) throw new ApplicationError('PARTICIPATION_SIDECAR_ROSTER_MISMATCH', 'Prepared sidecar содержит несовместимую стабильную команду.', 409);
  }

  let active: ReturnType<typeof buildActiveParticipationRating>;
  try {
    active = buildActiveParticipationRating(artifact, sidecar);
  } catch (error) {
    const code = error instanceof Error ? error.message : 'PARTICIPATION_SIDECAR_INVALID';
    if (code === 'PARTICIPATION_SIDECAR_ROSTER_MISMATCH') {
      throw new ApplicationError('PARTICIPATION_SIDECAR_ROSTER_MISMATCH', 'Prepared sidecar или M2 analytics не соответствует каноническому составу матча.', 409);
    }
    throw new ApplicationError('PARTICIPATION_SIDECAR_INVALID', 'Не удалось построить рейтинг из prepared sidecar.', 409);
  }
  return participationRatingReportSchema.parse({
    schemaVersion: 'm3c8-participation-rating-report@1.0.0-experimental',
    matchId: active.matchId,
    experimental: active.experimental,
    calibrated: active.calibrated,
    causalBlame: active.causalBlame,
    scorerVersion: active.scorerVersion,
    policy: {
      selector: H2_PARTICIPATION_RATING_POLICY.selector,
      policyId: H2_PARTICIPATION_RATING_POLICY.id,
      policyDigest: H2_PARTICIPATION_RATING_POLICY.digest,
      harmMultiplier: H2_PARTICIPATION_RATING_POLICY.harmMultiplier
    },
    prepared: {
      schemaVersion: sidecar.schemaVersion,
      preparedInputDigest: sidecar.model.preparedInputDigest,
      fingerprint: sidecar.fingerprint,
      sourceBindingDigest: sha256Canonical(sidecar.binding)
    },
    scenario: active.scenario,
    applicability: active.applicability,
    match: active.match,
    players: active.players,
    ordering: active.ordering,
    losingTeamOrdering: active.losingTeamOrdering,
    awards: active.awards,
    warnings: active.warnings,
    limitations: active.limitations,
    provenance: {
      ...active.provenance,
      sidecarReadOnly: true,
    }
  });
}
