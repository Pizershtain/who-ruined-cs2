import { describe, expect, it } from 'vitest';
import type { ReplayMapCalibration, ReplayRoundArtifact } from '@who-ruined/contracts';
import { isOnRadarLayer, replayStatesAtTick, worldToRadar } from './geometry.js';

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
  it('keeps floors disjoint and does not guess the floor for missing altitude', () => {
    const upper = { id: 'default', imageUrl: '/synthetic.png', minZ: -495, maxZ: 10000 };
    const lower = { ...upper, id: 'lower', minZ: -10000, maxZ: -495 };
    expect(isOnRadarLayer(-495, upper, true)).toBe(true);
    expect(isOnRadarLayer(-495, lower, true)).toBe(false);
    expect(isOnRadarLayer(null, upper, true)).toBe(false);
    expect(isOnRadarLayer(null, upper, false)).toBe(true);
  });
  it('maps verified Dust2 CT/T spawn coordinates near overview spawn markers', () => {
    const ct = worldToRadar(calibration, 351.39, 2352.94);
    const t = worldToRadar(calibration, -720, -861);
    expect(ct.x).toBeCloseTo(.628, 3); expect(ct.y).toBeCloseTo(.197, 3);
    expect(t.x).toBeCloseTo(.39, 2); expect(t.y).toBeCloseTo(.91, 2);
  });

  it('interpolates only adjacent alive samples and never across death', () => {
    const alive = round([{ tick: 100, states: [[0, 0, 0, 0, 350, 0, true]] }, { tick: 116, states: [[0, 16, 8, 0, 10, 0, true]] }]);
    expect(replayStatesAtTick(alive, 108, true)[0]).toMatchObject({ x: 8, y: 4, yaw: 350, alive: true });
    const death = round([{ tick: 100, states: [[0, 0, 0, 0, 0, 0, true]] }, { tick: 116, states: [[0, 16, 8, 0, 0, 0, false]] }]);
    expect(replayStatesAtTick(death, 108, true)[0]).toMatchObject({ x: 0, y: 0, alive: true });
  });

  it('moves continuously and settles aim over 80ms along the shortest arc', () => {
    const moving = round([{ tick: 100, states: [[0, 0, 0, 0, 350, 5, true]] }, { tick: 116, states: [[0, 16, 8, 0, 10, -5, true]] }]);
    for (const tick of [100, 100.5, 108, 115.5]) {
      expect(replayStatesAtTick(moving, tick, true)[0]).toMatchObject({ x: tick - 100, y: (tick - 100) / 2, yaw: 350, pitch: 5 });
    }
    expect(replayStatesAtTick(moving, 116, true)[0]).toMatchObject({ x: 16, yaw: 350, pitch: 5 });
    expect(replayStatesAtTick(moving, 118.56, true)[0]?.yaw).toBeCloseTo(360);
    expect(replayStatesAtTick(moving, 118.56, true)[0]?.pitch).toBeCloseTo(0);
    expect(replayStatesAtTick(moving, 121.12, true)[0]?.yaw).toBeCloseTo(10);
    expect(replayStatesAtTick(moving, 121.12, true)[0]?.pitch).toBeCloseTo(-5);
    expect(replayStatesAtTick(moving, 102, true)[0]).toMatchObject({ x: 2, yaw: 350, pitch: 5 });
    expect(replayStatesAtTick(moving, 108, false)[0]).toMatchObject({ x: 0, yaw: 350 });
  });

  it('does not interpolate across missing samples or large gaps', () => {
    const missing = round([{ tick: 100, states: [[0, null, null, null, null, null, true]] }, { tick: 116, states: [[0, 16, 8, 0, 0, 0, true]] }]);
    expect(replayStatesAtTick(missing, 108, true)[0]?.x).toBeNull();
    const gap = round([{ tick: 100, states: [[0, 0, 0, 0, 0, 0, true]] }, { tick: 200, states: [[0, 100, 100, 0, 0, 0, true]] }]);
    expect(replayStatesAtTick(gap, 150, true)[0]?.x).toBe(0);
  });
});
