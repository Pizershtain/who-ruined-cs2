import { describe, expect, it } from 'vitest';
import {
  EXPERIMENTAL_REFERENCE_ID,
  FROZEN_EXPERIMENTAL_REFERENCE,
  experimentalReferenceHash,
  fitExperimentalReference,
  validateExperimentalEpisode,
  type ExperimentalProfileInput
} from '../src/experimental-rating.js';

function profile(id: string, value: number, status: ExperimentalProfileInput['requiredInputStatus'] = 'COMPLETE'): ExperimentalProfileInput {
  return {
    matchId: 'match', playerId: id, teamId: 'team', validRounds: 10, totalRounds: 10,
    requiredInputStatus: status, causeCodes: status === 'COMPLETE' ? [] : ['REQUIRED_INPUT_MISSING'],
    axes: { enemyHp: value, enemyKills: value, assists: value, enemyBlind: value, allyHp: value, allyBlind: value }, teamKills: 0,
    episodes: [], rounds: {}
  };
}

describe('M3-C8 integration reference', () => {
  it('excludes withheld profiles before all scale and baseline fitting', () => {
    const eligible = [profile('a', 10), profile('b', 20), profile('c', 40), profile('d', 80)];
    const base = fitExperimentalReference(eligible);
    expect(fitExperimentalReference([...eligible, profile('rejected', 1_000_000, 'WITHHELD')])).toEqual(base);
    expect(base.fittedProfiles).toBe(4);
    expect(base.familyBaselines.directHarm).toBe(0);
  });

  it('keeps the checked-in reference immutable and hash-addressed', () => {
    expect(FROZEN_EXPERIMENTAL_REFERENCE.referenceId).toBe(EXPERIMENTAL_REFERENCE_ID);
    expect(FROZEN_EXPERIMENTAL_REFERENCE.fittedProfiles).toBe(670);
    expect(experimentalReferenceHash(FROZEN_EXPERIMENTAL_REFERENCE)).toBe('05278a5b8ca66bfaa2f9cb6a3aac175526dfe8f26a62595373d4dacc94d9c380');
    expect(Object.isFrozen(FROZEN_EXPERIMENTAL_REFERENCE)).toBe(true);
  });

  it('rejects mixed-family and negative episode components', () => {
    expect(() => validateExperimentalEpisode({ id: 'mixed', roundId: 'r1', tick: 1, family: 'combat', components: { enemyHp: 10, allyHp: 10 } })).toThrow('MIXED_SIGN_EPISODE');
    expect(() => validateExperimentalEpisode({ id: 'negative', roundId: 'r1', tick: 1, family: 'combat', components: { enemyHp: -1 } })).toThrow('INVALID_EPISODE_COMPONENT');
  });
});
