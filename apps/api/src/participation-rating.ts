import { createHash } from 'node:crypto';
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
  C2S2_MODEL_VERSION,
  C2S2_POLICY_DIGEST,
  C2S2_REFERENCE_VERSION,
  P72_PARTICIPATION_SCORER_VERSION,
  P72_POLICIES,
  projectP72ParticipationRatings,
  selectP72Awards,
  type C2S2Family,
  type P72CalculatedProjection,
  type P72ParticipationPreparedProfile,
  type P72PolicySelector
} from '@who-ruined/scoring';
import { ApiError } from './safe-exception.filter.js';
import { safeDataPath } from './storage.js';
import { readBoundedGzipJson } from './bounded-gzip.js';

const fingerprintPattern = /^[a-f0-9]{64}$/;
const safePathSegment = /^[A-Za-z0-9_-]{1,160}$/;
const arithmeticTolerance = 1e-12;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function participationSidecarRelativePath(matchId: string, fileSha256: string): string {
  if (!safePathSegment.test(matchId) || !fingerprintPattern.test(fileSha256)) throw new ApiError('PARTICIPATION_SIDECAR_STALE', 'Идентификатор prepared sidecar не соответствует матчу.', 409);
  return `experimental/c2s2-participation/${matchId}/${fileSha256}.${participationSidecarSchemaVersion}.${C2S2_POLICY_DIGEST}.json.gz`;
}

function expectedPolicies(): Array<{ id: string; digest: string; harmMultiplier: number }> {
  return [P72_POLICIES.H2, P72_POLICIES.H1].map(({ id, digest, harmMultiplier }) => ({ id, digest, harmMultiplier }));
}

function validateFrozenIdentity(sidecar: ParticipationSidecar): void {
  if (sidecar.model.preparedInputModel !== C2S2_MODEL_VERSION || sidecar.model.preparedInputDigest !== C2S2_POLICY_DIGEST || sidecar.model.referenceVersion !== C2S2_REFERENCE_VERSION) {
    throw new ApiError('PARTICIPATION_SIDECAR_POLICY_MISMATCH', 'Prepared sidecar создан для другой версии входной модели или reference.', 409);
  }
  const actual = [...sidecar.model.policies].sort((left, right) => left.id.localeCompare(right.id));
  const expected = expectedPolicies().sort((left, right) => left.id.localeCompare(right.id));
  if (canonical(actual) !== canonical(expected)) throw new ApiError('PARTICIPATION_SIDECAR_POLICY_MISMATCH', 'Prepared sidecar не содержит обе неизменяемые политики H×2 и H×1.', 409);
}

function validateFingerprint(sidecar: ParticipationSidecar): void {
  const stable = {
    binding: sidecar.binding,
    model: sidecar.model,
    scenario: sidecar.scenario,
    participation: sidecar.participation,
    profiles: sidecar.profiles,
    provenance: sidecar.provenance
  };
  if (sha256(canonical(stable)) !== sidecar.fingerprint) throw new ApiError('PARTICIPATION_SIDECAR_FINGERPRINT_MISMATCH', 'Контрольная сумма prepared sidecar не совпадает с его содержимым.', 409);
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
    if ((error as Error).message !== 'BOUNDED_GZIP_MISSING') throw new ApiError('PARTICIPATION_SIDECAR_INVALID', 'Prepared sidecar не удалось безопасно прочитать.', 409);
    if (!rawFilePath) throw new ApiError('PARTICIPATION_SIDECAR_UNAVAILABLE_REQUIRES_ORIGINAL_DEMO', 'Prepared sidecar отсутствует, а исходная демка недоступна.', 409);
    try {
      await access(safeDataPath(rawFilePath));
    } catch {
      throw new ApiError('PARTICIPATION_SIDECAR_UNAVAILABLE_REQUIRES_ORIGINAL_DEMO', 'Prepared sidecar отсутствует, а исходная демка недоступна.', 409);
    }
    throw new ApiError('PARTICIPATION_SIDECAR_BACKFILL_REQUIRED', 'Prepared sidecar отсутствует; запустите контролируемую backfill-команду для исходной демки.', 409);
  }

  if ((decoded as { schemaVersion?: unknown } | null)?.schemaVersion !== participationSidecarSchemaVersion) {
    throw new ApiError('PARTICIPATION_SIDECAR_SCHEMA_MISMATCH', 'Версия prepared sidecar не поддерживается этим endpoint.', 409);
  }
  const parsed = participationSidecarSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new ApiError('PARTICIPATION_SIDECAR_INVALID', 'Prepared sidecar не соответствует типизированному контракту.', 409, {
      issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code }))
    });
  }
  const sidecar = parsed.data;
  if (
    sidecar.binding.matchId !== match.matchId ||
    sidecar.binding.fileSha256 !== match.fileSha256 ||
    sidecar.binding.parserVersion !== match.provenance.parserVersion ||
    sidecar.binding.normalizerVersion !== NORMALIZER_VERSION
  ) throw new ApiError('PARTICIPATION_SIDECAR_STALE', 'Prepared sidecar не соответствует матчу или версиям parser/normalizer.', 409);
  validateFrozenIdentity(sidecar);
  validateFingerprint(sidecar);
  return sidecar;
}

function causeCodes(profile: ParticipationSidecar['profiles'][number]): string[] {
  const codes = new Set<string>();
  if (profile.absentRounds > 0) codes.add('ABSENT_FULL_ROUND_VERIFIED');
  if (profile.partialRounds > 0) codes.add('INTERRUPTED_PARTIAL_ROUND');
  if (profile.unknownRounds > 0) codes.add('PARTICIPATION_EVIDENCE_UNKNOWN');
  if (profile.globalExcludedRounds > 0) codes.add('ROUND_GLOBAL_EVIDENCE_MISSING');
  if (profile.status !== 'ELIGIBLE') codes.add(profile.status);
  if (profile.reason) codes.add(profile.reason);
  return [...codes].sort();
}

function lastScores(artifact: MatchArtifact): Array<{ teamId: string; score: number | null }> {
  const last = artifact.match.rounds.filter((round) => round.isValid).sort((left, right) => left.ordinal - right.ordinal).at(-1);
  return artifact.match.teams.map((team) => ({ teamId: team.id, score: last?.scoreAfter[team.id] ?? null }));
}

function compactFamilies(value: { [K in C2S2Family]?: number | undefined } | null | undefined): Partial<Record<C2S2Family, number>> | null {
  if (!value) return null;
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) as Partial<Record<C2S2Family, number>>;
}

export function buildParticipationRatingReport(
  artifact: MatchArtifact,
  sidecar: ParticipationSidecar,
  selector: P72PolicySelector
): ParticipationRatingReport {
  const { match, analytics } = artifact;
  if (match.players.length !== 10 || match.teams.length !== 2 || match.teams.some((team) => team.playerIds.length !== 5)) {
    throw new ApiError('UNSUPPORTED_ROSTER_SIZE', 'Participation rating применим только к каноническому матчу 5v5.', 422);
  }
  const profileByPlayer = new Map(sidecar.profiles.map((profile) => [profile.playerId, profile]));
  if (profileByPlayer.size !== 10 || match.players.some((player) => !profileByPlayer.has(player.id))) {
    throw new ApiError('PARTICIPATION_SIDECAR_ROSTER_MISMATCH', 'Prepared sidecar не соответствует каноническому составу матча.', 409);
  }
  for (const profile of sidecar.profiles) {
    if (profile.prepared.profileKey !== profile.profileKey || profile.prepared.playerId !== profile.playerId || profile.prepared.teamId !== profile.teamId) {
      throw new ApiError('PARTICIPATION_SIDECAR_ROSTER_MISMATCH', 'В prepared sidecar нарушена привязка player/profile/team.', 409);
    }
    const identity = match.players.find((player) => player.id === profile.playerId);
    if (!identity || identity.teamId !== profile.teamId) throw new ApiError('PARTICIPATION_SIDECAR_ROSTER_MISMATCH', 'Prepared sidecar содержит несовместимую стабильную команду.', 409);
  }

  const policy = P72_POLICIES[selector];
  const preparedProfiles: P72ParticipationPreparedProfile[] = sidecar.profiles.map((profile) => ({
    profileKey: profile.profileKey,
    playerId: profile.playerId,
    teamId: profile.teamId,
    status: profile.status,
    reason: profile.reason,
    prepared: {
      profileKey: profile.prepared.profileKey,
      scenario: profile.prepared.scenario,
      p4BPlus: {
        status: profile.prepared.p4BPlus.status,
        reason: profile.prepared.p4BPlus.reason ?? null,
        familyContributions: compactFamilies(profile.prepared.p4BPlus.familyContributions),
        objectiveSignals: profile.prepared.p4BPlus.objectiveSignals ?? null,
        episodeContributions: profile.prepared.p4BPlus.episodeContributions ?? null
      },
      p4CPlus: {
        status: profile.prepared.p4CPlus.status,
        reason: profile.prepared.p4CPlus.reason ?? null,
        familyContributions: compactFamilies(profile.prepared.p4CPlus.familyContributions),
        objectiveSignals: profile.prepared.p4CPlus.objectiveSignals ?? null,
        episodeContributions: profile.prepared.p4CPlus.episodeContributions ?? null
      }
    }
  }));
  const projected = projectP72ParticipationRatings(preparedProfiles, selector);
  const projectionByPlayer = new Map(projected.map((row) => [row.playerId, row]));
  const calculated = projected.filter((row): row is P72CalculatedProjection => row.status === 'CALCULATED_RESEARCH_ONLY');
  const ordering = [...calculated].sort((left, right) => right.rating - left.rating || left.profileKey.localeCompare(right.profileKey)).map((row) => row.playerId);
  const scores = lastScores(artifact);
  const awards = selectP72Awards(projected, scores);
  const losingTeamOrdering = awards.losingTeamId
    ? [...calculated].filter((row) => row.teamId === awards.losingTeamId).sort((left, right) => right.rating - left.rating || left.profileKey.localeCompare(right.profileKey)).map((row) => row.playerId)
    : awards.outcome === 'DRAW' ? ordering : [];
  const analyticsByPlayer = new Map(analytics.players.map((player) => [player.playerId, player]));

  const players = match.players.map((identity) => {
    const profile = profileByPlayer.get(identity.id)!;
    const row = projectionByPlayer.get(identity.id)!;
    const facts = analyticsByPlayer.get(identity.id);
    if (!facts) throw new ApiError('PARTICIPATION_SIDECAR_ROSTER_MISMATCH', 'M2 analytics не содержит канонического игрока.', 409);
    const rank = ordering.indexOf(identity.id);
    const losingRank = losingTeamOrdering.indexOf(identity.id);
    const rating = row.status === 'CALCULATED_RESEARCH_ONLY' ? {
      value: row.rating,
      rank: rank + 1,
      losingTeamRank: awards.losingTeamId === identity.teamId || awards.outcome === 'DRAW' ? losingRank + 1 : null,
      rawFamilyInputs: row.rawFamilyInputs,
      aggregates: row.aggregates,
      finalAttribution: row.finalAttribution,
      arithmetic: {
        origin: 1 as const,
        reconstructed: 1 + Object.values(row.finalAttribution).reduce((sum, value) => sum + value, 0),
        tolerance: arithmeticTolerance as 1e-12,
        exactWithinTolerance: true as const
      },
      kernelDetails: {
        factorContributions: row.kernel.factorContributions,
        directHarm: row.kernel.directHarm,
        context: row.kernel.context,
        objectives: row.kernel.objectives
      }
    } : null;
    return {
      playerId: identity.id,
      teamId: identity.teamId,
      displayName: identity.displayName,
      steamId: identity.steamId,
      steamProfileUrl: identity.steamId ? `https://steamcommunity.com/profiles/${identity.steamId}` : null,
      availability: { status: row.status, reason: row.reason },
      coverage: {
        verifiedRounds: profile.verifiedRounds,
        absentFullRounds: profile.absentRounds,
        partialRounds: profile.partialRounds,
        unknownRounds: profile.unknownRounds,
        globalExcludedRounds: profile.globalExcludedRounds,
        countedOpportunities: profile.countedRoundIds.length,
        excludedOpportunities: profile.excludedRoundIds.length,
        sideExposure: { T: profile.tRounds, CT: profile.ctRounds },
        causeCodes: causeCodes(profile)
      },
      rating,
      baseStats: { kills: facts.kills, deaths: facts.deaths, assists: facts.assists, kdaRatio: facts.kdaRatio, adr: facts.adr, kastPercent: facts.kastPercent },
      analytics: facts
    };
  });

  return participationRatingReportSchema.parse({
    schemaVersion: 'm3c8-participation-rating-report@1.0.0-experimental',
    matchId: match.matchId,
    experimental: true,
    calibrated: false,
    causalBlame: false,
    scorerVersion: P72_PARTICIPATION_SCORER_VERSION,
    policy: { selector, policyId: policy.id, policyDigest: policy.digest, harmMultiplier: policy.harmMultiplier },
    prepared: {
      schemaVersion: sidecar.schemaVersion,
      preparedInputDigest: sidecar.model.preparedInputDigest,
      fingerprint: sidecar.fingerprint,
      sourceBindingDigest: sha256(canonical(sidecar.binding))
    },
    scenario: sidecar.scenario,
    applicability: { status: sidecar.scenario === 'UNKNOWN' ? 'UNKNOWN' : 'SUPPORTED', reason: sidecar.scenario === 'UNKNOWN' ? 'UNKNOWN_APPLICABILITY' : null },
    match: { map: match.map, quality: match.quality, totalRounds: match.rounds.length, validRounds: match.rounds.filter((round) => round.isValid).length, teams: scores },
    players,
    ordering,
    losingTeamOrdering,
    awards,
    warnings: [
      'Experimental rating: not a calibrated probability and not proof of intent or causal blame.',
      ...(awards.incompletePool ? ['Awards were selected from an incomplete calculated-player pool; inspect availability per player.'] : []),
      ...(awards.mvp.tied || awards.whoRuined.tied ? ['An exact score tie was resolved deterministically by stable profile key.'] : [])
    ],
    limitations: [
      'BOMB and HOSTAGE ratings are mode-aware but their absolute values are not guaranteed to be cross-mode equivalent.',
      'Ordinary deaths and low ratings do not prove a tactical mistake.',
      'Excluded, partial, unknown and globally missing rounds are never converted to zero-valued evidence.'
    ],
    provenance: {
      parserVersion: sidecar.binding.parserVersion,
      normalizerVersion: sidecar.binding.normalizerVersion,
      featureVersion: analytics.featureVersion,
      sidecarReadOnly: true,
      originalDemoParsedAtRequest: false
    }
  });
}
