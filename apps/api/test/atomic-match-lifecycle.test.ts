import { afterEach, describe, expect, it } from 'vitest';
import {
  PrismaClient,
  UNFINISHED_JOB_STATUSES,
} from '@who-ruined/database';
import {
  createPostgresTestDatabase,
  postgresIntegrationAvailable,
  type PostgresTestDatabase,
} from '../../../packages/database/test/postgres-test-database.js';
import { PrismaApiRepository } from '../src/infrastructure/prisma-api-repository.js';

type AtomicOperation = 'UPLOAD' | 'RESCORE' | 'DELETE';
type TransactionCheckpoint =
  | 'BEFORE_WRITE_LOCK'
  | 'AFTER_WRITE_LOCK'
  | 'AFTER_UPLOAD_MATCH_CREATED';
type CheckpointHook = (
  checkpoint: TransactionCheckpoint,
  operation: AtomicOperation,
) => void | Promise<void>;

const databases: PostgresTestDatabase[] = [];
const now = new Date('2026-11-04T00:00:00.000Z');

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

class TestPrismaApiRepository extends PrismaApiRepository {
  constructor(
    private readonly client: PrismaClient,
    private readonly hook: CheckpointHook = () => undefined,
  ) {
    super();
  }

  protected override databaseClient(): PrismaClient {
    return this.client;
  }

  protected override transactionCheckpoint(
    checkpoint: TransactionCheckpoint,
    operation: AtomicOperation,
  ): void | Promise<void> {
    return this.hook(checkpoint, operation);
  }
}

async function fixture(): Promise<{
  first: PrismaClient;
  second: PrismaClient;
}> {
  const database = await createPostgresTestDatabase(2);
  databases.push(database);
  const [first, second] = database.clients as [PrismaClient, PrismaClient];
  return { first, second };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.dispose()));
});

async function seedMatch(
  client: PrismaClient,
  id: string,
  digest: string,
  options: { deleting?: boolean; source?: boolean } = {},
): Promise<void> {
  await client.match.create({
    data: {
      id,
      originalFileName: `${id}.dem`,
      fileSha256: digest,
      status: 'COMPLETED',
      quality: 'VALID',
      parserVersion: 'parser',
      normalizerVersion: 'normalizer',
      normalizedFilePath: options.source === false ? null : `cache/${id}.json.gz`,
      resultFilePath: options.source === false ? null : `results/${id}.json.gz`,
      deletionState: options.deleting ? 'DELETING' : null,
      deletionRequestedAt: options.deleting ? now : null,
    },
  });
}

function uploadInput(id: string, digest: string) {
  return {
    matchId: id,
    jobId: `job-${id}`,
    originalFileName: `${id}.dem`,
    fileSha256: digest,
    parserVersion: 'parser',
    normalizerVersion: 'normalizer',
    rawFilePath: `uploads/${id}.dem`,
  };
}

function rescoreInput(id: string, suffix: string) {
  return {
    jobId: `rescore-${id}-${suffix}`,
    matchId: id,
    scoringVersion: `scoring-${suffix}`,
    configHash: suffix.repeat(64).slice(0, 64),
  };
}

function coordinatedRepositories(
  firstClient: PrismaClient,
  secondClient: PrismaClient,
): {
  first: PrismaApiRepository;
  second: PrismaApiRepository;
  firstLocked: Promise<void>;
  secondStarted: Promise<void>;
  releaseFirst: () => void;
} {
  const firstLocked = deferred();
  const releaseFirst = deferred();
  const secondStarted = deferred();
  let holdFirst = true;
  const first = new TestPrismaApiRepository(firstClient, async (checkpoint) => {
    if (checkpoint !== 'AFTER_WRITE_LOCK' || !holdFirst) return;
    holdFirst = false;
    firstLocked.resolve();
    await releaseFirst.promise;
  });
  const second = new TestPrismaApiRepository(secondClient, (checkpoint) => {
    if (checkpoint === 'BEFORE_WRITE_LOCK') secondStarted.resolve();
  });
  return {
    first,
    second,
    firstLocked: firstLocked.promise,
    secondStarted: secondStarted.promise,
    releaseFirst: releaseFirst.resolve,
  };
}

async function unfinishedJobCount(client: PrismaClient): Promise<number> {
  return client.job.count({
    where: { status: { in: [...UNFINISHED_JOB_STATUSES] } },
  });
}

describe.skipIf(!postgresIntegrationAvailable)('atomic queue admission on PostgreSQL', () => {
  it('admits only one of two concurrent uploads into one free slot', async () => {
    const { first: firstClient, second: secondClient } = await fixture();
    const coordination = coordinatedRepositories(firstClient, secondClient);
    const firstAdmission = coordination.first.admitUploadedMatch(uploadInput('a', 'a'.repeat(64)), 1);
    await coordination.firstLocked;
    const secondAdmission = coordination.second.admitUploadedMatch(uploadInput('b', 'b'.repeat(64)), 1);
    await coordination.secondStarted;
    coordination.releaseFirst();

    const results = await Promise.all([firstAdmission, secondAdmission]);
    expect(results.map((result) => result.kind).sort()).toEqual(['ADMITTED', 'QUEUE_SATURATED']);
    await expect(firstClient.match.count()).resolves.toBe(1);
    await expect(unfinishedJobCount(firstClient)).resolves.toBe(1);
  });

  it('admits only one of two different concurrent rescores into one free slot', async () => {
    const { first: firstClient, second: secondClient } = await fixture();
    await seedMatch(firstClient, 'a', 'a'.repeat(64));
    await seedMatch(firstClient, 'b', 'b'.repeat(64));
    const coordination = coordinatedRepositories(firstClient, secondClient);
    const firstAdmission = coordination.first.admitRescore(rescoreInput('a', 'a'), 1);
    await coordination.firstLocked;
    const secondAdmission = coordination.second.admitRescore(rescoreInput('b', 'b'), 1);
    await coordination.secondStarted;
    coordination.releaseFirst();

    const results = await Promise.all([firstAdmission, secondAdmission]);
    expect(results.map((result) => result.kind).sort()).toEqual(['ADMITTED', 'QUEUE_SATURATED']);
    await expect(unfinishedJobCount(firstClient)).resolves.toBe(1);
  });

  it('makes upload and rescore share the same one-slot capacity', async () => {
    const { first: firstClient, second: secondClient } = await fixture();
    await seedMatch(firstClient, 'stored', 's'.repeat(64));
    const coordination = coordinatedRepositories(firstClient, secondClient);
    const upload = coordination.first.admitUploadedMatch(uploadInput('new', 'n'.repeat(64)), 1);
    await coordination.firstLocked;
    const rescore = coordination.second.admitRescore(rescoreInput('stored', 'r'), 1);
    await coordination.secondStarted;
    coordination.releaseFirst();

    const results = await Promise.all([upload, rescore]);
    expect(results.map((result) => result.kind).sort()).toEqual(['ADMITTED', 'QUEUE_SATURATED']);
    await expect(unfinishedJobCount(firstClient)).resolves.toBe(1);
  });

  it('returns queue saturation without partial rows when capacity is already full', async () => {
    const { first } = await fixture();
    await seedMatch(first, 'active', 'a'.repeat(64));
    await first.job.create({
      data: { id: 'active-job', matchId: 'active', type: 'PARSE', status: 'QUEUED', stage: 'QUEUED' },
    });
    await seedMatch(first, 'stored', 's'.repeat(64));
    const repository = new TestPrismaApiRepository(first);

    await expect(repository.admitUploadedMatch(uploadInput('new', 'n'.repeat(64)), 1))
      .resolves.toEqual({ kind: 'QUEUE_SATURATED' });
    await expect(repository.admitRescore(rescoreInput('stored', 'r'), 1))
      .resolves.toEqual({ kind: 'QUEUE_SATURATED' });
    await expect(first.match.findUnique({ where: { id: 'new' } })).resolves.toBeNull();
    await expect(unfinishedJobCount(first)).resolves.toBe(1);
  });
});

describe.skipIf(!postgresIntegrationAvailable)('atomic match lifecycle on PostgreSQL', () => {
  it('collapses concurrent identical uploads and keeps one Match and Job', async () => {
    const { first: firstClient, second: secondClient } = await fixture();
    const coordination = coordinatedRepositories(firstClient, secondClient);
    const digest = 'd'.repeat(64);
    const firstAdmission = coordination.first.admitUploadedMatch(uploadInput('first', digest), 4);
    await coordination.firstLocked;
    const secondAdmission = coordination.second.admitUploadedMatch(uploadInput('second', digest), 4);
    await coordination.secondStarted;
    coordination.releaseFirst();

    const results = await Promise.all([firstAdmission, secondAdmission]);
    expect(results.map((result) => result.kind).sort()).toEqual(['ADMITTED', 'DUPLICATE']);
    await expect(firstClient.match.count()).resolves.toBe(1);
    await expect(firstClient.job.count()).resolves.toBe(1);
  });

  it('does not return a deleting duplicate as a usable upload result', async () => {
    const { first } = await fixture();
    const digest = 'd'.repeat(64);
    await seedMatch(first, 'deleting', digest, { deleting: true });

    await expect(new TestPrismaApiRepository(first).admitUploadedMatch(
      uploadInput('replacement', digest),
      4,
    )).resolves.toEqual({ kind: 'DUPLICATE_DELETING' });
    await expect(first.match.count()).resolves.toBe(1);
    await expect(first.job.count()).resolves.toBe(0);
  });

  it('collapses identical active rescores and allows another after completion', async () => {
    const { first: firstClient, second: secondClient } = await fixture();
    await seedMatch(firstClient, 'stored', 's'.repeat(64));
    const coordination = coordinatedRepositories(firstClient, secondClient);
    const firstAdmission = coordination.first.admitRescore(rescoreInput('stored', 'a'), 4);
    await coordination.firstLocked;
    const secondAdmission = coordination.second.admitRescore({
      ...rescoreInput('stored', 'a'),
      jobId: 'duplicate-request-job',
    }, 4);
    await coordination.secondStarted;
    coordination.releaseFirst();

    const [firstResult, secondResult] = await Promise.all([firstAdmission, secondAdmission]);
    expect(firstResult).toEqual({ kind: 'ADMITTED', jobId: 'rescore-stored-a' });
    expect(secondResult).toEqual({ kind: 'DUPLICATE', jobId: 'rescore-stored-a' });
    await firstClient.job.update({
      where: { id: 'rescore-stored-a' },
      data: { status: 'COMPLETED', stage: 'COMPLETED' },
    });
    await expect(new TestPrismaApiRepository(secondClient).admitRescore({
      ...rescoreInput('stored', 'a'),
      jobId: 'rescore-after-completion',
    }, 4)).resolves.toEqual({ kind: 'ADMITTED', jobId: 'rescore-after-completion' });
    await expect(firstClient.job.count({ where: { type: 'RESCORE' } })).resolves.toBe(2);
  });

  it('serializes delete before rescore so no job can appear after DELETING', async () => {
    const { first: firstClient, second: secondClient } = await fixture();
    await seedMatch(firstClient, 'stored', 's'.repeat(64));
    const coordination = coordinatedRepositories(firstClient, secondClient);
    const deletion = coordination.first.beginMatchDeletion('stored', now);
    await coordination.firstLocked;
    const rescore = coordination.second.admitRescore(rescoreInput('stored', 'r'), 4);
    await coordination.secondStarted;
    coordination.releaseFirst();

    await expect(deletion).resolves.toMatchObject({ kind: 'READY' });
    await expect(rescore).resolves.toEqual({ kind: 'MATCH_NOT_FOUND' });
    await expect(firstClient.job.count()).resolves.toBe(0);
    await expect(firstClient.match.findUnique({ where: { id: 'stored' } }))
      .resolves.toMatchObject({ deletionState: 'DELETING' });
  });

  it('serializes rescore before delete so deletion sees the unfinished Job', async () => {
    const { first: firstClient, second: secondClient } = await fixture();
    await seedMatch(firstClient, 'stored', 's'.repeat(64));
    const coordination = coordinatedRepositories(firstClient, secondClient);
    const rescore = coordination.first.admitRescore(rescoreInput('stored', 'r'), 4);
    await coordination.firstLocked;
    const deletion = coordination.second.beginMatchDeletion('stored', now);
    await coordination.secondStarted;
    coordination.releaseFirst();

    await expect(rescore).resolves.toEqual({
      kind: 'ADMITTED',
      jobId: 'rescore-stored-r',
    });
    await expect(deletion).resolves.toEqual({ kind: 'MATCH_ACTIVE' });
    await expect(firstClient.job.count()).resolves.toBe(1);
    await expect(firstClient.match.findUnique({ where: { id: 'stored' } }))
      .resolves.toMatchObject({ deletionState: null });
  });

  it('rejects rescore after DELETING was already committed', async () => {
    const { first } = await fixture();
    await seedMatch(first, 'stored', 's'.repeat(64), { deleting: true });

    await expect(new TestPrismaApiRepository(first).admitRescore(
      rescoreInput('stored', 'r'),
      4,
    )).resolves.toEqual({ kind: 'MATCH_NOT_FOUND' });
    await expect(first.job.count()).resolves.toBe(0);
  });

  it('makes parallel deletes idempotent through final database removal', async () => {
    const { first: firstClient, second: secondClient } = await fixture();
    await seedMatch(firstClient, 'stored', 's'.repeat(64));
    await firstClient.report.create({
      data: {
        id: 'report',
        matchId: 'stored',
        scoringVersion: 'scoring',
        configHash: 'c'.repeat(64),
        jsonFilePath: 'reports/stored/report.json.gz',
        quality: 'VALID',
      },
    });
    const coordination = coordinatedRepositories(firstClient, secondClient);
    const firstDelete = coordination.first.beginMatchDeletion('stored', now);
    await coordination.firstLocked;
    const secondDelete = coordination.second.beginMatchDeletion('stored', now);
    await coordination.secondStarted;
    coordination.releaseFirst();

    const results = await Promise.all([firstDelete, secondDelete]);
    expect(results).toEqual([
      expect.objectContaining({ kind: 'READY' }),
      expect.objectContaining({ kind: 'READY' }),
    ]);
    expect(results[0]).toEqual(results[1]);
    await expect(Promise.all([
      coordination.first.completeMatchDeletion('stored'),
      coordination.second.completeMatchDeletion('stored'),
    ])).resolves.toEqual([{ kind: 'COMPLETED' }, { kind: 'COMPLETED' }]);
    await expect(firstClient.match.findUnique({ where: { id: 'stored' } })).resolves.toBeNull();
  });

  it('rolls back Match creation when admission fails before Job creation', async () => {
    const { first } = await fixture();
    const repository = new TestPrismaApiRepository(first, (checkpoint) => {
      if (checkpoint === 'AFTER_UPLOAD_MATCH_CREATED') {
        throw new Error('SYNTHETIC_ADMISSION_FAILURE');
      }
    });

    await expect(repository.admitUploadedMatch(uploadInput('failed', 'f'.repeat(64)), 4))
      .rejects.toThrow('SYNTHETIC_ADMISSION_FAILURE');
    await expect(first.match.count()).resolves.toBe(0);
    await expect(first.job.count()).resolves.toBe(0);
  });
});
