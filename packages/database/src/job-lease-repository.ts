import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/client/index.js';
import { ACTIVE_JOB_STAGES } from './job-status.js';
import { runSerializedJobWrite } from './serialized-job-write.js';

export interface JobLeasePolicy {
  leaseMs: number;
  maxAttempts: number;
}

export interface ClaimedJob {
  id: string;
  matchId: string;
  type: string;
  leaseToken: string;
  attempt: number;
}

export interface CompleteOwnedJobInput {
  jobId: string;
  matchId: string;
  leaseToken: string;
  terminal: 'COMPLETED' | 'PARTIAL';
  matchData: Record<string, unknown>;
}

export interface PersistOwnedReportInput {
  jobId: string;
  matchId: string;
  leaseToken: string;
  reportId: string;
  scoringVersion: string;
  configHash: string;
  jsonFilePath: string;
  quality: string;
}

export interface JobRepositoryHooks {
  /** Programmatic integration-test seams; production callers use the defaults. */
  now?: () => Date;
  afterReportOwnershipCheck?: () => void | Promise<void>;
  afterReportUpsert?: () => void | Promise<void>;
}

type DatabaseClient = PrismaClient;

function activeStageFor(type: string): string {
  return type === 'RESCORE' ? 'SCORING' : 'PARSING';
}

export function createJobRepository(
  client: DatabaseClient,
  hooks: JobRepositoryHooks = {},
) {
  const currentTime = (): Date => hooks.now?.() ?? new Date();

  async function recoverExpiredJobs(policy: JobLeasePolicy, now = new Date()): Promise<{ requeued: number; failed: number }> {
    const expired = await client.job.findMany({
      where: { status: { in: [...ACTIVE_JOB_STAGES] }, leaseUntil: { lt: now } },
      select: { id: true, matchId: true, type: true, attempts: true, leaseToken: true }
    });
    let requeued = 0;
    let failed = 0;
    for (const job of expired) {
      if (!job.leaseToken) continue;
      if (job.attempts < policy.maxAttempts) {
        const result = await client.job.updateMany({
          where: { id: job.id, leaseToken: job.leaseToken, status: { in: [...ACTIVE_JOB_STAGES] }, leaseUntil: { lt: now } },
          data: {
            status: 'QUEUED', stage: 'QUEUED', leaseUntil: null, leaseToken: null,
            errorCode: 'WORKER_INTERRUPTED_RETRY',
            errorMessage: 'Предыдущий worker был прерван; задача ожидает ограниченного повторного запуска.'
          }
        });
        requeued += result.count;
      } else {
        await client.$transaction(async (transaction) => {
          const result = await transaction.job.updateMany({
            where: { id: job.id, leaseToken: job.leaseToken, status: { in: [...ACTIVE_JOB_STAGES] }, leaseUntil: { lt: now } },
            data: {
              status: 'FAILED', stage: 'FAILED', leaseUntil: null, leaseToken: null,
              errorCode: 'WORKER_RECOVERY_EXHAUSTED', errorMessage: 'Лимит безопасных попыток восстановления исчерпан.'
            }
          });
          if (result.count === 1 && job.type === 'PARSE') {
            await transaction.match.update({ where: { id: job.matchId }, data: { status: 'FAILED', quality: 'UNSUPPORTED' } });
          }
          failed += result.count;
        });
      }
    }
    return { requeued, failed };
  }

  async function claimNextJob(policy: JobLeasePolicy, now = new Date()): Promise<ClaimedJob | null> {
    await recoverExpiredJobs(policy, now);
    const exhausted = await client.job.findMany({
      where: { status: 'QUEUED', attempts: { gte: policy.maxAttempts } }, select: { id: true, matchId: true, type: true }
    });
    for (const job of exhausted) {
      await client.$transaction(async (transaction) => {
        const result = await transaction.job.updateMany({
          where: { id: job.id, status: 'QUEUED', attempts: { gte: policy.maxAttempts } },
          data: { status: 'FAILED', stage: 'FAILED', errorCode: 'WORKER_RECOVERY_EXHAUSTED', errorMessage: 'Лимит безопасных попыток восстановления исчерпан.' }
        });
        if (result.count === 1 && job.type === 'PARSE') {
          await transaction.match.update({ where: { id: job.matchId }, data: { status: 'FAILED', quality: 'UNSUPPORTED' } });
        }
      });
    }
    const candidate = await client.job.findFirst({
      where: { status: 'QUEUED', attempts: { lt: policy.maxAttempts } },
      orderBy: { createdAt: 'asc' }, select: { id: true, matchId: true, type: true, attempts: true }
    });
    if (!candidate) return null;
    const leaseToken = randomUUID();
    const stage = activeStageFor(candidate.type);
    const claimed = await client.job.updateMany({
      where: { id: candidate.id, status: 'QUEUED', leaseToken: null, attempts: candidate.attempts },
      data: {
        status: stage, stage, attempts: { increment: 1 }, leaseToken,
        leaseUntil: new Date(now.getTime() + policy.leaseMs), errorCode: null, errorMessage: null
      }
    });
    return claimed.count === 1
      ? { id: candidate.id, matchId: candidate.matchId, type: candidate.type, leaseToken, attempt: candidate.attempts + 1 }
      : null;
  }

  async function renewLease(jobId: string, leaseToken: string, leaseMs: number, now = new Date()): Promise<boolean> {
    const renewed = await client.job.updateMany({
      where: { id: jobId, leaseToken, status: { in: [...ACTIVE_JOB_STAGES] }, leaseUntil: { gte: now } },
      data: { leaseUntil: new Date(now.getTime() + leaseMs) }
    });
    return renewed.count === 1;
  }

  async function assertLease(jobId: string, leaseToken: string, now = new Date()): Promise<void> {
    const owned = await client.job.count({
      where: { id: jobId, leaseToken, status: { in: [...ACTIVE_JOB_STAGES] }, leaseUntil: { gte: now } }
    });
    if (owned !== 1) throw new Error('STALE_JOB_OWNER');
  }

  async function advanceStage(jobId: string, leaseToken: string, stage: string, leaseMs: number, now = new Date()): Promise<void> {
    const updated = await client.job.updateMany({
      where: { id: jobId, leaseToken, status: { in: [...ACTIVE_JOB_STAGES] }, leaseUntil: { gte: now } },
      data: { status: stage, stage, leaseUntil: new Date(now.getTime() + leaseMs) }
    });
    if (updated.count !== 1) throw new Error('STALE_JOB_OWNER');
  }

  async function releaseLeaseForRetry(
    jobId: string,
    leaseToken: string,
    maxAttempts: number,
    now = new Date(),
  ): Promise<boolean> {
    return client.$transaction(async (transaction) => {
      const job = await transaction.job.findFirst({
        where: {
          id: jobId,
          leaseToken,
          status: { in: [...ACTIVE_JOB_STAGES] },
          leaseUntil: { gte: now },
        },
        select: { attempts: true, matchId: true, type: true },
      });
      if (!job) return false;

      const retry = job.attempts < maxAttempts;
      const updated = await transaction.job.updateMany({
        where: {
          id: jobId,
          leaseToken,
          status: { in: [...ACTIVE_JOB_STAGES] },
          leaseUntil: { gte: now },
        },
        data: retry
          ? {
              status: 'QUEUED', stage: 'QUEUED', leaseUntil: null, leaseToken: null,
              errorCode: 'WORKER_STOPPED_RETRY',
              errorMessage: 'Worker остановлен; задача возвращена в очередь.',
            }
          : {
              status: 'FAILED', stage: 'FAILED', leaseUntil: null, leaseToken: null,
              errorCode: 'WORKER_RECOVERY_EXHAUSTED',
              errorMessage: 'Лимит безопасных попыток восстановления исчерпан.',
            },
      });
      if (updated.count !== 1) return false;
      if (!retry && job.type === 'PARSE') {
        await transaction.match.update({
          where: { id: job.matchId },
          data: { status: 'FAILED', quality: 'UNSUPPORTED' },
        });
      }
      return true;
    });
  }

  async function completeOwnedJob(
    options: CompleteOwnedJobInput,
    now = new Date(),
  ): Promise<void> {
    await client.$transaction(async (transaction) => {
      const ownership = {
        id: options.jobId,
        matchId: options.matchId,
        leaseToken: options.leaseToken,
        status: { in: [...ACTIVE_JOB_STAGES] },
        leaseUntil: { gte: now },
      };
      const owned = await transaction.job.count({ where: ownership });
      if (owned !== 1) throw new Error('STALE_JOB_OWNER');

      await transaction.match.update({
        where: { id: options.matchId },
        data: options.matchData,
      });
      const terminal = await transaction.job.updateMany({
        where: ownership,
        data: {
          status: options.terminal,
          stage: options.terminal,
          leaseUntil: null,
          leaseToken: null,
        },
      });
      if (terminal.count !== 1) throw new Error('STALE_JOB_OWNER');
    });
  }

  async function persistOwnedReport(options: PersistOwnedReportInput): Promise<void> {
    await runSerializedJobWrite(client, async (transaction) => {
      const ownership = () => ({
        id: options.jobId,
        matchId: options.matchId,
        leaseToken: options.leaseToken,
        status: { in: [...ACTIVE_JOB_STAGES] },
        leaseUntil: { gte: currentTime() },
      });
      const assertOwnership = async (): Promise<void> => {
        if (await transaction.job.count({ where: ownership() }) !== 1) {
          throw new Error('STALE_JOB_OWNER');
        }
      };

      await assertOwnership();
      await hooks.afterReportOwnershipCheck?.();
      await transaction.report.upsert({
        where: {
          matchId_scoringVersion_configHash: {
            matchId: options.matchId,
            scoringVersion: options.scoringVersion,
            configHash: options.configHash,
          },
        },
        create: {
          id: options.reportId,
          matchId: options.matchId,
          scoringVersion: options.scoringVersion,
          configHash: options.configHash,
          jsonFilePath: options.jsonFilePath,
          quality: options.quality,
        },
        update: {
          jsonFilePath: options.jsonFilePath,
          quality: options.quality,
        },
      });
      await hooks.afterReportUpsert?.();
      // Recheck expiry as close to commit as possible. The write reservation
      // prevents another owner from changing this Job during the transaction.
      await assertOwnership();
    });
  }

  async function failOwnedJob(
    jobId: string,
    leaseToken: string,
    errorCode: string,
    errorMessage: string,
    now = new Date(),
  ): Promise<boolean> {
    return client.$transaction(async (transaction) => {
      const job = await transaction.job.findFirst({
        where: {
          id: jobId,
          leaseToken,
          status: { in: [...ACTIVE_JOB_STAGES] },
          leaseUntil: { gte: now },
        },
        select: { matchId: true, type: true },
      });
      if (!job) return false;

      const failed = await transaction.job.updateMany({
        where: {
          id: jobId,
          leaseToken,
          status: { in: [...ACTIVE_JOB_STAGES] },
          leaseUntil: { gte: now },
        },
        data: {
          status: 'FAILED',
          stage: 'FAILED',
          leaseUntil: null,
          leaseToken: null,
          errorCode,
          errorMessage,
        },
      });
      if (failed.count !== 1) return false;
      if (job.type === 'PARSE') {
        await transaction.match.update({
          where: { id: job.matchId },
          data: { status: 'FAILED', quality: 'UNSUPPORTED' },
        });
      }
      return true;
    });
  }

  return {
    recoverExpiredJobs,
    claimNextJob,
    renewLease,
    assertLease,
    advanceStage,
    releaseLeaseForRetry,
    completeOwnedJob,
    persistOwnedReport,
    failOwnedJob,
  };
}
