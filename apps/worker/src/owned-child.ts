import { spawn, type ChildProcess } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export interface OwnedChildResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  aborted: boolean;
  durationMs: number;
}

async function terminateAndWait(child: ChildProcess, graceMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('exit', done);
      child.removeListener('error', failed);
    };
    const done = () => { cleanup(); resolve(); };
    const failed = (error: Error) => { cleanup(); reject(error); };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('CHILD_TERMINATION_FAILED'));
    }, graceMs);
    timer.unref();
    child.once('exit', done);
    child.once('error', failed);
    if (!child.kill('SIGKILL') && (child.exitCode !== null || child.signalCode !== null)) done();
  });
}

export async function runOwnedChild(options: {
  entrypoint: string;
  nodeArguments?: readonly string[];
  args?: string[];
  timeoutMs: number;
  killGraceMs: number;
  signal?: AbortSignal;
  environment?: NodeJS.ProcessEnv;
}): Promise<OwnedChildResult> {
  const started = performance.now();
  const child = spawn(process.execPath, [
    ...(options.nodeArguments ?? []),
    options.entrypoint,
    ...(options.args ?? []),
  ], {
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: options.environment ?? process.env
  });
  let timedOut = false;
  let aborted = false;
  let termination: Promise<void> | null = null;
  let rejectLifecycle: ((error: Error) => void) | null = null;
  const terminate = (reason: 'timeout' | 'abort') => {
    if (reason === 'timeout') timedOut = true; else aborted = true;
    if (!termination) {
      termination = terminateAndWait(child, options.killGraceMs);
      void termination.catch((error: Error) => rejectLifecycle?.(error));
    }
  };
  const timeout = setTimeout(() => terminate('timeout'), options.timeoutMs);
  timeout.unref();
  const abort = () => terminate('abort');
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      const cleanup = () => {
        child.removeListener('error', failed);
        child.removeListener('exit', exited);
      };
      const failed = (error: Error) => { cleanup(); reject(error); };
      const exited = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        resolve({ code, signal });
      };
      rejectLifecycle = failed;
      child.once('error', failed);
      child.once('exit', exited);
      if (options.signal?.aborted) terminate('abort');
    });
    if (termination) await termination;
    return { ...result, timedOut, aborted, durationMs: performance.now() - started };
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
  }
}
