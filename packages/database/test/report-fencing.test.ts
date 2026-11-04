import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/client/index.js';
import {
  createJobRepository,
  type PersistOwnedReportInput,
} from '../src/index.js';

const roots: string[] = [];
const clients: PrismaClient[] = [];
const leaseExpiresAt = new Date('2026-11-04T00:00:01.000Z');
const whileOwned = new Date('2026-11-04T00:00:00.500Z');
const afterExpiry = new Date('2026-11-04T00:00:02.000Z');

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

async function fixture(): Promise<{ first: PrismaClient; second: PrismaClient }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-report-fencing-'));
  roots.push(root);
  const databasePath = path.join(root, 'reports.db');
  const sql = new DatabaseSync(databasePath);
  sql.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE Match (
      id TEXT PRIMARY KEY, originalFileName TEXT NOT NULL, fileSha256 TEXT NOT NULL,
      map TEXT, status TEXT NOT NULL, quality TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      parserVersion TEXT NOT NULL, normalizerVersion TEXT NOT NULL,
      normalizedFilePath TEXT, rawFilePath TEXT, resultFilePath TEXT,
      resultSchemaVersion TEXT, resultSha256 TEXT, resultPolicyId TEXT,
      resultPolicyDigest TEXT, sourceDeletedAt DATETIME, deletionState TEXT,
      deletionRequestedAt DATETIME, winningTeamId TEXT, losingTeamId TEXT
    );
    CREATE TABLE Job (
      id TEXT PRIMARY KEY, matchId TEXT NOT NULL, type TEXT NOT NULL,
      status TEXT NOT NULL, stage TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
      leaseUntil DATETIME, leaseToken TEXT, errorCode TEXT, errorMessage TEXT,
      requestedScoringVersion TEXT, requestedConfigHash TEXT,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(matchId) REFERENCES Match(id) ON DELETE CASCADE
    );
    CREATE INDEX Job_status_createdAt_idx ON Job(status, createdAt);
    CREATE INDEX Job_leaseUntil_idx ON Job(leaseUntil);
    CREATE TABLE Report (
      id TEXT PRIMARY KEY, matchId TEXT NOT NULL, scoringVersion TEXT NOT NULL,
      configHash TEXT NOT NULL, jsonFilePath TEXT NOT NULL,
      createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, quality TEXT NOT NULL,
      FOREIGN KEY(matchId) REFERENCES Match(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX Report_matchId_scoringVersion_configHash_key
      ON Report(matchId, scoringVersion, configHash);
  `);
  sql.close();

  const datasourceUrl = `file:${databasePath.replaceAll('\\', '/')}`;
  const first = new PrismaClient({ datasourceUrl });
  const second = new PrismaClient({ datasourceUrl });
  clients.push(first, second);
  for (const id of ['match', 'other-match']) {
    await first.match.create({
      data: {
        id,
        originalFileName: `${id}.dem`,
        fileSha256: id === 'match' ? 'a'.repeat(64) : 'b'.repeat(64),
        status: 'COMPLETED',
        quality: 'VALID',
        parserVersion: 'parser',
        normalizerVersion: 'normalizer',
      },
    });
  }
  await first.job.create({
    data: {
      id: 'job',
      matchId: 'match',
      type: 'RESCORE',
      status: 'SCORING',
      stage: 'SCORING',
      attempts: 1,
      leaseToken: 'owner-token',
      leaseUntil: leaseExpiresAt,
    },
  });
  return { first, second };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function reportInput(overrides: Partial<PersistOwnedReportInput> = {}): PersistOwnedReportInput {
  return {
    jobId: 'job',
    matchId: 'match',
    leaseToken: 'owner-token',
    reportId: 'report',
    scoringVersion: 'scoring-v1',
    configHash: 'c'.repeat(64),
    jsonFilePath: 'reports/match/scoring-v1.json.gz',
    quality: 'VALID',
    ...overrides,
  };
}

describe('lease-fenced legacy Report persistence', () => {
  it('creates a Report for the current unexpired owner', async () => {
    const { first } = await fixture();
    await createJobRepository(first, { now: () => whileOwned })
      .persistOwnedReport(reportInput());

    await expect(first.report.findUnique({ where: { id: 'report' } })).resolves.toMatchObject({
      matchId: 'match',
      jsonFilePath: 'reports/match/scoring-v1.json.gz',
      quality: 'VALID',
    });
  });

  it('reuses the existing logical Report without replacing its identity', async () => {
    const { first } = await fixture();
    const repository = createJobRepository(first, { now: () => whileOwned });
    await repository.persistOwnedReport(reportInput());
    await repository.persistOwnedReport(reportInput({ reportId: 'unused-retry-id' }));

    await expect(first.report.findMany()).resolves.toEqual([
      expect.objectContaining({
        id: 'report',
        jsonFilePath: 'reports/match/scoring-v1.json.gz',
      }),
    ]);
  });

  it('rejects an incorrect lease token without creating a Report', async () => {
    const { first } = await fixture();
    await expect(createJobRepository(first, { now: () => whileOwned })
      .persistOwnedReport(reportInput({ leaseToken: 'wrong-token' })))
      .rejects.toThrow('STALE_JOB_OWNER');
    await expect(first.report.count()).resolves.toBe(0);
  });

  it('rejects an expired unchanged lease token without creating a Report', async () => {
    const { first } = await fixture();
    await expect(createJobRepository(first, { now: () => afterExpiry })
      .persistOwnedReport(reportInput()))
      .rejects.toThrow('STALE_JOB_OWNER');
    await expect(first.report.count()).resolves.toBe(0);
  });

  it('does not let a stale owner change an existing Report pointer', async () => {
    const { first } = await fixture();
    await first.report.create({ data: {
      id: 'current-report',
      matchId: 'match',
      scoringVersion: 'scoring-v1',
      configHash: 'c'.repeat(64),
      jsonFilePath: 'reports/match/current.json.gz',
      quality: 'VALID',
    } });

    await expect(createJobRepository(first, { now: () => afterExpiry })
      .persistOwnedReport(reportInput({ jsonFilePath: 'reports/match/stale.json.gz' })))
      .rejects.toThrow('STALE_JOB_OWNER');
    await expect(first.report.findUnique({ where: { id: 'current-report' } }))
      .resolves.toMatchObject({ jsonFilePath: 'reports/match/current.json.gz' });
  });

  it('rejects worker A after worker B reclaimed the lease following A precheck', async () => {
    const { first, second } = await fixture();
    const oldRepository = createJobRepository(first);
    await oldRepository.assertLease('job', 'owner-token', whileOwned);
    const replacement = await createJobRepository(second).claimNextJob(
      { leaseMs: 1_000, maxAttempts: 3 },
      afterExpiry,
    );
    expect(replacement?.leaseToken).not.toBe('owner-token');

    await expect(createJobRepository(first, { now: () => afterExpiry })
      .persistOwnedReport(reportInput()))
      .rejects.toThrow('STALE_JOB_OWNER');
    await expect(first.report.count()).resolves.toBe(0);
  });

  it('rolls back the upsert when ownership expires before commit', async () => {
    const { first } = await fixture();
    const ownershipChecked = deferred();
    const continueTransaction = deferred();
    const clock = [whileOwned, afterExpiry];
    const repository = createJobRepository(first, {
      now: () => clock.shift() ?? afterExpiry,
      afterReportOwnershipCheck: async () => {
        ownershipChecked.resolve();
        await continueTransaction.promise;
      },
    });
    const persistence = repository.persistOwnedReport(reportInput());
    await ownershipChecked.promise;
    continueTransaction.resolve();

    await expect(persistence).rejects.toThrow('STALE_JOB_OWNER');
    await expect(first.report.count()).resolves.toBe(0);
  });

  it('rolls back an upsert when a later transaction step fails', async () => {
    const { first } = await fixture();
    const repository = createJobRepository(first, {
      now: () => whileOwned,
      afterReportUpsert: () => { throw new Error('SYNTHETIC_REPORT_COMMIT_FAILURE'); },
    });

    await expect(repository.persistOwnedReport(reportInput()))
      .rejects.toThrow('SYNTHETIC_REPORT_COMMIT_FAILURE');
    await expect(first.report.count()).resolves.toBe(0);
  });

  it('cannot persist a Report for a match other than the owned Job match', async () => {
    const { first } = await fixture();
    await expect(createJobRepository(first, { now: () => whileOwned })
      .persistOwnedReport(reportInput({ matchId: 'other-match' })))
      .rejects.toThrow('STALE_JOB_OWNER');
    await expect(first.report.count()).resolves.toBe(0);
  });
});
