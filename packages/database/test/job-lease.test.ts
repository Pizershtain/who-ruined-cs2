import { afterEach, describe, expect, it } from 'vitest';
import { createJobRepository } from '../src/index.js';
import {
  createPostgresTestDatabase,
  postgresIntegrationAvailable,
  type PostgresTestDatabase,
} from './postgres-test-database.js';

const databases: PostgresTestDatabase[] = [];

async function fixture() {
  const database = await createPostgresTestDatabase(2);
  databases.push(database);
  const [first, second] = database.clients;
  await first!.match.create({
    data: {
      id: 'match',
      originalFileName: 'fixture.dem',
      fileSha256: 'a'.repeat(64),
      status: 'QUEUED',
      parserVersion: 'parser',
      normalizerVersion: 'normalizer',
    },
  });
  await first!.job.create({
    data: {
      id: 'job',
      matchId: 'match',
      type: 'PARSE',
      status: 'QUEUED',
      stage: 'QUEUED',
    },
  });
  return { first, second };
}

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.dispose()));
});

describe.skipIf(!postgresIntegrationAvailable)('durable job ownership on PostgreSQL', () => {
  it('assigns PARSE and RESCORE their explicit initial stages', async () => {
    const { first } = await fixture();
    const repository = createJobRepository(first);
    const parse = await repository.claimNextJob({ leaseMs: 30_000, maxAttempts: 3 });
    expect(parse?.type).toBe('PARSE');
    await expect(first.job.findUnique({ where: { id: 'job' } })).resolves.toMatchObject({
      status: 'PARSING',
      stage: 'PARSING',
    });

    await first.job.create({
      data: {
        id: 'rescore-job',
        matchId: 'match',
        type: 'RESCORE',
        status: 'QUEUED',
        stage: 'QUEUED',
      },
    });
    const rescore = await repository.claimNextJob({ leaseMs: 30_000, maxAttempts: 3 });
    expect(rescore?.type).toBe('RESCORE');
    await expect(first.job.findUnique({ where: { id: 'rescore-job' } }))
      .resolves.toMatchObject({ status: 'SCORING', stage: 'SCORING' });
  });

  it('terminally rejects an unknown queued type without changing its match', async () => {
    const { first } = await fixture();
    await first.job.update({
      where: { id: 'job' },
      data: {
        type: 'HISTORICAL_UNKNOWN',
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    });

    await expect(createJobRepository(first).claimNextJob({
      leaseMs: 30_000,
      maxAttempts: 3,
    })).resolves.toBeNull();
    await expect(first.job.findUnique({ where: { id: 'job' } })).resolves.toMatchObject({
      status: 'FAILED',
      stage: 'FAILED',
      attempts: 0,
      leaseToken: null,
      errorCode: 'UNSUPPORTED_JOB_TYPE',
    });
    await expect(first.match.findUnique({ where: { id: 'match' } })).resolves.toMatchObject({
      status: 'QUEUED',
      quality: null,
    });
  });

  it('skips an invalid queued type and still claims the next supported job', async () => {
    const { first } = await fixture();
    await first.job.update({
      where: { id: 'job' },
      data: {
        type: 'HISTORICAL_UNKNOWN',
        createdAt: new Date('2020-01-01T00:00:00.000Z'),
      },
    });
    await first.job.create({
      data: {
        id: 'valid-job',
        matchId: 'match',
        type: 'RESCORE',
        status: 'QUEUED',
        stage: 'QUEUED',
      },
    });

    const claimed = await createJobRepository(first).claimNextJob({
      leaseMs: 30_000,
      maxAttempts: 3,
    });
    expect(claimed).toMatchObject({ id: 'valid-job', type: 'RESCORE' });
    await expect(first.job.findUnique({ where: { id: 'job' } })).resolves.toMatchObject({
      status: 'FAILED',
      errorCode: 'UNSUPPORTED_JOB_TYPE',
    });
  });

  it('terminally rejects an expired unknown active type without requeueing it', async () => {
    const { first } = await fixture();
    await first.job.update({
      where: { id: 'job' },
      data: {
        type: 'HISTORICAL_UNKNOWN',
        status: 'PARSING',
        stage: 'PARSING',
        leaseToken: 'old-owner',
        leaseUntil: new Date('2026-01-01T00:00:00.000Z'),
      },
    });

    await expect(createJobRepository(first).recoverExpiredJobs(
      { leaseMs: 1_000, maxAttempts: 3 },
      new Date('2026-01-01T00:00:01.000Z'),
    )).resolves.toEqual({ requeued: 0, failed: 1 });
    await expect(first.job.findUnique({ where: { id: 'job' } })).resolves.toMatchObject({
      status: 'FAILED',
      errorCode: 'UNSUPPORTED_JOB_TYPE',
      leaseToken: null,
    });
    await expect(first.match.findUnique({ where: { id: 'match' } })).resolves.toMatchObject({
      status: 'QUEUED',
      quality: null,
    });
  });

  it('allows only one of two workers to claim one queued job', async () => {
    const { first, second } = await fixture();
    const policy = { leaseMs: 30_000, maxAttempts: 3 };
    const [a, b] = await Promise.all([
      createJobRepository(first).claimNextJob(policy),
      createJobRepository(second).claimNextJob(policy)
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((a ?? b)?.attempt).toBe(1);
  });

  it('reclaims an expired lease and fences the late former owner', async () => {
    const { first, second } = await fixture();
    const policy = { leaseMs: 1_000, maxAttempts: 3 };
    const old = await createJobRepository(first).claimNextJob(policy, new Date('2026-01-01T00:00:00.000Z'));
    expect(old).not.toBeNull();
    const replacement = await createJobRepository(second).claimNextJob(policy, new Date('2026-01-01T00:00:02.000Z'));
    expect(replacement?.attempt).toBe(2);
    await expect(createJobRepository(first).advanceStage('job', old!.leaseToken, 'SCORING', 1_000, new Date('2026-01-01T00:00:02.100Z')))
      .rejects.toThrow('STALE_JOB_OWNER');
    await expect(createJobRepository(second).advanceStage('job', replacement!.leaseToken, 'NORMALIZING', 1_000, new Date('2026-01-01T00:00:02.100Z')))
      .resolves.toBeUndefined();
  });

  it('rejects every ownership operation after expiry even while the token is unchanged', async () => {
    const { first } = await fixture();
    const repository = createJobRepository(first);
    const claimed = await repository.claimNextJob(
      { leaseMs: 1_000, maxAttempts: 3 },
      new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(claimed).not.toBeNull();
    const expiredAt = new Date('2026-01-01T00:00:02.000Z');

    await expect(repository.renewLease('job', claimed!.leaseToken, 1_000, expiredAt))
      .resolves.toBe(false);
    await expect(repository.assertLease('job', claimed!.leaseToken, expiredAt))
      .rejects.toThrow('STALE_JOB_OWNER');
    await expect(repository.advanceStage('job', claimed!.leaseToken, 'SCORING', 1_000, expiredAt))
      .rejects.toThrow('STALE_JOB_OWNER');
    await expect(repository.completeOwnedJob({
      jobId: 'job',
      matchId: 'match',
      leaseToken: claimed!.leaseToken,
      terminal: 'COMPLETED',
      matchData: { status: 'COMPLETED' },
    }, expiredAt)).rejects.toThrow('STALE_JOB_OWNER');
    await expect(repository.failOwnedJob(
      'job', claimed!.leaseToken, 'EXPIRED', 'expired owner', expiredAt,
    )).resolves.toBe(false);
    await expect(repository.releaseLeaseForRetry(
      'job',
      claimed!.leaseToken,
      3,
      expiredAt,
    )).resolves.toBe(false);
    await expect(first.job.findUnique({ where: { id: 'job' } })).resolves.toMatchObject({
      status: 'PARSING',
      leaseToken: claimed!.leaseToken,
    });
  });

  it('terminally fails an expired job after its finite attempt budget', async () => {
    const { first } = await fixture();
    await first.job.update({
      where: { id: 'job' },
      data: { status: 'PARSING', stage: 'PARSING', attempts: 3, leaseToken: 'old', leaseUntil: new Date('2026-01-01T00:00:00.000Z') }
    });
    const result = await createJobRepository(first).recoverExpiredJobs({ leaseMs: 1_000, maxAttempts: 3 }, new Date('2026-01-01T00:00:01.000Z'));
    expect(result).toEqual({ requeued: 0, failed: 1 });
    await expect(first.job.findUnique({ where: { id: 'job' } })).resolves.toMatchObject({ status: 'FAILED', errorCode: 'WORKER_RECOVERY_EXHAUSTED', leaseToken: null });
    await expect(first.match.findUnique({ where: { id: 'match' } })).resolves.toMatchObject({ status: 'FAILED', quality: 'UNSUPPORTED' });
  });

  it('never claims a queued job after its finite attempt budget', async () => {
    const { first } = await fixture();
    await first.job.update({
      where: { id: 'job' },
      data: { attempts: 3 },
    });
    await expect(createJobRepository(first).claimNextJob({ leaseMs: 1_000, maxAttempts: 3 }))
      .resolves.toBeNull();
    await expect(first.job.findUnique({ where: { id: 'job' } })).resolves.toMatchObject({
      status: 'FAILED',
      errorCode: 'WORKER_RECOVERY_EXHAUSTED',
      attempts: 3,
    });
    await expect(first.match.findUnique({ where: { id: 'match' } })).resolves.toMatchObject({
      status: 'FAILED',
      quality: 'UNSUPPORTED',
    });
  });

  it('fences complete, fail and release from a superseded worker', async () => {
    const { first, second } = await fixture();
    const policy = { leaseMs: 1_000, maxAttempts: 3 };
    const oldRepository = createJobRepository(first);
    const newRepository = createJobRepository(second);
    const old = await oldRepository.claimNextJob(
      policy,
      new Date('2026-01-01T00:00:00.000Z'),
    );
    const replacement = await newRepository.claimNextJob(
      policy,
      new Date('2026-01-01T00:00:02.000Z'),
    );
    expect(replacement?.attempt).toBe(2);
    const currentTime = new Date('2026-01-01T00:00:02.100Z');

    await expect(oldRepository.completeOwnedJob({
      jobId: 'job',
      matchId: 'match',
      leaseToken: old!.leaseToken,
      terminal: 'COMPLETED',
      matchData: { status: 'COMPLETED' },
    }, currentTime)).rejects.toThrow('STALE_JOB_OWNER');
    await expect(oldRepository.failOwnedJob(
      'job', old!.leaseToken, 'OLD_FAILURE', 'late old worker', currentTime,
    )).resolves.toBe(false);
    await expect(oldRepository.releaseLeaseForRetry(
      'job', old!.leaseToken, policy.maxAttempts, currentTime,
    )).resolves.toBe(false);
    await expect(newRepository.completeOwnedJob({
      jobId: 'job',
      matchId: 'match',
      leaseToken: replacement!.leaseToken,
      terminal: 'COMPLETED',
      matchData: {
        status: 'COMPLETED',
        quality: 'VALID',
        resultFilePath: 'results/match/current.json.gz',
      },
    }, currentTime)).resolves.toBeUndefined();
    await expect(newRepository.failOwnedJob(
      'job',
      replacement!.leaseToken,
      'POST_COMMIT_CLEANUP_FAILED',
      'synthetic cleanup failure',
      currentTime,
    )).resolves.toBe(false);
    await expect(newRepository.releaseLeaseForRetry(
      'job',
      replacement!.leaseToken,
      policy.maxAttempts,
      currentTime,
    )).resolves.toBe(false);

    await expect(second.job.findUnique({ where: { id: 'job' } })).resolves.toMatchObject({
      status: 'COMPLETED',
      leaseToken: null,
      errorCode: null,
    });
    await expect(second.match.findUnique({ where: { id: 'match' } })).resolves.toMatchObject({
      status: 'COMPLETED',
      quality: 'VALID',
      resultFilePath: 'results/match/current.json.gz',
    });
  });

  it('atomically fails both PARSE job and match when shutdown exhausts attempts', async () => {
    const { first } = await fixture();
    const repository = createJobRepository(first);
    const claimed = await repository.claimNextJob(
      { leaseMs: 1_000, maxAttempts: 1 },
      new Date('2026-01-01T00:00:00.000Z'),
    );
    await expect(repository.releaseLeaseForRetry(
      'job',
      claimed!.leaseToken,
      1,
      new Date('2026-01-01T00:00:00.500Z'),
    )).resolves.toBe(true);
    await expect(first.job.findUnique({ where: { id: 'job' } })).resolves.toMatchObject({
      status: 'FAILED',
      errorCode: 'WORKER_RECOVERY_EXHAUSTED',
      leaseToken: null,
    });
    await expect(first.match.findUnique({ where: { id: 'match' } })).resolves.toMatchObject({
      status: 'FAILED',
      quality: 'UNSUPPORTED',
    });
  });

  it('atomically records a pre-commit PARSE failure on both job and match', async () => {
    const { first } = await fixture();
    const repository = createJobRepository(first);
    const claimed = await repository.claimNextJob(
      { leaseMs: 1_000, maxAttempts: 3 },
      new Date('2026-01-01T00:00:00.000Z'),
    );
    await expect(repository.failOwnedJob(
      'job',
      claimed!.leaseToken,
      'PARSE_FAILED',
      'synthetic pre-commit failure',
      new Date('2026-01-01T00:00:00.500Z'),
    )).resolves.toBe(true);

    await expect(first.job.findUnique({ where: { id: 'job' } })).resolves.toMatchObject({
      status: 'FAILED',
      errorCode: 'PARSE_FAILED',
      leaseToken: null,
    });
    await expect(first.match.findUnique({ where: { id: 'match' } })).resolves.toMatchObject({
      status: 'FAILED',
      quality: 'UNSUPPORTED',
    });
  });

  it('fails a RESCORE job without damaging the previously completed match', async () => {
    const { first } = await fixture();
    await first.match.update({
      where: { id: 'match' },
      data: { status: 'COMPLETED', quality: 'VALID', resultFilePath: 'results/stable.json.gz' },
    });
    await first.job.update({ where: { id: 'job' }, data: { type: 'RESCORE' } });
    const repository = createJobRepository(first);
    const claimed = await repository.claimNextJob(
      { leaseMs: 1_000, maxAttempts: 3 },
      new Date('2026-01-01T00:00:00.000Z'),
    );
    await expect(repository.failOwnedJob(
      'job',
      claimed!.leaseToken,
      'SCORING_FAILED',
      'synthetic rescore failure',
      new Date('2026-01-01T00:00:00.500Z'),
    )).resolves.toBe(true);

    await expect(first.job.findUnique({ where: { id: 'job' } })).resolves.toMatchObject({
      status: 'FAILED',
      errorCode: 'SCORING_FAILED',
    });
    await expect(first.match.findUnique({ where: { id: 'match' } })).resolves.toMatchObject({
      status: 'COMPLETED',
      quality: 'VALID',
      resultFilePath: 'results/stable.json.gz',
    });
  });

});
