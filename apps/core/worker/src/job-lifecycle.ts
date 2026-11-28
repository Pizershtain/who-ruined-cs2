import { rm } from 'node:fs/promises';
import {
  ACTIVE_JOB_STAGES,
  advanceJobStage,
  prisma,
  type ActiveJobStage,
} from '@who-ruined/database';
import type { WorkerRuntimeConfig } from './runtime-config.js';
import { assertNoSymlinkComponents, resolveDataPath } from './storage.js';

export interface JobFaultHooks {
  afterStage?: (stage: string) => Promise<void> | void;
  beforeSourceDelete?: () => Promise<void> | void;
}

export async function reachOwnedStage(
  jobId: string,
  leaseToken: string,
  stage: ActiveJobStage,
  config: WorkerRuntimeConfig,
  hooks?: JobFaultHooks,
): Promise<void> {
  await advanceJobStage(jobId, leaseToken, stage, config.leaseMs);
  await hooks?.afterStage?.(stage);
}

export async function runPostCommitCleanup(
  failureEvent: string,
  cleanup: () => Promise<void>,
): Promise<boolean> {
  try {
    await cleanup();
    return true;
  } catch (error) {
    console.warn(JSON.stringify({
      level: 'warn',
      event: failureEvent,
      code: error instanceof Error ? error.message : 'POST_COMMIT_CLEANUP_FAILED',
    }));
    return false;
  }
}

export async function cleanupRawAfterPublication(
  dataRoot: string,
  matchId: string,
  rawFilePath: string,
  hooks?: JobFaultHooks,
): Promise<boolean> {
  const ready = await prisma.match.findUnique({
    where: { id: matchId },
    select: {
      resultFilePath: true,
      resultSha256: true,
      rawFilePath: true,
      status: true,
    },
  });
  if (
    !ready?.resultFilePath
    || !ready.resultSha256
    || ready.rawFilePath !== rawFilePath
    || !['COMPLETED', 'PARTIAL'].includes(ready.status)
  ) {
    return false;
  }
  const activeJobs = await prisma.job.count({
    where: { matchId, status: { in: [...ACTIVE_JOB_STAGES] } },
  });
  const shared = await prisma.match.count({
    where: { rawFilePath, id: { not: matchId } },
  });
  if (activeJobs > 0 || shared > 0) return false;
  const rawTarget = resolveDataPath(dataRoot, rawFilePath);
  await assertNoSymlinkComponents(dataRoot, rawTarget);
  await hooks?.beforeSourceDelete?.();
  await rm(rawTarget, { force: true });
  await hooks?.afterStage?.('RAW_DELETED');
  await prisma.match.updateMany({
    where: {
      id: matchId,
      rawFilePath,
      resultFilePath: ready.resultFilePath,
      resultSha256: ready.resultSha256,
    },
    data: { rawFilePath: null, sourceDeletedAt: new Date() },
  });
  return true;
}
