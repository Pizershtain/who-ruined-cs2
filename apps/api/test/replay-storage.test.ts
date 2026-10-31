import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { ReplayIndexArtifact, ReplayRoundArtifact } from '@who-ruined/contracts';

const readBoundedGzipJson = vi.fn();
vi.mock('../src/bounded-gzip.js', async (original) => ({
  ...(await original<typeof import('../src/bounded-gzip.js')>()),
  readBoundedGzipJson
}));

const { readReplayIndex, readReplayRound } = await import('../src/replay-storage.js');

const binding = {
  matchId: 'synthetic-replay-match',
  fileSha256: 'a'.repeat(64),
  parserVersion: 'synthetic-parser',
  normalizerVersion: 'synthetic-normalizer'
};

function round(): ReplayRoundArtifact {
  return {
    schemaVersion: 'm4.7-replay-round@1', binding,
    round: { id: 'round-1', ordinal: 1, startTick: 0, freezeEndTick: 64, endTick: 128 },
    tickRate: 64, sampleRateHz: 4, coverage: 'COMPLETE',
    frames: [{ tick: 0, states: [[0, -1000, 2000, 5, 90, 0, true]] }],
    events: [{ id: 'event-1', kind: 'KILL', tick: 64, actorId: 'player-1', targetId: 'player-2', assisterId: null }],
    warnings: []
  };
}

function index(): ReplayIndexArtifact {
  const stable = {
    schemaVersion: 'm4.7-replay-index@1' as const, binding, map: 'de_dust2', tickRate: 64, sampleRateHz: 4,
    calibration: { id: 'dust2-source1-overview', map: 'de_dust2' as const, imageWidth: 1024, imageHeight: 1024, posX: -2476, posY: 3239, scale: 4.4, rotate: 1, source: 'VALVE_OVERVIEW_METADATA' as const, sourceVersion: 'local-reference', imageUrl: null },
    players: [{ id: 'player-1', displayName: 'Synthetic player', teamId: 'team-1' }],
    teams: [{ id: 'team-1', playerIds: ['player-1'], label: 'Synthetic team' }],
    rounds: [{ id: 'round-1', ordinal: 1, startTick: 0, freezeEndTick: 64, endTick: 128, sampleCount: 1, eventCount: 1, coverage: 'COMPLETE' as const, sha256: 'b'.repeat(64), compressedBytes: 256 }],
    totalFrames: 1, totalCompressedBytes: 256, warnings: []
  };
  return { ...stable, fingerprint: createHash('sha256').update(JSON.stringify(stable)).digest('hex') };
}

describe('synthetic replay storage validation', () => {
  it('accepts a bound index and serves exactly the indexed round payload', async () => {
    const replayIndex = index();
    const replayRound = round();
    readBoundedGzipJson.mockReset().mockResolvedValueOnce(replayIndex).mockResolvedValueOnce(replayRound);
    await expect(readReplayIndex(binding.matchId, binding.fileSha256)).resolves.toEqual(replayIndex);
    await expect(readReplayRound(replayIndex, 'round-1')).resolves.toEqual(replayRound);
    expect(readBoundedGzipJson).toHaveBeenLastCalledWith(expect.stringContaining('/rounds/round-1.'), 'b'.repeat(64));
  });

  it('fails closed for a changed fingerprint, binding, checksum read, or missing round', async () => {
    readBoundedGzipJson.mockReset().mockResolvedValueOnce({ ...index(), map: 'de_mirage' });
    await expect(readReplayIndex(binding.matchId, binding.fileSha256)).rejects.toMatchObject({ code: 'REPLAY_CORRUPT', status: 409 });

    readBoundedGzipJson.mockReset().mockResolvedValueOnce({ ...index(), binding: { ...binding, matchId: 'other-match' } });
    await expect(readReplayIndex(binding.matchId, binding.fileSha256)).rejects.toMatchObject({ code: 'REPLAY_CORRUPT', status: 409 });

    const replayIndex = index();
    await expect(readReplayRound(replayIndex, 'round-2')).rejects.toMatchObject({ code: 'REPLAY_ROUND_NOT_FOUND', status: 404 });
    readBoundedGzipJson.mockReset().mockRejectedValueOnce(new Error('checksum mismatch'));
    await expect(readReplayRound(replayIndex, 'round-1')).rejects.toMatchObject({ code: 'REPLAY_CORRUPT', status: 409 });
  });
});
