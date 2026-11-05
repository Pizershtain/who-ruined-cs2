import { afterEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/client/index.js';
import {
  createJobRepository,
  type PersistOwnedReportInput,
} from '../src/index.js';
import {
  createPostgresTestDatabase,
  postgresIntegrationAvailable,
  type PostgresTestDatabase,
} from './postgres-test-database.js';

const databases: PostgresTestDatabase[] = [];
const leaseExpiresAt = new Date('2026-11-04T00:00:01.000Z');
const whileOwned = new Date('2026-11-04T00:00:00.500Z');
const afterExpiry = new Date('2026-11-04T00:00:02.000Z');

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

async function fixture(): Promise<{ first: PrismaClient; second: PrismaClient }> {
  const database = await createPostgresTestDatabase(2);
  databases.push(database);
  const [first, second] = database.clients as [PrismaClient, PrismaClient];
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
  await Promise.all(databases.splice(0).map((database) => database.dispose()));
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

describe.skipIf(!postgresIntegrationAvailable)('lease-fenced legacy Report persistence on PostgreSQL', () => {
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
