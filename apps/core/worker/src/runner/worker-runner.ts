import type { resolveWorkerRuntimeConfig } from '../runtime-config.js';
import type { workerDependencies } from './worker-dependencies.js';

type WorkerRuntimeConfig = ReturnType<typeof resolveWorkerRuntimeConfig>;
type WorkerDependencies = typeof workerDependencies;

export interface WorkerRunnerOptions {
  config: WorkerRuntimeConfig;
  dataRoot: string;
  dependencies: WorkerDependencies;
}

type ClaimedJob = Awaited<ReturnType<WorkerDependencies['claimNextJob']>> & {};

interface ActiveJobAttempt {
  abortController: AbortController;
  stopHeartbeat: () => Promise<void>;
}

function startJobAttempt(
  job: ClaimedJob,
  config: WorkerRuntimeConfig,
  dependencies: WorkerDependencies,
): ActiveJobAttempt {
  const abortController = new AbortController();
  let stopped = false;
  let inFlightRenewal: Promise<void> | null = null;

  const renew = (): void => {
    if (stopped || inFlightRenewal || abortController.signal.aborted) return;
    const renewal = dependencies.renewJobLease(job.id, job.leaseToken, config.leaseMs)
      .then((renewed) => {
        if (!renewed && !stopped) abortController.abort();
      })
      .catch(() => {
        if (!stopped) abortController.abort();
      })
      .finally(() => {
        if (inFlightRenewal === renewal) inFlightRenewal = null;
      });
    inFlightRenewal = renewal;
  };
  const heartbeat = setInterval(renew, config.heartbeatMs);
  heartbeat.unref();

  return {
    abortController,
    stopHeartbeat: async () => {
      if (!stopped) {
        stopped = true;
        clearInterval(heartbeat);
      }
      await inFlightRenewal;
    },
  };
}

export async function runWorker({ config, dataRoot, dependencies }: WorkerRunnerOptions): Promise<void> {
  let stopping = false;
  let activeAttempt: ActiveJobAttempt | null = null;

  const stop = () => {
    stopping = true;
    activeAttempt?.abortController.abort();
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);

  try {
    await dependencies.recoverExpiredJobs({ leaseMs: config.leaseMs, maxAttempts: config.maxJobAttempts });
    const reconciliation = await dependencies.reconcileWorkerTemp(dataRoot);
    if (reconciliation.removed > 0) console.log(JSON.stringify({ level: 'info', event: 'artifactDiscarded', count: reconciliation.removed }));
    const orphanedResults = await dependencies.reconcileOrphanedMatchResults(dataRoot);
    if (orphanedResults.removed > 0) console.log(JSON.stringify({ level: 'info', event: 'orphanedResultDiscarded', count: orphanedResults.removed }));
    const deletedMatches = await dependencies.reconcileDeletingMatches(dataRoot);
    if (deletedMatches > 0) console.log(JSON.stringify({ level: 'info', event: 'matchDeletionReconciled', count: deletedMatches }));
    const sourceCleanup = await dependencies.reconcilePublishedSourceCleanup(dataRoot, config.retainSourceDemo);
    if (sourceCleanup.removed > 0) console.log(JSON.stringify({ level: 'info', event: 'sourceCleanupReconciled', count: sourceCleanup.removed }));

    while (!stopping) {
      const job = await dependencies.claimNextJob({ leaseMs: config.leaseMs, maxAttempts: config.maxJobAttempts });
      if (stopping) {
        if (job) {
          await dependencies.releaseJobLeaseForRetry(
            job.id,
            job.leaseToken,
            config.maxJobAttempts,
          );
        }
        break;
      }
      if (!job) {
        await new Promise((resolve) => setTimeout(resolve, config.pollMs));
        continue;
      }
      console.log(JSON.stringify({ level: 'info', event: 'jobClaimed', type: job.type, attempt: job.attempt }));
      if (job.attempt > 1) console.log(JSON.stringify({ level: 'info', event: 'jobRecovered', type: job.type, attempt: job.attempt }));
      const attempt = startJobAttempt(job, config, dependencies);
      activeAttempt = attempt;
      try {
        await dependencies.processJob(job.id, job.matchId, job.leaseToken, {
          signal: attempt.abortController.signal,
          config,
        });
      } finally {
        await attempt.stopHeartbeat();
        if (stopping) {
          await dependencies.releaseJobLeaseForRetry(
            job.id,
            job.leaseToken,
            config.maxJobAttempts,
          );
        }
        const reconciled = await dependencies.reconcileOrphanedMatchResults(dataRoot);
        if (reconciled.removed > 0) console.log(JSON.stringify({ level: 'info', event: 'orphanedResultDiscarded', count: reconciled.removed }));
        if (activeAttempt === attempt) activeAttempt = null;
      }
    }
  } finally {
    activeAttempt?.abortController.abort();
    await activeAttempt?.stopHeartbeat();
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
    await dependencies.disconnect();
  }
}
