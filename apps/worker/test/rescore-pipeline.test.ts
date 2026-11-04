import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerRuntimeConfig } from '../src/runtime-config.js';

const dependencies = vi.hoisted(() => ({
  advanceJobStage: vi.fn(),
  completeOwnedJob: vi.fn(),
  persistScoringReport: vi.fn(),
  publishCanonicalMatchResult: vi.fn(),
  readCanonicalMatchResult: vi.fn(),
  removeOwnedResult: vi.fn(),
  requestedScoringConfig: vi.fn(),
  scoreMatch: vi.fn(),
  scoreStoredArtifact: vi.fn(),
}));

vi.mock('@who-ruined/contracts', async (importOriginal) => ({
  ...await importOriginal<typeof import('@who-ruined/contracts')>(),
  canonicalMatchResultSchema: { parse: (value: unknown) => value },
}));
vi.mock('@who-ruined/database', async (importOriginal) => ({
  ...await importOriginal<typeof import('@who-ruined/database')>(),
  advanceJobStage: dependencies.advanceJobStage,
  completeOwnedJob: dependencies.completeOwnedJob,
}));
vi.mock('@who-ruined/scoring', async (importOriginal) => ({
  ...await importOriginal<typeof import('@who-ruined/scoring')>(),
  scoreMatch: dependencies.scoreMatch,
}));
vi.mock('../src/match-result-storage.js', () => ({
  publishCanonicalMatchResult: dependencies.publishCanonicalMatchResult,
  readCanonicalMatchResult: dependencies.readCanonicalMatchResult,
  removeOwnedResult: dependencies.removeOwnedResult,
}));
vi.mock('../src/report-storage.js', () => ({
  persistScoringReport: dependencies.persistScoringReport,
  requestedScoringConfig: dependencies.requestedScoringConfig,
  scoreStoredArtifact: dependencies.scoreStoredArtifact,
}));

const { runRescorePipeline } = await import('../src/rescore-pipeline.js');

const report = {
  scorerVersion: 'scoring-v1',
  configHash: 'c'.repeat(64),
  winningTeamId: 'team-a',
  losingTeamId: 'team-b',
};
const baseOptions = {
  dataRoot: 'synthetic-data-root',
  jobId: 'job',
  matchId: 'match',
  leaseToken: 'lease-token',
  job: {
    requestedScoringVersion: 'scoring-v1',
    requestedConfigHash: 'c'.repeat(64),
  },
  config: { leaseMs: 1_000 } as WorkerRuntimeConfig,
  assertOwned: vi.fn(async () => undefined),
};

beforeEach(() => {
  vi.clearAllMocks();
  dependencies.requestedScoringConfig.mockReturnValue({ version: 'scoring-v1' });
  dependencies.scoreStoredArtifact.mockResolvedValue(report);
  dependencies.persistScoringReport.mockResolvedValue('CREATED');
  dependencies.completeOwnedJob.mockResolvedValue(undefined);
});

describe('rescore pipeline routing', () => {
  it('completes a legacy artifact rescore through fenced Report persistence', async () => {
    await runRescorePipeline({
      ...baseOptions,
      match: {
        resultFilePath: null,
        resultSha256: null,
        normalizedFilePath: 'cache/match.json.gz',
      },
    });

    expect(dependencies.persistScoringReport).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job',
      matchId: 'match',
      leaseToken: 'lease-token',
      report,
    }));
    expect(dependencies.completeOwnedJob).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job',
      matchId: 'match',
      leaseToken: 'lease-token',
      terminal: 'COMPLETED',
    }));
  });

  it('keeps canonical rescore on atomic completeOwnedJob without legacy Report persistence', async () => {
    dependencies.readCanonicalMatchResult.mockResolvedValue({
      artifact: { match: { matchId: 'match' } },
      productionReports: [],
      schemaVersion: 'match-result@1',
      internal: {},
    });
    dependencies.scoreMatch.mockReturnValue(report);
    dependencies.publishCanonicalMatchResult.mockResolvedValue({
      relativePath: 'results/match/current.json.gz',
      sha256: 'a'.repeat(64),
    });

    await runRescorePipeline({
      ...baseOptions,
      match: {
        resultFilePath: 'results/match/previous.json.gz',
        resultSha256: 'b'.repeat(64),
        normalizedFilePath: null,
      },
    });

    expect(dependencies.persistScoringReport).not.toHaveBeenCalled();
    expect(dependencies.completeOwnedJob).toHaveBeenCalledWith(expect.objectContaining({
      matchData: expect.objectContaining({
        resultFilePath: 'results/match/current.json.gz',
        resultSha256: 'a'.repeat(64),
      }),
    }));
  });

  it('does not score or replace a canonical result when its Match relations are corrupt', async () => {
    dependencies.readCanonicalMatchResult.mockRejectedValue(new Error('REPORT_CORRUPT'));

    await expect(runRescorePipeline({
      ...baseOptions,
      match: {
        resultFilePath: 'results/match/previous.json.gz',
        resultSha256: 'b'.repeat(64),
        normalizedFilePath: null,
      },
    })).rejects.toThrow('REPORT_CORRUPT');

    expect(dependencies.scoreMatch).not.toHaveBeenCalled();
    expect(dependencies.publishCanonicalMatchResult).not.toHaveBeenCalled();
    expect(dependencies.completeOwnedJob).not.toHaveBeenCalled();
    expect(dependencies.removeOwnedResult).not.toHaveBeenCalled();
  });
});
