import {
  scoreC2S2PreparedProfiles,
  type C2S2Family,
  type C2S2PreparedProfile,
  type C2S2Row
} from './c2s2-rating.js';

export const P72_PARTICIPATION_SCORER_VERSION = 'm3c8-p7.2-f-rating-projector@1.0.0-experimental' as const;

export const P72_POLICIES = Object.freeze({
  H2: Object.freeze({
    selector: 'H2' as const,
    id: 'P72B_D_P10_N5_K025_A015_H2' as const,
    digest: '7ac1d2d3afcffa9d4682e2979f06f4dad8d42f270ec0e858bac93019724baf48' as const,
    harmMultiplier: 2 as const
  }),
  H1: Object.freeze({
    selector: 'H1' as const,
    id: 'P72B_D_P10_N5_K025_A015_H1' as const,
    digest: '3d299d81f8e8cd336ec6288431fa83240f6a0209bfeed3b80f89930ab88f5c75' as const,
    harmMultiplier: 1 as const
  })
});

export type P72PolicySelector = keyof typeof P72_POLICIES;
export type P72AvailabilityStatus =
  | 'CALCULATED_RESEARCH_ONLY'
  | 'PARTICIPATION_ABSENT_GT_2_ROUNDS'
  | 'PARTICIPATION_EVIDENCE_UNKNOWN'
  | 'PARTIAL_COVERAGE_INSUFFICIENT'
  | 'WITHHELD_INSUFFICIENT_VERIFIED_EXPOSURE'
  | 'UNKNOWN_APPLICABILITY';

export type P72ParticipationPreparedProfile = {
  profileKey: string;
  playerId: string;
  teamId: string;
  status: 'ELIGIBLE' | Exclude<P72AvailabilityStatus, 'CALCULATED_RESEARCH_ONLY' | 'PARTIAL_COVERAGE_INSUFFICIENT'>;
  reason: string | null;
  prepared: C2S2PreparedProfile;
};

export type P72CalculatedProjection = {
  profileKey: string;
  playerId: string;
  teamId: string;
  status: 'CALCULATED_RESEARCH_ONLY';
  reason: null;
  rating: number;
  rawFamilyInputs: Record<C2S2Family, number>;
  aggregates: {
    positiveMass: number;
    negativeMass: number;
    positiveTerm: number;
    negativeTerm: number;
    harmTerm: number;
  };
  finalAttribution: Record<C2S2Family, number>;
  kernel: Extract<C2S2Row, { status: 'CALCULATED_RESEARCH_ONLY' }>;
};

export type P72UnavailableProjection = {
  profileKey: string;
  playerId: string;
  teamId: string;
  status: Exclude<P72AvailabilityStatus, 'CALCULATED_RESEARCH_ONLY'>;
  reason: string | null;
  rating: null;
  rawFamilyInputs: null;
  aggregates: null;
  finalAttribution: null;
  kernel: C2S2Row | null;
};

export type P72Projection = P72CalculatedProjection | P72UnavailableProjection;

const nonHarmFamilies = ['COMBAT', 'SUPPORT', 'DEATH_RELATED', 'CONTEXT', 'OBJECTIVES'] as const;
const epsilon = 1e-12;

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new RangeError(`${label}_MUST_BE_FINITE`);
  return value;
}

export function p72SoftNegative(value: number): number {
  finite(value, 'P72_NEGATIVE_INPUT');
  if (value < 0) throw new RangeError('P72_NEGATIVE_INPUT_MUST_BE_NONNEGATIVE');
  return value <= 0.25 ? value : 0.25 + 0.15 * Math.log1p((value - 0.25) / 0.15);
}

function unavailable(
  profile: P72ParticipationPreparedProfile,
  status: P72UnavailableProjection['status'],
  reason: string | null,
  kernel: C2S2Row | null
): P72UnavailableProjection {
  return {
    profileKey: profile.profileKey,
    playerId: profile.playerId,
    teamId: profile.teamId,
    status,
    reason,
    rating: null,
    rawFamilyInputs: null,
    aggregates: null,
    finalAttribution: null,
    kernel
  };
}

export function projectP72ParticipationRatings(
  profiles: P72ParticipationPreparedProfile[],
  selector: P72PolicySelector
): P72Projection[] {
  const policy = P72_POLICIES[selector];
  const kernelRows = new Map(scoreC2S2PreparedProfiles(profiles.map((profile) => profile.prepared)).map((row) => [row.profileKey, row]));

  return profiles.map((profile) => {
    const kernel = kernelRows.get(profile.profileKey) ?? null;
    if (profile.status !== 'ELIGIBLE') return unavailable(profile, profile.status, profile.reason, kernel);
    if (!kernel || kernel.status !== 'CALCULATED_RESEARCH_ONLY') {
      const status = kernel?.status === 'UNKNOWN_APPLICABILITY'
        ? 'UNKNOWN_APPLICABILITY'
        : 'WITHHELD_INSUFFICIENT_VERIFIED_EXPOSURE';
      return unavailable(profile, status, kernel?.reason ?? 'SCORE_UNAVAILABLE', kernel);
    }

    const families = kernel.familyContributions;
    const positiveMass = nonHarmFamilies.reduce((sum, family) => sum + Math.max(families[family], 0), 0);
    const negativeMass = nonHarmFamilies.reduce((sum, family) => sum + Math.max(-families[family], 0), 0);
    const positiveTerm = 10 * positiveMass;
    const negativeTerm = -p72SoftNegative(5 * negativeMass);
    const harmTerm = policy.harmMultiplier * families.DIRECT_HARM;
    const finalAttribution = {
      COMBAT: families.COMBAT >= 0 ? 10 * families.COMBAT : negativeMass > 0 ? negativeTerm * (-families.COMBAT / negativeMass) : 0,
      SUPPORT: families.SUPPORT >= 0 ? 10 * families.SUPPORT : negativeMass > 0 ? negativeTerm * (-families.SUPPORT / negativeMass) : 0,
      DEATH_RELATED: families.DEATH_RELATED >= 0 ? 10 * families.DEATH_RELATED : negativeMass > 0 ? negativeTerm * (-families.DEATH_RELATED / negativeMass) : 0,
      CONTEXT: families.CONTEXT >= 0 ? 10 * families.CONTEXT : negativeMass > 0 ? negativeTerm * (-families.CONTEXT / negativeMass) : 0,
      OBJECTIVES: families.OBJECTIVES >= 0 ? 10 * families.OBJECTIVES : negativeMass > 0 ? negativeTerm * (-families.OBJECTIVES / negativeMass) : 0,
      DIRECT_HARM: harmTerm
    } satisfies Record<C2S2Family, number>;
    const rating = finite(1 + positiveTerm + negativeTerm + harmTerm, 'P72_RATING');
    const reconstructed = 1 + Object.values(finalAttribution).reduce((sum, value) => sum + value, 0);
    if (Math.abs(rating - reconstructed) > epsilon) throw new Error('P72_ATTRIBUTION_INTEGRITY_MISMATCH');
    return {
      profileKey: profile.profileKey,
      playerId: profile.playerId,
      teamId: profile.teamId,
      status: 'CALCULATED_RESEARCH_ONLY' as const,
      reason: null,
      rating,
      rawFamilyInputs: { ...families },
      aggregates: { positiveMass, negativeMass, positiveTerm, negativeTerm, harmTerm },
      finalAttribution,
      kernel
    };
  });
}

export type P72Award = {
  playerId: string | null;
  awardPoolSize: number;
  tied: boolean;
  close: boolean;
  tiedPlayerIds: string[];
  scoreGap: number | null;
  reasonIfUnavailable: string | null;
};

export function selectP72Awards(
  rows: P72Projection[],
  teams: Array<{ teamId: string; score: number | null }>
): {
  eligiblePoolSize: number;
  incompletePool: boolean;
  losingTeamId: string | null;
  outcome: 'DECIDED' | 'DRAW' | 'UNKNOWN';
  mvp: P72Award;
  whoRuined: P72Award & { scope: 'LOSING_TEAM_ELIGIBLE' | 'DRAW_ALL_ELIGIBLE' | 'UNAVAILABLE' };
} {
  const calculated = rows.filter((row): row is P72CalculatedProjection => row.status === 'CALCULATED_RESEARCH_ONLY');
  const validOutcome = teams.length === 2 && teams.every((team) => team.score !== null);
  const draw = validOutcome && teams[0]!.score === teams[1]!.score;
  const losingTeamId = validOutcome && !draw
    ? [...teams].sort((left, right) => left.score! - right.score! || left.teamId.localeCompare(right.teamId))[0]!.teamId
    : null;
  const descending = [...calculated].sort((left, right) => right.rating - left.rating || left.profileKey.localeCompare(right.profileKey));
  const whoPool = draw ? calculated : losingTeamId ? calculated.filter((row) => row.teamId === losingTeamId) : [];
  const ascending = [...whoPool].sort((left, right) => left.rating - right.rating || left.profileKey.localeCompare(right.profileKey));
  const award = (ordered: P72CalculatedProjection[], reason: string | null): P72Award => {
    const first = ordered[0];
    if (!first) return { playerId: null, awardPoolSize: 0, tied: false, close: false, tiedPlayerIds: [], scoreGap: null, reasonIfUnavailable: reason };
    const tiedRows = ordered.filter((row) => Math.abs(row.rating - first.rating) <= epsilon);
    const scoreGap = ordered[1] ? Math.abs(first.rating - ordered[1]!.rating) : null;
    return {
      playerId: first.playerId,
      awardPoolSize: ordered.length,
      tied: tiedRows.length > 1,
      close: tiedRows.length > 1,
      tiedPlayerIds: tiedRows.map((row) => row.playerId),
      scoreGap,
      reasonIfUnavailable: null
    };
  };
  return {
    eligiblePoolSize: calculated.length,
    incompletePool: calculated.length !== rows.length,
    losingTeamId,
    outcome: !validOutcome ? 'UNKNOWN' : draw ? 'DRAW' : 'DECIDED',
    mvp: award(descending, 'NO_CALCULATED_ELIGIBLE_PLAYERS'),
    whoRuined: {
      ...award(ascending, validOutcome ? 'NO_CALCULATED_ELIGIBLE_PLAYERS_IN_SCOPE' : 'MATCH_OUTCOME_UNAVAILABLE'),
      scope: !validOutcome ? 'UNAVAILABLE' : draw ? 'DRAW_ALL_ELIGIBLE' : 'LOSING_TEAM_ELIGIBLE'
    }
  };
}
