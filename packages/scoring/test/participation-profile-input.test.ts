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
});
