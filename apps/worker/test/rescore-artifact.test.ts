import { gzipSync } from 'node:zlib';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeMatchAnalytics } from '@who-ruined/features';
import { syntheticValidMatch } from '@who-ruined/testkit';
import { SUCCESSOR_75_25_CONFIG } from '@who-ruined/scoring';

const parser = vi.fn(() => { throw new Error('parser must not run during rescore'); });
vi.mock('@who-ruined/parser-adapter', () => ({ parseDemoSnapshot: parser }));
const { scoreStoredArtifact } = await import('../src/process-job.js');

const relative = 'cache/rescore-artifact-test.json.gz';
const absolute = path.resolve('data', relative);

afterEach(async () => { await rm(absolute, { force: true }); });

describe('artifact-only rescore', () => {
  it('scores a persisted M2 artifact without invoking the native parser', async () => {
    const match = syntheticValidMatch();
    const artifact = { schemaVersion: 'm2-artifact-1' as const, match, analytics: computeMatchAnalytics(match, '2026-10-17T00:00:00.000Z') };
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, gzipSync(Buffer.from(JSON.stringify(artifact))));
    const report = await scoreStoredArtifact(relative, SUCCESSOR_75_25_CONFIG);
    expect(report.matchId).toBe(match.matchId);
    expect(parser).not.toHaveBeenCalled();
  });

  it('rejects a shape-valid legacy artifact with contradictory Match relations', async () => {
    const match = syntheticValidMatch();
    const analytics = computeMatchAnalytics(match, '2026-10-17T00:00:00.000Z');
    match.events = [{
      id: 'synthetic-corrupt-event',
      kind: 'PLAYER_DEATH',
      roundId: 'unknown-round',
      tick: 1_200,
      actorId: match.players[0]!.id,
      targetId: match.players[5]!.id,
      assisterId: null,
      attrs: {},
      source: { eventName: 'synthetic-corrupt-event', rowIndex: 0 },
    }];
    const artifact = { schemaVersion: 'm2-artifact-1' as const, match, analytics };
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, gzipSync(Buffer.from(JSON.stringify(artifact))));

    await expect(scoreStoredArtifact(relative, SUCCESSOR_75_25_CONFIG))
      .rejects.toMatchObject({ reason: 'INTEGRITY_MISMATCH' });
    expect(parser).not.toHaveBeenCalled();
  });
});
