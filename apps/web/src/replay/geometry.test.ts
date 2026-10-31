import { describe, expect, it } from 'vitest';
import type { ReplayMapCalibration, ReplayRoundArtifact } from '@who-ruined/contracts';
import { replayStatesAtTick, worldToRadar } from './geometry.js';

const calibration: ReplayMapCalibration = {
  id: 'synthetic-copy-of-verified-metadata', map: 'de_dust2', imageWidth: 1024, imageHeight: 1024,
  posX: -2476, posY: 3239, scale: 4.4, rotate: 1, source: 'VALVE_OVERVIEW_METADATA', sourceVersion: 'synthetic test fixture', imageUrl: null
};

function round(states: ReplayRoundArtifact['frames']): ReplayRoundArtifact {
  return {
    schemaVersion: 'm4.7-replay-round@1',
    binding: { matchId: 'synthetic-match', fileSha256: 'a'.repeat(64), parserVersion: 'synthetic', normalizerVersion: 'synthetic' },
    round: { id: 'round_1', ordinal: 1, startTick: 100, freezeEndTick: 110, endTick: 200 },
    tickRate: 64, sampleRateHz: 4, coverage: 'COMPLETE', frames: states, events: [], warnings: []
  };
}

describe('synthetic replay presentation math', () => {
  it('maps verified Dust2 CT/T spawn coordinates near overview spawn markers', () => {
    const ct = worldToRadar(calibration, 351.39, 2352.94);
    const t = worldToRadar(calibration, -720, -861);
    expect(ct.x).toBeCloseTo(.628, 3); expect(ct.y).toBeCloseTo(.197, 3);
    expect(t.x).toBeCloseTo(.39, 2); expect(t.y).toBeCloseTo(.91, 2);
  });

  it('interpolates only adjacent alive samples and never across death', () => {
    const alive = round([{ tick: 100, states: [[0, 0, 0, 0, 350, 0, true]] }, { tick: 116, states: [[0, 16, 8, 0, 10, 0, true]] }]);
    expect(replayStatesAtTick(alive, 108, true)[0]).toMatchObject({ x: 8, y: 4, yaw: 360, alive: true });
    const death = round([{ tick: 100, states: [[0, 0, 0, 0, 0, 0, true]] }, { tick: 116, states: [[0, 16, 8, 0, 0, 0, false]] }]);
    expect(replayStatesAtTick(death, 108, true)[0]).toMatchObject({ x: 0, y: 0, alive: true });
  });

  it('does not interpolate across missing samples or large gaps', () => {
    const missing = round([{ tick: 100, states: [[0, null, null, null, null, null, true]] }, { tick: 116, states: [[0, 16, 8, 0, 0, 0, true]] }]);
    expect(replayStatesAtTick(missing, 108, true)[0]?.x).toBeNull();
    const gap = round([{ tick: 100, states: [[0, 0, 0, 0, 0, 0, true]] }, { tick: 200, states: [[0, 100, 100, 0, 0, 0, true]] }]);
    expect(replayStatesAtTick(gap, 150, true)[0]?.x).toBe(0);
  });
});
