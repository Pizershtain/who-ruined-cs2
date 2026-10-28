import { claimNextJob, prisma, recoverExpiredJobs, releaseJobLeaseForRetry, renewJobLease } from '@who-ruined/database';
import { processJob } from './process-job.js';
import { resolveWorkerRuntimeConfig } from './runtime-config.js';
import { reconcileDeletingMatches, reconcileOrphanedMatchResults, reconcilePublishedSourceCleanup, reconcileWorkerTemp } from './reconcile.js';
import path from 'node:path';

const config = resolveWorkerRuntimeConfig();
const dataRoot = path.resolve(process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'));
await recoverExpiredJobs({ leaseMs: config.leaseMs, maxAttempts: config.maxJobAttempts });
const reconciliation = await reconcileWorkerTemp(dataRoot);
if (reconciliation.removed > 0) console.log(JSON.stringify({ level: 'info', event: 'artifactDiscarded', count: reconciliation.removed }));
const orphanedResults = await reconcileOrphanedMatchResults(dataRoot);
if (orphanedResults.removed > 0) console.log(JSON.stringify({ level: 'info', event: 'orphanedResultDiscarded', count: orphanedResults.removed }));
const deletedMatches = await reconcileDeletingMatches(dataRoot);
if (deletedMatches > 0) console.log(JSON.stringify({ level: 'info', event: 'matchDeletionReconciled', count: deletedMatches }));
const sourceCleanup = await reconcilePublishedSourceCleanup(dataRoot, config.retainSourceDemo);
if (sourceCleanup.removed > 0) console.log(JSON.stringify({ level: 'info', event: 'sourceCleanupReconciled', count: sourceCleanup.removed }));
let stopping = false;
let activeAbort: AbortController | null = null;

const stop = () => {
  stopping = true;
  activeAbort?.abort();
};
process.once('SIGTERM', stop);
process.once('SIGINT', stop);

while (!stopping) {
  const job = await claimNextJob({ leaseMs: config.leaseMs, maxAttempts: config.maxJobAttempts });
  if (!job) {
    await new Promise((resolve) => setTimeout(resolve, config.pollMs));
    continue;
  }
  console.log(JSON.stringify({ level: 'info', event: 'jobClaimed', type: job.type, attempt: job.attempt }));
  if (job.attempt > 1) console.log(JSON.stringify({ level: 'info', event: 'jobRecovered', type: job.type, attempt: job.attempt }));
  activeAbort = new AbortController();
  let renewing = false;
  const heartbeat = setInterval(async () => {
    if (renewing || activeAbort?.signal.aborted) return;
    renewing = true;
    try {
      const renewed = await renewJobLease(job.id, job.leaseToken, config.leaseMs);
      if (!renewed) activeAbort?.abort();
    } catch {
      activeAbort?.abort();
    } finally {
      renewing = false;
    }
  }, config.heartbeatMs);
  heartbeat.unref();
  try {
    await processJob(job.id, job.matchId, job.leaseToken, { signal: activeAbort.signal, config });
  } finally {
    clearInterval(heartbeat);
    if (stopping) await releaseJobLeaseForRetry(job.id, job.leaseToken, config.maxJobAttempts);
    const reconciled = await reconcileOrphanedMatchResults(dataRoot);
    if (reconciled.removed > 0) console.log(JSON.stringify({ level: 'info', event: 'orphanedResultDiscarded', count: reconciled.removed }));
    activeAbort = null;
  }
}
await prisma.$disconnect();
