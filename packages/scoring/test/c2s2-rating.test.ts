import { describe, expect, it } from 'vitest';
import {
  C2S2_POLICY_DIGEST,
  C2S2_POLICY,
  c2s2PolicyDigest,
  scoreC2S2PreparedProfile,
  scoreC2S2PreparedProfiles,
  softDirectHarmS2,
  type C2S2PreparedProfile
} from '../src/c2s2-rating.js';

function profile(overrides: Partial<C2S2PreparedProfile> = {}): C2S2PreparedProfile {
  return {
    profileKey: 'profile-01',
    scenario: 'BOMB',
    p4CPlus: {
      status: 'CALCULATED_RESEARCH_ONLY',
      reason: null,
      familyContributions: {
        COMBAT: 0.04,
        SUPPORT: 0.02,
        DEATH_RELATED: -0.03,
        DIRECT_HARM: -0.2,
        CONTEXT: 999,
        OBJECTIVES: 999
      },
      objectiveSignals: { 'objective:plants': 0.25, 'objective:defuses': 0 }
    },
    p4BPlus: {
      status: 'CALCULATED_RESEARCH_ONLY',
      episodeContributions: [
        { anchorId: 'round_1:harm', chosenAxis: 'allyHp', family: 'DIRECT_HARM', base: -1, tags: [] },
        { anchorId: 'round_2:kill', chosenAxis: 'enemyKills', family: 'COMBAT', base: 0.2, tags: ['OPENING', 'TRADE'] }
      ]
    },
    ...overrides
  };
}

describe('C2 + S2 frozen experimental model', () => {
  it('keeps the checked-in policy hash stable', () => {
    expect(c2s2PolicyDigest()).toBe(C2S2_POLICY_DIGEST);
    expect(Object.isFrozen(C2S2_POLICY)).toBe(true);
    expect(Object.isFrozen(C2S2_POLICY.context)).toBe(true);
    expect(Object.isFrozen(C2S2_POLICY.objectives)).toBe(true);
  });

  it.each([
    [0, 0],
    [-Number.EPSILON, -Number.EPSILON],
    [-0.05, -0.05],
    [-0.075 + Number.EPSILON, -0.075 + Number.EPSILON],
    [-0.075, -0.075],
    [-0.1, -(0.075 + 0.05 * Math.log1p(0.025 / 0.05))],
    [-0.2, -(0.075 + 0.05 * Math.log1p(0.125 / 0.05))],
    [-0.33649318512880405, -0.16646772274819543]
  ])('applies S2 exactly at raw=%s', (raw, expected) => {
    expect(softDirectHarmS2(raw)).toBeCloseTo(expected, 14);
  });

  it('is continuous and strictly monotone around the knee and through the observed domain', () => {
    const values = Array.from({ length: 5001 }, (_, index) => -index / 10_000);
    for (let index = 1; index < values.length; index += 1) {
      expect(softDirectHarmS2(values[index]!)).toBeLessThan(softDirectHarmS2(values[index - 1]!));
    }
    const epsilon = 1e-9;
    expect(Math.abs(softDirectHarmS2(-0.075 - epsilon) - softDirectHarmS2(-0.075 + epsilon))).toBeLessThan(3 * epsilon);
  });

  it('rejects positive and non-finite raw harm instead of clamping it', () => {
    expect(() => softDirectHarmS2(0.01)).toThrow('DIRECT_HARM_RAW_MUST_BE_NONPOSITIVE');
    expect(() => softDirectHarmS2(Number.NaN)).toThrow('DIRECT_HARM_RAW_MUST_BE_FINITE');
    expect(() => softDirectHarmS2(Number.POSITIVE_INFINITY)).toThrow('DIRECT_HARM_RAW_MUST_BE_FINITE');
  });

  it('returns a finite monotone result for the largest finite IEEE input', () => {
    const moderate = softDirectHarmS2(-1e300);
    const maximum = softDirectHarmS2(-Number.MAX_VALUE);
    expect(Number.isFinite(maximum)).toBe(true);
    expect(maximum).toBeLessThan(moderate);
  });

  it('changes only Direct Harm while reproducing an exact six-family decomposition', () => {
    const row = scoreC2S2PreparedProfile(profile());
    expect(row.status).toBe('CALCULATED_RESEARCH_ONLY');
    if (row.status !== 'CALCULATED_RESEARCH_ONLY') throw new Error('unexpected status');
    expect(row.familyContributions.COMBAT).toBe(0.04);
    expect(row.familyContributions.SUPPORT).toBe(0.02);
    expect(row.familyContributions.DEATH_RELATED).toBe(-0.03);
    expect(row.familyContributions.DIRECT_HARM).toBe(softDirectHarmS2(-0.2));
    expect(row.familyContributions.OBJECTIVES).toBe(0.025);
    expect(row.rating).toBe(1 + Object.values(row.familyContributions).reduce((sum, value) => sum + value, 0));
  });

  it('allocates the transformed family total across rounds only after the family transform', () => {
    const input = profile();
    input.p4BPlus.episodeContributions = [
      { anchorId: 'round_1:harm-a', chosenAxis: 'allyHp', family: 'DIRECT_HARM', base: -1, tags: [] },
      { anchorId: 'round_2:harm-b', chosenAxis: 'allyBlind', family: 'DIRECT_HARM', base: -3, tags: [] }
    ];
    const row = scoreC2S2PreparedProfile(input);
    if (row.status !== 'CALCULATED_RESEARCH_ONLY') throw new Error('unexpected status');
    expect(row.directHarmRoundAllocation.round_2).toBeCloseTo(3 * row.directHarmRoundAllocation.round_1!, 14);
    expect(Object.values(row.directHarmRoundAllocation).reduce((sum, value) => sum + value, 0)).toBe(row.directHarm.soft);
  });

  it('preserves typed withheld and unknown states with null numeric values', () => {
    for (const status of ['WITHHELD_REQUIRED_INPUT', 'UNKNOWN_APPLICABILITY'] as const) {
      const input = profile({ scenario: status === 'UNKNOWN_APPLICABILITY' ? 'UNKNOWN' : 'BOMB' });
      input.p4CPlus = { status, reason: status === 'UNKNOWN_APPLICABILITY' ? 'SCENARIO_UNKNOWN' : 'REQUIRED_INPUT_MISSING' };
      const row = scoreC2S2PreparedProfile(input);
      expect(row).toMatchObject({ status, rating: null, familyContributions: null, directHarm: null });
    }
  });

  it('does not silently calculate an UNKNOWN scenario', () => {
    expect(() => scoreC2S2PreparedProfile(profile({ scenario: 'UNKNOWN' }))).toThrow('C2S2_UNKNOWN_SCENARIO_MUST_NOT_BE_CALCULATED');
  });

  it('rejects missing or mode-inconsistent objective signals', () => {
    const missing = profile();
    missing.p4CPlus.objectiveSignals = null;
    expect(() => scoreC2S2PreparedProfile(missing)).toThrow('C2S2_OBJECTIVE_SIGNALS_UNAVAILABLE');
    const wrongMode = profile({ scenario: 'HOSTAGE' });
    expect(() => scoreC2S2PreparedProfile(wrongMode)).toThrow('C2S2_OBJECTIVE_SIGNAL_SET_MISMATCH:HOSTAGE');
  });

  it('rejects duplicate profile keys and remains source-order deterministic', () => {
    const left = profile({ profileKey: 'a' });
    const right = profile({ profileKey: 'b' });
    expect(scoreC2S2PreparedProfiles([left, right]).map((row) => row.rating)).toEqual(scoreC2S2PreparedProfiles([right, left]).reverse().map((row) => row.rating));
    expect(() => scoreC2S2PreparedProfiles([left, left])).toThrow('C2S2_DUPLICATE_PROFILE_KEY');
  });

  it('does not treat a second S2 application as an allowed input transformation', () => {
    const raw = -0.2;
    expect(softDirectHarmS2(softDirectHarmS2(raw))).not.toBe(softDirectHarmS2(raw));
    const row = scoreC2S2PreparedProfile(profile());
    if (row.status !== 'CALCULATED_RESEARCH_ONLY') throw new Error('unexpected status');
    expect(row.directHarm.raw).toBe(raw);
    expect(row.directHarm.soft).toBe(softDirectHarmS2(raw));
  });
});
