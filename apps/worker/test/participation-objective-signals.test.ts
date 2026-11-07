import { describe, expect, it } from 'vitest';
import { prepareObjectiveSignals } from '../src/prepared-participation-input.js';

const objectives = {
  plants: 2,
  defuses: 1,
  hostageRescues: 3,
  hostageHurts: 4,
};

describe('participation objective preparation', () => {
  it('uses the frozen bomb policy for both sidecar preparation paths', () => {
    expect(prepareObjectiveSignals('BOMB', objectives, {
      rounds: 8,
      tRounds: 5,
      ctRounds: 3,
    })).toEqual({
      'objective:plants': .05 * 2 / .12355 / 5,
      'objective:defuses': .05 / .07155950973368645 / 3,
    });
  });

  it('uses the frozen hostage policy and preserves unavailable scenario semantics', () => {
    expect(prepareObjectiveSignals('HOSTAGE', objectives, {
      rounds: 8,
      tRounds: 5,
      ctRounds: 3,
    })).toEqual({
      'objective:hostageRescues': .08 * 3 / .026835947523339676 / 3,
      'objective:hostageHurts': -.02 * 4 / .22414985539395899 / 8,
    });
    expect(prepareObjectiveSignals('UNKNOWN', objectives, {
      rounds: 8,
      tRounds: 5,
      ctRounds: 3,
    })).toEqual({});
  });

  it('keeps absent objective evidence and zero exposure finite without inventing credit', () => {
    expect(prepareObjectiveSignals('BOMB', {
      plants: 0, defuses: 0, hostageRescues: 0, hostageHurts: 0,
    }, {
      rounds: 8, tRounds: 5, ctRounds: 3,
    })).toEqual({
      'objective:plants': 0,
      'objective:defuses': 0,
    });
    expect(prepareObjectiveSignals('BOMB', objectives, {
      rounds: 0, tRounds: 0, ctRounds: 0,
    })).toEqual({
      'objective:plants': 0,
      'objective:defuses': 0,
    });
    expect(prepareObjectiveSignals('HOSTAGE', objectives, {
      rounds: 0, tRounds: 0, ctRounds: 0,
    })).toEqual({
      'objective:hostageRescues': 0,
      'objective:hostageHurts': 0,
    });
  });
});
