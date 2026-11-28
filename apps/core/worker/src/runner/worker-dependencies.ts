import {
  claimNextJob,
  prisma,
  recoverExpiredJobs,
  releaseJobLeaseForRetry,
  renewJobLease,
} from '@who-ruined/database';
import { processJob } from '../process-job.js';
import {
  reconcileDeletingMatches,
  reconcileOrphanedMatchResults,
  reconcilePublishedSourceCleanup,
  reconcileWorkerTemp,
} from '../reconcile.js';

export const workerDependencies = {
  claimNextJob,
  recoverExpiredJobs,
  releaseJobLeaseForRetry,
  renewJobLease,
  processJob,
  reconcileDeletingMatches,
  reconcileOrphanedMatchResults,
  reconcilePublishedSourceCleanup,
  reconcileWorkerTemp,
  disconnect: () => prisma.$disconnect(),
};
