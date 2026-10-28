import { claimNextJob, prisma, renewJobLease } from '@who-ruined/database';

// Fault injection must exercise the exact compiled entrypoints used by the
// production container. Loading source through tsx would make import.meta.url
// point at src/ and would therefore look for a non-existent JS supervisor.
const { processJob } = await import('../../dist/process-job.js') as typeof import('../../src/process-job.js');
const { resolveWorkerRuntimeConfig } = await import('../../dist/runtime-config.js') as typeof import('../../src/runtime-config.js');

const target = process.argv[2];
const allowed = new Set(['PARSING', 'NORMALIZING', 'VALIDATING', 'FEATURIZING', 'SCORING']);
if (!target || !allowed.has(target)) throw new Error('A known synthetic fault stage is required');

const config = resolveWorkerRuntimeConfig();
const job = await claimNextJob({ leaseMs: config.leaseMs, maxAttempts: config.maxJobAttempts });
if (!job) throw new Error('No queued fixture job');
const heartbeat = setInterval(() => {
  void renewJobLease(job.id, job.leaseToken, config.leaseMs);
}, config.heartbeatMs);
try {
  await processJob(job.id, job.matchId, job.leaseToken, {
    config,
    hooks: {
      afterStage(stage) {
        if (stage === target) process.kill(process.pid, 'SIGKILL');
      }
    }
  });
} finally {
  clearInterval(heartbeat);
}
await prisma.$disconnect();
