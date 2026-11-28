import { describe, expect, it, vi } from 'vitest';
import type { MatchData, ReplayIndexArtifact } from '@who-ruined/contracts';
import type { Request } from 'express';
import { replayMapCatalog } from '../src/application/replay-map-catalog.generated.js';
import { resolveReplayRadar } from '../src/application/replay-maps.js';
import { ReplayQueries } from '../src/application/use-cases/replay-queries.js';
import type { StoredMatchAccess } from '../src/application/stored-match-access.js';
import { ReplayController } from '../src/modules/replay/replay.controller.js';

describe('radar catalogue and synthetic stored replay compatibility', () => {
  it('validates every activated map and rejects unknown maps and conflicting historical transforms', () => {
    for (const map of Object.keys(replayMapCatalog)) expect(resolveReplayRadar(map, null)?.map).toBe(map);
    expect(resolveReplayRadar('workshop/123/de_mirage', null)).toBeNull();
    expect(resolveReplayRadar('__proto__', null)).toBeNull();
    const dust = replayMapCatalog.de_dust2!;
    expect(resolveReplayRadar('de_dust2', { ...dust, map: 'de_dust2', scale: dust.scale + 1 })).toBeNull();
  });

  it('serves new radar metadata from an unchanged old index, preserves v1 and keeps unavailable data unavailable', async () => {
    const match: MatchData = { schemaVersion: '1', matchId: 'synthetic', fileSha256: 'a'.repeat(64), map: 'de_inferno', tickRate: 64, players: [], teams: [], rounds: [], events: [], quality: 'VALID', qualityIssues: [], provenance: { parser: 'synthetic', parserVersion: '0', normalizedAt: '2026-11-04T00:00:00.000Z' } };
    const index: ReplayIndexArtifact = { schemaVersion: 'm4.7-replay-index@1', binding: { matchId: match.matchId, fileSha256: match.fileSha256, parserVersion: 'synthetic', normalizerVersion: '0' }, fingerprint: 'b'.repeat(64), map: match.map, tickRate: 64, sampleRateHz: 4, calibration: null, players: [], teams: [], rounds: [], totalFrames: 0, totalCompressedBytes: 0, warnings: [] };
    // Only match() is used by this application use case; no database or demo is opened.
    const stored = { match: vi.fn().mockResolvedValue(match) } as unknown as StoredMatchAccess;
    const readIndex = vi.fn().mockResolvedValue(index), readRound = vi.fn();
    const queries = new ReplayQueries(stored, { readIndex, readRound });
    const before = JSON.stringify(index);
    expect(await queries.metadata(match.matchId)).toMatchObject({ schemaVersion: 'm4.7-replay-metadata@1', availability: 'UNSUPPORTED_MAP', calibration: null });
    expect(await queries.metadata(match.matchId, 2)).toMatchObject({ schemaVersion: 'm4.7-replay-metadata@2', availability: 'AVAILABLE', calibration: { map: 'de_inferno' } });
    expect(JSON.stringify(index)).toBe(before);
    readIndex.mockResolvedValueOnce(null);
    expect(await queries.metadata(match.matchId, 2)).toMatchObject({ availability: 'REPLAY_UNAVAILABLE', calibration: null });
    readIndex.mockResolvedValueOnce({ ...index, map: 'de_mirage' });
    await expect(queries.metadata(match.matchId, 2)).rejects.toMatchObject({ code: 'REPLAY_CORRUPT' });
    expect(readRound).not.toHaveBeenCalled();
    const controller = new ReplayController(queries);
    expect(() => controller.replay('synthetic', { query: { version: '3' } } as unknown as Request)).toThrow();
    expect(() => controller.replay('synthetic', { query: { version: ['2', '1'] } } as unknown as Request)).toThrow();
  });
});
