import { describe, expect, it } from 'vitest';
import {
  P72_POLICIES,
  projectP72ParticipationRatings,
  selectP72Awards,
  type C2S2PreparedProfile,
  type P72ParticipationPreparedProfile
} from '../src/index.js';

function prepared(profileKey: string, harm = -0.04): C2S2PreparedProfile {
  return {
    profileKey,
    scenario: 'BOMB',
    p4BPlus: {
      status: 'CALCULATED_RESEARCH_ONLY',
      reason: null,
      familyContributions: { COMBAT: 0.04, SUPPORT: 0.01, DEATH_RELATED: -0.03, DIRECT_HARM: harm, CONTEXT: 0, OBJECTIVES: 0 },
      episodeContributions: [{ anchorId: 'round_1:harm', chosenAxis: 'allyHp', family: 'DIRECT_HARM', base: harm, tags: [] }]
    },
    p4CPlus: {
      status: 'CALCULATED_RESEARCH_ONLY',
      reason: null,
      familyContributions: { COMBAT: 0.04, SUPPORT: 0.01, DEATH_RELATED: -0.03, DIRECT_HARM: harm, CONTEXT: 0, OBJECTIVES: 0 },
      objectiveSignals: { 'objective:plants': 0, 'objective:defuses': 0 },
      episodeContributions: [{ anchorId: 'round_1:harm', chosenAxis: 'allyHp', family: 'DIRECT_HARM', base: harm, tags: [] }]
    }
  };
}

function profile(index: number, status: P72ParticipationPreparedProfile['status'] = 'ELIGIBLE'): P72ParticipationPreparedProfile {
  const profileKey = `P${String(index + 1).padStart(2, '0')}`;
  return {
    profileKey,
    playerId: `player-${index + 1}`,
    teamId: index < 5 ? 'team-a' : 'team-b',
    status,
    reason: status === 'ELIGIBLE' ? null : 'THREE_OR_MORE_VERIFIED_FULL_ROUND_ABSENCES',
    prepared: prepared(profileKey, -0.01 * index)
  };
}

describe('P7.2 frozen participation rating projection', () => {
  it('keeps both owner-approved policy identities immutable', () => {
    expect(P72_POLICIES.H2).toEqual({ selector: 'H2', id: 'P72B_D_P10_N5_K025_A015_H2', digest: '7ac1d2d3afcffa9d4682e2979f06f4dad8d42f270ec0e858bac93019724baf48', harmMultiplier: 2 });
    expect(P72_POLICIES.H1).toEqual({ selector: 'H1', id: 'P72B_D_P10_N5_K025_A015_H1', digest: '3d299d81f8e8cd336ec6288431fa83240f6a0209bfeed3b80f89930ab88f5c75', harmMultiplier: 1 });
    expect(Object.isFrozen(P72_POLICIES.H2)).toBe(true);
    expect(Object.isFrozen(P72_POLICIES.H1)).toBe(true);
  });

  it('reconciles aggregate saturation and six-family attribution exactly', () => {
    const [row] = projectP72ParticipationRatings([profile(3)], 'H2');
    expect(row?.status).toBe('CALCULATED_RESEARCH_ONLY');
    if (!row || row.status !== 'CALCULATED_RESEARCH_ONLY') throw new Error('unexpected status');
    const reconstructed = 1 + Object.values(row.finalAttribution).reduce((sum, value) => sum + value, 0);
    expect(Math.abs(row.rating - reconstructed)).toBeLessThanOrEqual(1e-12);
    expect(row.aggregates.negativeTerm).toBeLessThanOrEqual(0);
    expect(row.finalAttribution.DIRECT_HARM).toBe(2 * row.rawFamilyInputs.DIRECT_HARM);
  });

  it('changes only the already-S2-transformed harm term when switching H2/H1', () => {
    const input = [profile(4)];
    const h2 = projectP72ParticipationRatings(input, 'H2')[0]!;
    const h1 = projectP72ParticipationRatings(input, 'H1')[0]!;
    if (h2.status !== 'CALCULATED_RESEARCH_ONLY' || h1.status !== 'CALCULATED_RESEARCH_ONLY') throw new Error('unexpected status');
    expect(Math.abs((h2.rating - h1.rating) - h2.rawFamilyInputs.DIRECT_HARM)).toBeLessThanOrEqual(1e-12);
    expect(h2.rawFamilyInputs).toEqual(h1.rawFamilyInputs);
    expect(h2.aggregates.positiveTerm).toBe(h1.aggregates.positiveTerm);
    expect(h2.aggregates.negativeTerm).toBe(h1.aggregates.negativeTerm);
  });

  it('preserves per-player absence as null instead of a fabricated baseline rating', () => {
    const [row] = projectP72ParticipationRatings([profile(0, 'PARTICIPATION_ABSENT_GT_2_ROUNDS')], 'H2');
    expect(row).toMatchObject({ status: 'PARTICIPATION_ABSENT_GT_2_ROUNDS', rating: null, finalAttribution: null });
  });

  it('selects awards from nine calculated players and limits Who Ruined to the losing pool', () => {
    const input = Array.from({ length: 10 }, (_, index) => profile(index, index === 7 ? 'PARTICIPATION_ABSENT_GT_2_ROUNDS' : 'ELIGIBLE'));
    const rows = projectP72ParticipationRatings(input, 'H2');
    const awards = selectP72Awards(rows, [{ teamId: 'team-a', score: 13 }, { teamId: 'team-b', score: 8 }]);
    expect(awards.eligiblePoolSize).toBe(9);
    expect(awards.incompletePool).toBe(true);
    expect(awards.whoRuined.awardPoolSize).toBe(4);
    expect(awards.whoRuined.scope).toBe('LOSING_TEAM_ELIGIBLE');
  });

  it('uses all calculated players as the Who Ruined pool only for a genuine score draw', () => {
    const rows = projectP72ParticipationRatings(Array.from({ length: 10 }, (_, index) => profile(index)), 'H1');
    const awards = selectP72Awards(rows, [{ teamId: 'team-a', score: 12 }, { teamId: 'team-b', score: 12 }]);
    expect(awards.outcome).toBe('DRAW');
    expect(awards.losingTeamId).toBeNull();
    expect(awards.whoRuined.scope).toBe('DRAW_ALL_ELIGIBLE');
    expect(awards.whoRuined.awardPoolSize).toBe(10);
  });
});
