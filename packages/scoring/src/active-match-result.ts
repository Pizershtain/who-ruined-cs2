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
import { C2S2_MODEL_VERSION, C2S2_POLICY_DIGEST, C2S2_REFERENCE_VERSION, type C2S2Family } from './participation-family-kernel.js';
import {
  P72_PARTICIPATION_SCORER_VERSION,
  P72_POLICIES,
  projectP72ParticipationRatings,
  selectP72Awards,
  type P72CalculatedProjection,
  type P72ParticipationPreparedProfile,
  type P72PolicySelector
} from './participation-rating.js';

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

function compactFamilies(value: { [K in C2S2Family]?: number | undefined } | null | undefined): Partial<Record<C2S2Family, number>> | null {
  if (!value) return null;
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) as Partial<Record<C2S2Family, number>>;
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

export function buildActiveParticipationRating(
  artifact: MatchArtifact,
  sidecar: ParticipationSidecar,
  selector: P72PolicySelector
): ActiveParticipationRatingReport {
  const { match, analytics } = artifact;
  if (match.players.length !== 10 || match.teams.length !== 2 || match.teams.some((team) => team.playerIds.length !== 5)) throw new Error('UNSUPPORTED_ROSTER_SIZE');
  const profileByPlayer = new Map(sidecar.profiles.map((profile) => [profile.playerId, profile]));
  if (profileByPlayer.size !== 10 || match.players.some((player) => !profileByPlayer.has(player.id))) throw new Error('PARTICIPATION_SIDECAR_ROSTER_MISMATCH');
  const preparedProfiles: P72ParticipationPreparedProfile[] = sidecar.profiles.map((profile) => ({
    profileKey: profile.profileKey, playerId: profile.playerId, teamId: profile.teamId,
    status: profile.status, reason: profile.reason,
    prepared: {
      profileKey: profile.prepared.profileKey, scenario: profile.prepared.scenario,
      p4BPlus: { status: profile.prepared.p4BPlus.status, reason: profile.prepared.p4BPlus.reason ?? null, familyContributions: compactFamilies(profile.prepared.p4BPlus.familyContributions), objectiveSignals: profile.prepared.p4BPlus.objectiveSignals ?? null, episodeContributions: profile.prepared.p4BPlus.episodeContributions ?? null },
      p4CPlus: { status: profile.prepared.p4CPlus.status, reason: profile.prepared.p4CPlus.reason ?? null, familyContributions: compactFamilies(profile.prepared.p4CPlus.familyContributions), objectiveSignals: profile.prepared.p4CPlus.objectiveSignals ?? null, episodeContributions: profile.prepared.p4CPlus.episodeContributions ?? null }
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
      coverage: { verifiedRounds: profile.verifiedRounds, absentFullRounds: profile.absentRounds, partialRounds: profile.partialRounds, unknownRounds: profile.unknownRounds, globalExcludedRounds: profile.globalExcludedRounds, countedOpportunities: profile.countedRoundIds.length, excludedOpportunities: profile.excludedRoundIds.length, sideExposure: { T: profile.tRounds, CT: profile.ctRounds }, causeCodes: causeCodes(profile) },
      rating,
      baseStats: { kills: facts.kills, deaths: facts.deaths, assists: facts.assists, kdaRatio: facts.kdaRatio, adr: facts.adr, kastPercent: facts.kastPercent },
      analytics: facts
    };
  });
  return activeParticipationRatingReportSchema.parse({
    schemaVersion: 'm4.3-participation-rating@1', reportVersion: 'match-result@1', matchId: match.matchId,
    experimental: true, calibrated: false, causalBlame: false, scorerVersion: P72_PARTICIPATION_SCORER_VERSION,
    scenario: sidecar.scenario,
    applicability: { status: sidecar.scenario === 'UNKNOWN' ? 'UNKNOWN' : 'SUPPORTED', reason: sidecar.scenario === 'UNKNOWN' ? 'UNKNOWN_APPLICABILITY' : null },
    match: { map: match.map, quality: match.quality, totalRounds: match.rounds.length, validRounds: match.rounds.filter((round) => round.isValid).length, teams: scores },
    players, ordering, losingTeamOrdering, awards,
    warnings: ['Experimental rating: not a calibrated probability and not proof of intent or causal blame.', ...(awards.incompletePool ? ['Awards were selected from an incomplete calculated-player pool; inspect availability per player.'] : []), ...(awards.mvp.tied || awards.whoRuined.tied ? ['An exact score tie was resolved deterministically by stable profile key.'] : [])],
    limitations: ['BOMB and HOSTAGE ratings are mode-aware but their absolute values are not guaranteed to be cross-mode equivalent.','Ordinary deaths and low ratings do not prove a tactical mistake.','Excluded, partial, unknown and globally missing rounds are never converted to zero-valued evidence.'],
    provenance: { parserVersion: sidecar.binding.parserVersion, normalizerVersion: sidecar.binding.normalizerVersion, featureVersion: analytics.featureVersion, originalDemoParsedAtRequest: false }
  });
}

export function buildCanonicalMatchResult(options: {
  artifact: MatchArtifact;
  sidecar: ParticipationSidecar;
  productionReports: ScoringReport[];
  selector: P72PolicySelector;
  sourceDemoRetained: boolean;
  createdAt?: string;
}): CanonicalMatchResult {
  if (options.sidecar.binding.matchId !== options.artifact.match.matchId || options.sidecar.binding.fileSha256 !== options.artifact.match.fileSha256) throw new Error('PARTICIPATION_SIDECAR_STALE');
  if (options.sidecar.model.preparedInputModel !== C2S2_MODEL_VERSION || options.sidecar.model.preparedInputDigest !== C2S2_POLICY_DIGEST || options.sidecar.model.referenceVersion !== C2S2_REFERENCE_VERSION) throw new Error('PARTICIPATION_SIDECAR_POLICY_MISMATCH');
  const policy = P72_POLICIES[options.selector];
  return canonicalMatchResultSchema.parse({
    schemaVersion: 'match-result@1', createdAt: options.createdAt ?? new Date().toISOString(),
    internal: {
      selectedPolicyId: policy.id, selectedPolicyDigest: policy.digest, selectedPolicySelector: options.selector,
      sourceBindingDigest: stableSha256(options.sidecar.binding),
      recomputeSeed: { schemaVersion: 'match-result-recompute-seed@1', binding: options.sidecar.binding, model: options.sidecar.model, scenario: options.sidecar.scenario, profiles: options.sidecar.profiles }
    },
    artifact: options.artifact, productionReports: options.productionReports,
    activeRating: buildActiveParticipationRating(options.artifact, options.sidecar, options.selector),
    storage: { sourceDemoRetained: options.sourceDemoRetained }
  });
}

export function rebuildCanonicalMatchResult(value: CanonicalMatchResult, selector: P72PolicySelector): CanonicalMatchResult {
  const seed = value.internal.recomputeSeed;
  const sidecar = {
    schemaVersion: 'm3c8-participation-prepared@1.0.0-experimental' as const,
    createdAt: value.createdAt,
    fingerprint: stableSha256({ binding: seed.binding, model: seed.model, scenario: seed.scenario, participation: [], profiles: seed.profiles, provenance: { source: 'RAW_DEMO_EVENTS_AND_TICKS', lifecycleEvents: [], contextTags: [], s2AppliedBy: '@who-ruined/scoring scoreC2S2PreparedProfiles' } }),
    binding: seed.binding, model: seed.model, scenario: seed.scenario, participation: [], profiles: seed.profiles,
    provenance: { source: 'RAW_DEMO_EVENTS_AND_TICKS' as const, lifecycleEvents: [], contextTags: [], s2AppliedBy: '@who-ruined/scoring scoreC2S2PreparedProfiles' }
  };
  return buildCanonicalMatchResult({ artifact: value.artifact, sidecar, productionReports: value.productionReports, selector, sourceDemoRetained: value.storage.sourceDemoRetained });
}
