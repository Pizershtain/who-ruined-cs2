import { randomUUID } from 'node:crypto';
import { PrismaClient } from '../generated/client/index.js';

export const prisma = new PrismaClient();

export const ACTIVE_JOB_STAGES = ['PARSING', 'NORMALIZING', 'VALIDATING', 'FEATURIZING', 'SCORING'] as const;

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

type DatabaseClient = PrismaClient;

function activeStageFor(type: string): string {
  return type === 'RESCORE' ? 'SCORING' : 'PARSING';
}

export function createJobRepository(client: DatabaseClient) {
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

  async function releaseLeaseForRetry(jobId: string, leaseToken: string, maxAttempts: number): Promise<boolean> {
    const job = await client.job.findFirst({ where: { id: jobId, leaseToken }, select: { attempts: true } });
    if (!job) return false;
    const retry = job.attempts < maxAttempts;
    const updated = await client.job.updateMany({
      where: { id: jobId, leaseToken, status: { in: [...ACTIVE_JOB_STAGES] } },
      data: retry
        ? { status: 'QUEUED', stage: 'QUEUED', leaseUntil: null, leaseToken: null, errorCode: 'WORKER_STOPPED_RETRY', errorMessage: 'Worker остановлен; задача возвращена в очередь.' }
        : { status: 'FAILED', stage: 'FAILED', leaseUntil: null, leaseToken: null, errorCode: 'WORKER_RECOVERY_EXHAUSTED', errorMessage: 'Лимит безопасных попыток восстановления исчерпан.' }
    });
    return updated.count === 1;
  }

  return { recoverExpiredJobs, claimNextJob, renewLease, assertLease, advanceStage, releaseLeaseForRetry };
}

const repository = createJobRepository(prisma);
export const recoverExpiredJobs = repository.recoverExpiredJobs;
export const claimNextJob = repository.claimNextJob;
export const renewJobLease = repository.renewLease;
export const assertJobLease = repository.assertLease;
export const advanceJobStage = repository.advanceStage;
export const releaseJobLeaseForRetry = repository.releaseLeaseForRetry;
