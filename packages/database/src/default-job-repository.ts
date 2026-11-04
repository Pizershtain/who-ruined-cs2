import { prisma } from './client.js';
import { createJobRepository } from './job-lease-repository.js';

const repository = createJobRepository(prisma);
export const recoverExpiredJobs = repository.recoverExpiredJobs;
export const claimNextJob = repository.claimNextJob;
export const renewJobLease = repository.renewLease;
export const assertJobLease = repository.assertLease;
export const advanceJobStage = repository.advanceStage;
export const releaseJobLeaseForRetry = repository.releaseLeaseForRetry;
export const completeOwnedJob = repository.completeOwnedJob;
export const persistOwnedReport = repository.persistOwnedReport;
export const failOwnedJob = repository.failOwnedJob;
