import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveWorkerRuntimeConfig } from '../src/runtime-config.js';
import {
  runWorker,
  type WorkerRunnerOptions,
} from '../src/runner/worker-runner.js';

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve'];
  let reject!: Deferred<T>['reject'];
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const config = resolveWorkerRuntimeConfig({
  JOB_HEARTBEAT_MS: '10',
  JOB_LEASE_MS: '100',
  WORKER_POLL_MS: '10',
});

function dependencies(
  overrides: Partial<WorkerRunnerOptions['dependencies']>,
): WorkerRunnerOptions['dependencies'] {
  return {
    recoverExpiredJobs: vi.fn(async () => ({ requeued: 0, failed: 0 })),
    reconcileWorkerTemp: vi.fn(async () => ({ removed: 0, retained: 0 })),
    reconcileOrphanedMatchResults: vi.fn(async () => ({ removed: 0, retained: 0 })),
    reconcileDeletingMatches: vi.fn(async () => 0),
    reconcilePublishedSourceCleanup: vi.fn(async () => ({ removed: 0, retained: 0 })),
    claimNextJob: vi.fn(async () => null),
    renewJobLease: vi.fn(async () => true),
    releaseJobLeaseForRetry: vi.fn(async () => true),
    processJob: vi.fn(async () => undefined),
    disconnect: vi.fn(async () => undefined),
    ...overrides,
  } as WorkerRunnerOptions['dependencies'];
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe('worker attempt heartbeat lifecycle', () => {
  it('disconnects when PostgreSQL-backed startup recovery fails', async () => {
    const failure = new Error('database unavailable');
    const mocked = dependencies({
      recoverExpiredJobs: vi.fn(async () => { throw failure; }),
    });

    await expect(runWorker({ config, dataRoot: 'synthetic', dependencies: mocked }))
      .rejects.toBe(failure);

    expect(mocked.disconnect).toHaveBeenCalledOnce();
    expect(mocked.claimNextJob).not.toHaveBeenCalled();
  });

  it('settles the previous heartbeat before starting the next attempt', async () => {
    vi.useFakeTimers();
    const firstWork = deferred<void>();
    const firstRenewal = deferred<boolean>();
    const firstStarted = deferred<void>();
    const secondStarted = deferred<AbortSignal>();
    const jobs = [
      { id: 'job-1', matchId: 'match-1', type: 'PARSE', leaseToken: 'lease-1', attempt: 1 },
      { id: 'job-2', matchId: 'match-2', type: 'PARSE', leaseToken: 'lease-2', attempt: 1 },
    ];
    const mocked = dependencies({
      claimNextJob: vi.fn(async () => jobs.shift() ?? null),
      renewJobLease: vi.fn(async (jobId) => (
        jobId === 'job-1' ? firstRenewal.promise : true
      )),
      processJob: vi.fn(async (jobId, _matchId, _leaseToken, options) => {
        if (jobId === 'job-1') {
          firstStarted.resolve();
          await firstWork.promise;
          return;
        }
        secondStarted.resolve(options.signal!);
        await new Promise<void>((resolve) => {
          if (options.signal?.aborted) resolve();
          else options.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      }),
    });
    const running = runWorker({ config, dataRoot: 'synthetic', dependencies: mocked });

    await firstStarted.promise;
    await vi.advanceTimersByTimeAsync(config.heartbeatMs);
    firstWork.resolve();
    await flushMicrotasks();
    const nextAttemptStartedBeforeHeartbeatSettled = mocked.processJob.mock.calls.length > 1;

    firstRenewal.reject(new Error('late heartbeat failure'));
    const secondSignal = await secondStarted.promise;
    const nextAttemptWasAbortedByOldHeartbeat = secondSignal.aborted;
    process.emit('SIGTERM');
    await running;

    expect(nextAttemptStartedBeforeHeartbeatSettled).toBe(false);
    expect(nextAttemptWasAbortedByOldHeartbeat).toBe(false);
  });

  it('aborts the current attempt when its lease renewal is rejected', async () => {
    vi.useFakeTimers();
    const started = deferred<AbortSignal>();
    let claimed = false;
    const mocked = dependencies({
      claimNextJob: vi.fn(async () => {
        if (claimed) return null;
        claimed = true;
        return {
          id: 'job', matchId: 'match', type: 'PARSE', leaseToken: 'lease', attempt: 1,
        };
      }),
      renewJobLease: vi.fn(async () => false),
      processJob: vi.fn(async (_jobId, _matchId, _leaseToken, options) => {
        started.resolve(options.signal!);
        await new Promise<void>((resolve) => {
          options.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
        process.emit('SIGTERM');
      }),
    });
    const running = runWorker({ config, dataRoot: 'synthetic', dependencies: mocked });

    const signal = await started.promise;
    await vi.advanceTimersByTimeAsync(config.heartbeatMs);
    await running;

    expect(signal.aborted).toBe(true);
    expect(mocked.renewJobLease).toHaveBeenCalledWith('job', 'lease', config.leaseMs);
  });

  it('waits for an in-flight heartbeat during shutdown and leaves no timer behind', async () => {
    vi.useFakeTimers();
    const sigtermListenersBefore = process.listenerCount('SIGTERM');
    const sigintListenersBefore = process.listenerCount('SIGINT');
    const renewal = deferred<boolean>();
    const started = deferred<AbortSignal>();
    let claimed = false;
    const mocked = dependencies({
      claimNextJob: vi.fn(async () => {
        if (claimed) return null;
        claimed = true;
        return {
          id: 'job', matchId: 'match', type: 'PARSE', leaseToken: 'lease', attempt: 1,
        };
      }),
      renewJobLease: vi.fn(async () => renewal.promise),
      processJob: vi.fn(async (_jobId, _matchId, _leaseToken, options) => {
        started.resolve(options.signal!);
        await new Promise<void>((resolve) => {
          options.signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      }),
    });
    let settled = false;
    const running = runWorker({ config, dataRoot: 'synthetic', dependencies: mocked })
      .then(() => { settled = true; });

    await started.promise;
    await vi.advanceTimersByTimeAsync(config.heartbeatMs);
    process.emit('SIGTERM');
    await flushMicrotasks();
    const settledBeforeHeartbeat = settled;
    const releasedBeforeHeartbeat = mocked.releaseJobLeaseForRetry.mock.calls.length > 0;

    renewal.resolve(true);
    await running;
    const renewalCount = mocked.renewJobLease.mock.calls.length;
    await vi.advanceTimersByTimeAsync(config.heartbeatMs * 5);

    expect(settledBeforeHeartbeat).toBe(false);
    expect(releasedBeforeHeartbeat).toBe(false);
    expect(mocked.releaseJobLeaseForRetry).toHaveBeenCalledOnce();
    expect(mocked.renewJobLease).toHaveBeenCalledTimes(renewalCount);
    expect(mocked.disconnect).toHaveBeenCalledOnce();
    expect(process.listenerCount('SIGTERM')).toBe(sigtermListenersBefore);
    expect(process.listenerCount('SIGINT')).toBe(sigintListenersBefore);
  });

  it('does not start a job claimed after shutdown has begun', async () => {
    const claimStarted = deferred<void>();
    const claim = deferred<{
      id: string;
      matchId: string;
      type: string;
      leaseToken: string;
      attempt: number;
    } | null>();
    let claimCount = 0;
    const mocked = dependencies({
      claimNextJob: vi.fn(async () => {
        claimCount += 1;
        if (claimCount > 1) return null;
        claimStarted.resolve();
        return claim.promise;
      }),
    });
    const running = runWorker({ config, dataRoot: 'synthetic', dependencies: mocked });

    await claimStarted.promise;
    process.emit('SIGTERM');
    claim.resolve({
      id: 'job', matchId: 'match', type: 'PARSE', leaseToken: 'lease', attempt: 1,
    });
    await running;

    expect(mocked.processJob).not.toHaveBeenCalled();
    expect(mocked.releaseJobLeaseForRetry).toHaveBeenCalledWith(
      'job', 'lease', config.maxJobAttempts,
    );
    expect(mocked.disconnect).toHaveBeenCalledOnce();
  });
});
