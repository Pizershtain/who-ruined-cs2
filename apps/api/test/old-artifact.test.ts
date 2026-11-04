import { gzipSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeMatchAnalytics } from '@who-ruined/features';
import { syntheticValidMatch } from '@who-ruined/testkit';

const findUnique = vi.fn();
const readFile = vi.fn();
const stat = vi.fn();
vi.mock('@who-ruined/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@who-ruined/database')>()),
  prisma: { match: { findUnique }, report: { findUnique: vi.fn() }, job: { create: vi.fn() } },
}));
vi.mock('node:fs/promises', async (original) => ({ ...(await original<typeof import('node:fs/promises')>()), readFile, stat }));

const { createTestApiFacade } = await import('./test-api-facade.js');

describe('old artifact rescore semantics', () => {
  beforeEach(() => {
    stat.mockResolvedValue({ isFile: () => true, size: 1024 });
    findUnique.mockResolvedValue({ id: 'legacy_match', normalizedFilePath: 'cache/legacy.json.gz' });
    readFile.mockResolvedValue(gzipSync(Buffer.from(JSON.stringify({ schemaVersion: '1', obsolete: true }))));
  });

  it('returns 409 instead of inventing M2 analytics or leaking a Zod error', async () => {
    await expect(createTestApiFacade().rescore('legacy_match', { scoringVersion: 'scoring-successor@0.1.0-alpha75-beta25' })).rejects.toMatchObject({ code: 'INCOMPLETE_MATCH', status: 409 });
  });

  it('returns a diagnostic 409 for a shape-valid M2 artifact with corrupt relations', async () => {
    const match = syntheticValidMatch();
    const analytics = computeMatchAnalytics(match, '2026-10-17T00:00:00.000Z');
    match.players[0]!.teamId = 'unknown-team';
    const artifact = { schemaVersion: 'm2-artifact-1', match, analytics };
    findUnique.mockResolvedValue({ id: match.matchId, normalizedFilePath: 'cache/corrupt.json.gz' });
    readFile.mockResolvedValue(gzipSync(Buffer.from(JSON.stringify(artifact))));

    await expect(createTestApiFacade().rescore(match.matchId, {
      scoringVersion: 'scoring-successor@0.1.0-alpha75-beta25',
    })).rejects.toMatchObject({ code: 'REPORT_CORRUPT', status: 409 });
  });
});
