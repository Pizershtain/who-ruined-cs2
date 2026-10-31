import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { replayIndexArtifactSchema, replayMetadataSchema, replayRoundArtifactSchema } from '../src/index.js';

function round() {
  return {
    schemaVersion: 'm4.7-replay-round@1' as const,
    binding: { matchId: 'synthetic-match', fileSha256: 'a'.repeat(64), parserVersion: 'synthetic', normalizerVersion: 'synthetic' },
    round: { id: 'round_1', ordinal: 1, startTick: 100, freezeEndTick: 120, endTick: 200 },
    tickRate: 64, sampleRateHz: 4, coverage: 'COMPLETE' as const,
    frames: [{ tick: 100, states: [[0, -100, 200, 5, -45, 2, true] as const] }],
    events: [{ id: 'kill_1', kind: 'KILL' as const, tick: 150, actorId: 'p1', targetId: 'p2', assisterId: null }], warnings: []
  };
}

describe('synthetic M4.7 replay contracts', () => {
  it('accepts signed coordinates and nullable parser values without inventing zero', () => {
    expect(replayRoundArtifactSchema.parse(round()).frames[0]?.states[0]).toEqual([0, -100, 200, 5, -45, 2, true]);
    const nullable = round(); nullable.frames[0]!.states = [[0, null, null, null, null, null, true] as never];
    expect(replayRoundArtifactSchema.parse(nullable).frames[0]?.states[0]?.[1]).toBeNull();
  });

  it('separates metadata from one-round payload and rejects malformed frame tuples', () => {
    const artifact = round();
    const summary = { ...artifact.round, sampleCount: 1, eventCount: 1, coverage: artifact.coverage, sha256: 'b'.repeat(64), compressedBytes: 100 };
    const withoutFingerprint = {
      schemaVersion: 'm4.7-replay-index@1' as const, binding: artifact.binding, map: 'de_dust2', tickRate: 64, sampleRateHz: 4, calibration: null,
      players: [{ id: 'p1', displayName: 'Synthetic player', teamId: 'team-a' }], teams: [{ id: 'team-a', playerIds: ['p1'], label: 'A' }],
      rounds: [summary], totalFrames: 1, totalCompressedBytes: 100, warnings: []
    };
    const fingerprint = createHash('sha256').update(JSON.stringify(withoutFingerprint)).digest('hex');
    expect(replayIndexArtifactSchema.parse({ ...withoutFingerprint, fingerprint }).rounds[0]?.sha256).toBe('b'.repeat(64));
    expect(replayMetadataSchema.parse({
      schemaVersion: 'm4.7-replay-metadata@1', matchId: 'synthetic-match', availability: 'REPLAY_UNAVAILABLE', reason: 'REPLAY_UNAVAILABLE', map: 'de_dust2', tickRate: 64, sampleRateHz: null, calibration: null,
      players: [], teams: [], rounds: [{ ...artifact.round, sampleCount: 0, eventCount: 0, coverage: null }], totalFrames: 0, totalCompressedBytes: 0, warnings: ['REPLAY_UNAVAILABLE']
    }).availability).toBe('REPLAY_UNAVAILABLE');
    expect(() => replayRoundArtifactSchema.parse({ ...artifact, frames: [{ tick: 100, states: [[0, 1, 2]] }] })).toThrow();
  });
});
