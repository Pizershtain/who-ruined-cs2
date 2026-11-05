import { createHash } from 'node:crypto';
import {
  activeParticipationRatingReportSchema,
  canonicalMatchResultSchema,
  type ActiveParticipationRatingReport,
  type CanonicalMatchResult,
  type MatchArtifact,
  type ParticipationSidecar,
  type ScoringReport
} from '@who-ruined/contracts';
import {
  PARTICIPATION_FAMILY_POLICY_DIGEST,
  PARTICIPATION_MODEL_VERSION,
  PARTICIPATION_REFERENCE_VERSION,
  participationScenarioForMap,
} from './participation-family-kernel.js';
import {
  PARTICIPATION_RATING_SCORER_VERSION,
  projectParticipationRatings,
  selectParticipationAwards,
  type CalculatedParticipationRating,
} from './participation-rating.js';
import { H2_PARTICIPATION_RATING_POLICY } from './participation-policy.js';
import { toParticipationRatingPreparedProfiles } from './participation-profile-input.js';

const tolerance = 1e-12;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function stableSha256(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

function causeCodes(
  profile: ParticipationSidecar['profiles'][number],
  availability: { status: string; reason: string | null }
): string[] {
  const codes = new Set<string>();
  if (profile.absentRounds > 0) codes.add('ABSENT_FULL_ROUND_VERIFIED');
  if (profile.partialRounds > 0) codes.add('INTERRUPTED_PARTIAL_ROUND');
  if (profile.unknownRounds > 0) codes.add('PARTICIPATION_EVIDENCE_UNKNOWN');
  if (profile.globalExcludedRounds > 0) codes.add('ROUND_GLOBAL_EVIDENCE_MISSING');
  if (availability.status !== 'CALCULATED_RESEARCH_ONLY') codes.add(availability.status);
  if (availability.reason) codes.add(availability.reason);
  return [...codes].sort();
}

function lastScores(artifact: MatchArtifact): Array<{ teamId: string; score: number | null }> {
  const last = artifact.match.rounds.filter((round) => round.isValid).sort((left, right) => left.ordinal - right.ordinal).at(-1);
  return artifact.match.teams.map((team) => ({ teamId: team.id, score: last?.scoreAfter[team.id] ?? null }));
}

function resolveMapScenario(artifact: MatchArtifact, sidecar: ParticipationSidecar): ParticipationSidecar {
  const scenario = participationScenarioForMap(artifact.match.map);
  if (!scenario || sidecar.scenario !== 'UNKNOWN') return sidecar;
  const objectiveSignals = scenario === 'BOMB'
    ? { 'objective:plants': 0, 'objective:defuses': 0 }
    : { 'objective:hostageRescues': 0, 'objective:hostageHurts': 0 };
  return {
    ...sidecar,
    scenario,
    profiles: sidecar.profiles.map((profile) => {
      const objectiveOnlyUnknown = profile.prepared.scenario === 'UNKNOWN'
        && profile.prepared.p4BPlus.status === 'CALCULATED_RESEARCH_ONLY'
        && profile.prepared.p4CPlus.status === 'UNKNOWN_APPLICABILITY'
        && profile.prepared.p4CPlus.reason === 'SCENARIO_UNKNOWN';
      const availabilityOnlyUnknown = profile.status === 'UNKNOWN_APPLICABILITY'
        && profile.reason === 'SCENARIO_UNKNOWN';
      return {
        ...profile,
        status: availabilityOnlyUnknown && objectiveOnlyUnknown ? 'ELIGIBLE' as const : profile.status,
        reason: availabilityOnlyUnknown && objectiveOnlyUnknown ? null : profile.reason,
        prepared: {
          ...profile.prepared,
          scenario,
          p4CPlus: objectiveOnlyUnknown
            ? { ...profile.prepared.p4BPlus, reason: null, objectiveSignals }
            : profile.prepared.p4CPlus
        }
      };
    })
  };
}

export function buildActiveParticipationRating(
  artifact: MatchArtifact,
  sidecar: ParticipationSidecar
): ActiveParticipationRatingReport {
  sidecar = resolveMapScenario(artifact, sidecar);
  const { match, analytics } = artifact;
  if (match.players.length !== 10 || match.teams.length !== 2 || match.teams.some((team) => team.playerIds.length !== 5)) throw new Error('UNSUPPORTED_ROSTER_SIZE');
  const profileByPlayer = new Map(sidecar.profiles.map((profile) => [profile.playerId, profile]));
  if (profileByPlayer.size !== 10 || match.players.some((player) => !profileByPlayer.has(player.id))) throw new Error('PARTICIPATION_SIDECAR_ROSTER_MISMATCH');
  const preparedProfiles = toParticipationRatingPreparedProfiles(sidecar.profiles);
  const projected = projectParticipationRatings(preparedProfiles);
  const projectionByPlayer = new Map(projected.map((row) => [row.playerId, row]));
  const calculated = projected.filter((row): row is CalculatedParticipationRating => row.status === 'CALCULATED_RESEARCH_ONLY');
  const ordering = [...calculated].sort((left, right) => right.rating - left.rating || left.profileKey.localeCompare(right.profileKey)).map((row) => row.playerId);
  const scores = lastScores(artifact);
  const awards = selectParticipationAwards(projected, scores);
  const losingTeamOrdering = awards.losingTeamId
    ? [...calculated].filter((row) => row.teamId === awards.losingTeamId).sort((left, right) => right.rating - left.rating || left.profileKey.localeCompare(right.profileKey)).map((row) => row.playerId)
    : awards.outcome === 'DRAW' ? ordering : [];
  const analyticsByPlayer = new Map(analytics.players.map((player) => [player.playerId, player]));
  const players = match.players.map((identity) => {
    const profile = profileByPlayer.get(identity.id);
    const row = projectionByPlayer.get(identity.id);
    const facts = analyticsByPlayer.get(identity.id);
    if (!profile || !row || !facts || profile.teamId !== identity.teamId) throw new Error('PARTICIPATION_SIDECAR_ROSTER_MISMATCH');
    const rank = ordering.indexOf(identity.id);
    const losingRank = losingTeamOrdering.indexOf(identity.id);
    const rating = row.status === 'CALCULATED_RESEARCH_ONLY' ? {
      value: row.rating, rank: rank + 1,
      losingTeamRank: awards.losingTeamId === identity.teamId || awards.outcome === 'DRAW' ? losingRank + 1 : null,
      rawFamilyInputs: row.rawFamilyInputs, aggregates: row.aggregates, finalAttribution: row.finalAttribution,
      arithmetic: { origin: 1 as const, reconstructed: 1 + Object.values(row.finalAttribution).reduce((sum, value) => sum + value, 0), tolerance: tolerance as 1e-12, exactWithinTolerance: true as const },
      kernelDetails: { factorContributions: row.kernel.factorContributions, directHarm: row.kernel.directHarm, context: row.kernel.context, objectives: row.kernel.objectives }
    } : null;
    if (rating && Math.abs(rating.value - rating.arithmetic.reconstructed) > tolerance) throw new Error('P72_ATTRIBUTION_INTEGRITY_MISMATCH');
    return {
      playerId: identity.id, teamId: identity.teamId, displayName: identity.displayName, steamId: identity.steamId,
      steamProfileUrl: identity.steamId ? `https://steamcommunity.com/profiles/${identity.steamId}` : null,
      availability: { status: row.status, reason: row.reason },
      coverage: { verifiedRounds: profile.verifiedRounds, absentFullRounds: profile.absentRounds, partialRounds: profile.partialRounds, unknownRounds: profile.unknownRounds, globalExcludedRounds: profile.globalExcludedRounds, countedOpportunities: profile.countedRoundIds.length, excludedOpportunities: profile.excludedRoundIds.length, sideExposure: { T: profile.tRounds, CT: profile.ctRounds }, causeCodes: causeCodes(profile, row) },
      rating,
      baseStats: { kills: facts.kills, deaths: facts.deaths, assists: facts.assists, kdaRatio: facts.kdaRatio, adr: facts.adr, kastPercent: facts.kastPercent },
      analytics: facts
    };
  });
  return activeParticipationRatingReportSchema.parse({
    schemaVersion: 'm4.3-participation-rating@1', reportVersion: 'match-result@1', matchId: match.matchId,
    experimental: true, calibrated: false, causalBlame: false, scorerVersion: PARTICIPATION_RATING_SCORER_VERSION,
    scenario: sidecar.scenario,
    applicability: { status: 'SUPPORTED', reason: sidecar.scenario === 'UNKNOWN' ? 'OBJECTIVES_NOT_APPLIED_SCENARIO_UNKNOWN' : null },
    match: { map: match.map, quality: match.quality, totalRounds: match.rounds.length, validRounds: match.rounds.filter((round) => round.isValid).length, teams: scores },
    players, ordering, losingTeamOrdering, awards,
    warnings: ['Experimental rating: not a calibrated probability and not proof of intent or causal blame.', ...(awards.incompletePool ? ['Awards were selected from an incomplete calculated-player pool; inspect availability per player.'] : []), ...(awards.mvp.tied || awards.whoRuined.tied ? ['An exact score tie was resolved deterministically by stable profile key.'] : [])],
    limitations: ['BOMB and HOSTAGE ratings are mode-aware but their absolute values are not guaranteed to be cross-mode equivalent.','When the objective mode cannot be confirmed, the OBJECTIVES family contributes zero while the remaining families are still calculated.','Ordinary deaths and low ratings do not prove a tactical mistake.','Excluded, partial, unknown and globally missing rounds are never converted to zero-valued evidence.'],
    provenance: { parserVersion: sidecar.binding.parserVersion, normalizerVersion: sidecar.binding.normalizerVersion, featureVersion: analytics.featureVersion, originalDemoParsedAtRequest: false }
  });
}

export function buildCanonicalMatchResult(options: {
  artifact: MatchArtifact;
  sidecar: ParticipationSidecar;
  productionReports: ScoringReport[];
  sourceDemoRetained: boolean;
  createdAt?: string;
}): CanonicalMatchResult {
  const sidecar = resolveMapScenario(options.artifact, options.sidecar);
  if (sidecar.binding.matchId !== options.artifact.match.matchId || sidecar.binding.fileSha256 !== options.artifact.match.fileSha256) throw new Error('PARTICIPATION_SIDECAR_STALE');
  if (sidecar.model.preparedInputModel !== PARTICIPATION_MODEL_VERSION || sidecar.model.preparedInputDigest !== PARTICIPATION_FAMILY_POLICY_DIGEST || sidecar.model.referenceVersion !== PARTICIPATION_REFERENCE_VERSION) throw new Error('PARTICIPATION_SIDECAR_POLICY_MISMATCH');
  return canonicalMatchResultSchema.parse({
    schemaVersion: 'match-result@1', createdAt: options.createdAt ?? new Date().toISOString(),
    internal: {
      selectedPolicyId: H2_PARTICIPATION_RATING_POLICY.id,
      selectedPolicyDigest: H2_PARTICIPATION_RATING_POLICY.digest,
      selectedPolicySelector: H2_PARTICIPATION_RATING_POLICY.selector,
      sourceBindingDigest: stableSha256(sidecar.binding),
      recomputeSeed: { schemaVersion: 'match-result-recompute-seed@1', binding: sidecar.binding, model: sidecar.model, scenario: sidecar.scenario, profiles: sidecar.profiles }
    },
    artifact: options.artifact, productionReports: options.productionReports,
    activeRating: buildActiveParticipationRating(options.artifact, sidecar),
    storage: { sourceDemoRetained: options.sourceDemoRetained }
  });
}

export function rebuildCanonicalMatchResult(value: CanonicalMatchResult): CanonicalMatchResult {
  const seed = value.internal.recomputeSeed;
  const sidecar = {
    schemaVersion: 'm3c8-participation-prepared@1.0.0-experimental' as const,
    createdAt: value.createdAt,
    fingerprint: stableSha256({ binding: seed.binding, model: seed.model, scenario: seed.scenario, participation: [], profiles: seed.profiles, provenance: { source: 'RAW_DEMO_EVENTS_AND_TICKS', lifecycleEvents: [], contextTags: [], s2AppliedBy: '@who-ruined/scoring scoreC2S2PreparedProfiles' } }),
    binding: seed.binding, model: seed.model, scenario: seed.scenario, participation: [], profiles: seed.profiles,
    provenance: { source: 'RAW_DEMO_EVENTS_AND_TICKS' as const, lifecycleEvents: [], contextTags: [], s2AppliedBy: '@who-ruined/scoring scoreC2S2PreparedProfiles' }
  };
  return buildCanonicalMatchResult({
    artifact: value.artifact,
    sidecar,
    productionReports: value.productionReports,
    sourceDemoRetained: value.storage.sourceDemoRetained
  });
}
