import { gzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findUnique = vi.fn();
const readFile = vi.fn();
vi.mock('@who-ruined/database', () => ({ prisma: { match: { findUnique }, report: { findUnique: vi.fn() }, job: { create: vi.fn() } } }));
vi.mock('node:fs/promises', async (original) => ({ ...(await original<typeof import('node:fs/promises')>()), readFile }));

const { MatchesService } = await import('../src/matches.service.js');
const previousFlag = process.env.ENABLE_EXPERIMENTAL_RATING;

describe('experimental rating feature gate', () => {
  beforeEach(() => { findUnique.mockReset(); readFile.mockReset(); delete process.env.ENABLE_EXPERIMENTAL_RATING; });
  afterEach(() => { if (previousFlag === undefined) delete process.env.ENABLE_EXPERIMENTAL_RATING; else process.env.ENABLE_EXPERIMENTAL_RATING = previousFlag; });

  it('is disabled by default and does not access stored match data', async () => {
    await expect(new MatchesService().experimentalRating('match')).rejects.toMatchObject({ code: 'EXPERIMENTAL_RATING_DISABLED', status: 404 });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('keeps legacy artifacts unavailable instead of fabricating required analytics', async () => {
    process.env.ENABLE_EXPERIMENTAL_RATING = '1';
    findUnique.mockResolvedValue({ id: 'legacy', normalizedFilePath: 'cache/legacy.json.gz' });
    readFile.mockResolvedValue(gzipSync(Buffer.from(JSON.stringify({ schemaVersion: '1', obsolete: true }))));
    await expect(new MatchesService().experimentalRating('legacy')).rejects.toMatchObject({ code: 'INCOMPLETE_MATCH', status: 409 });
  });
});
