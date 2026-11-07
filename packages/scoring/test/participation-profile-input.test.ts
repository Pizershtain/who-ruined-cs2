import { describe, expect, it } from 'vitest';
import type { ParticipationSidecar } from '@who-ruined/contracts';
import { toParticipationRatingPreparedProfiles } from '../src/participation-profile-input.js';

function persistedProfile(): ParticipationSidecar['profiles'][number] {
  return {
    profileKey: 'profile-1',
    playerId: 'player-1',
    teamId: 'team-1',
    status: 'ELIGIBLE',
    reason: null,
    verifiedRounds: 2,
    absentRounds: 0,
    partialRounds: 0,
    unknownRounds: 0,
    globalExcludedRounds: 0,
    tRounds: 1,
    ctRounds: 1,
    countedRoundIds: ['round-1', 'round-2'],
    excludedRoundIds: [],
    prepared: {
      profileKey: 'profile-1',
      playerId: 'player-1',
      teamId: 'team-1',
      scenario: 'BOMB',
      rounds: 2,
      validRounds: 2,
      tRounds: 1,
      ctRounds: 1,
      requiredInputStatus: 'COMPLETE',
      p4BPlus: {
        status: 'CALCULATED_RESEARCH_ONLY',
        reason: null,
        familyContributions: { COMBAT: .1, DIRECT_HARM: -.02 },
        episodeContributions: [],
      },
      p4CPlus: {
        status: 'CALCULATED_RESEARCH_ONLY',
        reason: null,
        familyContributions: { COMBAT: .1, DIRECT_HARM: -.02 },
        objectiveSignals: { 'objective:plants': 0, 'objective:defuses': 0 },
        episodeContributions: [],
      },
    },
  };
}

describe('persisted participation profile input', () => {
  it('preserves null and contribution semantics for rating and explanation consumers', () => {
    const [profile] = toParticipationRatingPreparedProfiles([persistedProfile()]);

    expect(profile).toEqual({
      profileKey: 'profile-1',
      playerId: 'player-1',
      teamId: 'team-1',
      status: 'ELIGIBLE',
      reason: null,
      prepared: {
        profileKey: 'profile-1',
        scenario: 'BOMB',
        p4BPlus: {
          status: 'CALCULATED_RESEARCH_ONLY',
          reason: null,
          familyContributions: { COMBAT: .1, DIRECT_HARM: -.02 },
          objectiveSignals: null,
          episodeContributions: [],
        },
        p4CPlus: {
          status: 'CALCULATED_RESEARCH_ONLY',
          reason: null,
          familyContributions: { COMBAT: .1, DIRECT_HARM: -.02 },
          objectiveSignals: { 'objective:plants': 0, 'objective:defuses': 0 },
          episodeContributions: [],
        },
      },
    });
  });

  it.each([
    ['WITHHELD_REQUIRED_INPUT', 'REQUIRED_INPUT_MISSING'],
    ['UNKNOWN_APPLICABILITY', 'SCENARIO_UNKNOWN'],
  ] as const)('preserves %s instead of inventing contributions', (status, reason) => {
    const source = persistedProfile();
    source.status = status === 'UNKNOWN_APPLICABILITY'
      ? 'UNKNOWN_APPLICABILITY'
      : 'WITHHELD_INSUFFICIENT_VERIFIED_EXPOSURE';
    source.reason = reason;
    source.prepared.p4BPlus = { status, reason };
    source.prepared.p4CPlus = { status, reason };

    const [profile] = toParticipationRatingPreparedProfiles([source]);

    expect(profile?.prepared.p4BPlus).toEqual({
      status,
      reason,
      familyContributions: null,
      objectiveSignals: null,
      episodeContributions: null,
    });
    expect(profile?.prepared.p4CPlus).toEqual(profile?.prepared.p4BPlus);
  });

  it('omits an unexpected persisted null contribution without converting it to zero', () => {
    const source = persistedProfile();
    const contributions = source.prepared.p4CPlus.familyContributions as Record<string, number | null>;
    contributions.COMBAT = null;

    const [profile] = toParticipationRatingPreparedProfiles([source]);

    expect(profile?.prepared.p4CPlus.familyContributions).toEqual({
      DIRECT_HARM: -.02,
    });
    expect(profile?.prepared.p4CPlus.familyContributions).not.toHaveProperty('COMBAT');
  });
});
