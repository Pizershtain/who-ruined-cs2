import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchArtifactSchema } from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import { scoreMatch, SUCCESSOR_75_25_CONFIG } from '@who-ruined/scoring';
import { syntheticValidMatch } from '@who-ruined/testkit';

const database = vi.hoisted(() => ({
  persistOwnedReport: vi.fn(),
}));

vi.mock('@who-ruined/database', async (importOriginal) => ({
  ...await importOriginal<typeof import('@who-ruined/database')>(),
  persistOwnedReport: database.persistOwnedReport,
}));

const { persistScoringReport } = await import('../src/report-storage.js');

const roots: string[] = [];
const previousResultJsonBytes = process.env.MAX_RESULT_JSON_BYTES;
const previousResultJsonDepth = process.env.MAX_RESULT_JSON_DEPTH;

afterEach(async () => {
  vi.clearAllMocks();
  if (previousResultJsonBytes === undefined) delete process.env.MAX_RESULT_JSON_BYTES;
  else process.env.MAX_RESULT_JSON_BYTES = previousResultJsonBytes;
  if (previousResultJsonDepth === undefined) delete process.env.MAX_RESULT_JSON_DEPTH;
  else process.env.MAX_RESULT_JSON_DEPTH = previousResultJsonDepth;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function reportFixture() {
  const match = syntheticValidMatch();
  const artifact = matchArtifactSchema.parse({
    schemaVersion: 'm2-artifact-1',
    match,
    analytics: computeMatchAnalytics(match),
  });
  return scoreMatch(artifact, SUCCESSOR_75_25_CONFIG);
}

describe('legacy scoring report persistence', () => {
  it('does not publish a report that exceeds the configured reader output limit', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'wrc-report-storage-'));
    roots.push(dataRoot);
    const report = reportFixture();
    process.env.MAX_RESULT_JSON_BYTES = '128';

    await expect(persistScoringReport({
      dataRoot,
      jobId: 'job',
      matchId: report.matchId,
      leaseToken: 'lease-token',
      report,
      assertOwned: vi.fn(async () => undefined),
    })).rejects.toMatchObject({ reason: 'DECOMPRESSED_LIMIT' });
    await expect(access(path.join(dataRoot, 'reports')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(database.persistOwnedReport).not.toHaveBeenCalled();
  });

  it('rejects a report above the configured JSON depth before publication', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'wrc-report-depth-'));
    roots.push(dataRoot);
    const report = reportFixture();
    process.env.MAX_RESULT_JSON_DEPTH = '1';

    await expect(persistScoringReport({
      dataRoot,
      jobId: 'job',
      matchId: report.matchId,
      leaseToken: 'lease-token',
      report,
      assertOwned: vi.fn(async () => undefined),
    })).rejects.toMatchObject({ reason: 'DEPTH' });
    await expect(access(path.join(dataRoot, 'reports')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(database.persistOwnedReport).not.toHaveBeenCalled();
  });

  it('passes Job ownership to fenced persistence and reuses immutable bytes', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'wrc-report-storage-'));
    roots.push(dataRoot);
    const report = reportFixture();
    const options = {
      dataRoot,
      jobId: 'job',
      matchId: report.matchId,
      leaseToken: 'lease-token',
      report,
      assertOwned: vi.fn(async () => undefined),
    };

    await expect(persistScoringReport(options)).resolves.toBe('CREATED');
    await expect(persistScoringReport(options)).resolves.toBe('REUSED');
    expect(database.persistOwnedReport).toHaveBeenLastCalledWith(expect.objectContaining({
      jobId: 'job',
      matchId: report.matchId,
      leaseToken: 'lease-token',
      scoringVersion: report.scorerVersion,
      configHash: report.configHash,
      quality: report.quality,
    }));
  });

  it('leaves an immutable orphan reusable when lease fencing rejects after publication', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'wrc-report-storage-'));
    roots.push(dataRoot);
    const report = reportFixture();
    const relativePath = `reports/${report.matchId}/${report.scorerVersion}-${report.configHash}.json.gz`;
    const options = {
      dataRoot,
      jobId: 'job',
      matchId: report.matchId,
      leaseToken: 'stale-token',
      report,
      assertOwned: vi.fn(async () => undefined),
    };
    database.persistOwnedReport.mockRejectedValueOnce(new Error('STALE_JOB_OWNER'));

    await expect(persistScoringReport(options)).rejects.toThrow('STALE_JOB_OWNER');
    await expect(access(path.join(dataRoot, relativePath))).resolves.toBeUndefined();

    database.persistOwnedReport.mockResolvedValueOnce(undefined);
    await expect(persistScoringReport({ ...options, leaseToken: 'current-token' }))
      .resolves.toBe('REUSED');
    await expect(access(path.join(dataRoot, relativePath))).resolves.toBeUndefined();
  });
});
