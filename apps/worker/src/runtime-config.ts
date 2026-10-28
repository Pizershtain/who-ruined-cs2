const MAX_TIMEOUT_MS = 60 * 60 * 1000;

function positiveInteger(name: string, value: string | undefined, fallback: number, maximum: number): number {
  const candidate = value?.trim() || String(fallback);
  if (!/^[1-9][0-9]*$/.test(candidate)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new Error(`${name} is outside the supported range`);
  return parsed;
}

export interface WorkerRuntimeConfig {
  parseTimeoutMs: number;
  pollMs: number;
  leaseMs: number;
  heartbeatMs: number;
  maxJobAttempts: number;
  childKillGraceMs: number;
  maxParseArtifactBytes: number;
  maxParseArtifactOutputBytes: number;
  maxResultCompressedBytes: number;
  maxResultJsonBytes: number;
  maxResultJsonDepth: number;
  activeRatingPolicy: 'H2' | 'H1';
  retainSourceDemo: boolean;
}

function activePolicy(value: string | undefined): 'H2' | 'H1' {
  const candidate = value?.trim() || 'H2';
  if (candidate !== 'H2' && candidate !== 'H1') throw new Error('ACTIVE_RATING_POLICY must be H2 or H1');
  return candidate;
}

function booleanFlag(name: string, value: string | undefined, fallback: boolean): boolean {
  const candidate = value?.trim() || (fallback ? '1' : '0');
  if (candidate === '1' || candidate === 'true') return true;
  if (candidate === '0' || candidate === 'false') return false;
  throw new Error(`${name} must be 0/1 or true/false`);
}

export function resolveWorkerRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): WorkerRuntimeConfig {
  const config = {
    parseTimeoutMs: positiveInteger('PARSE_TIMEOUT_MS', environment.PARSE_TIMEOUT_MS, 120_000, MAX_TIMEOUT_MS),
    pollMs: positiveInteger('WORKER_POLL_MS', environment.WORKER_POLL_MS, 1_000, 60_000),
    leaseMs: positiveInteger('JOB_LEASE_MS', environment.JOB_LEASE_MS, 30_000, MAX_TIMEOUT_MS),
    heartbeatMs: positiveInteger('JOB_HEARTBEAT_MS', environment.JOB_HEARTBEAT_MS, 5_000, 60_000),
    maxJobAttempts: positiveInteger('MAX_JOB_ATTEMPTS', environment.MAX_JOB_ATTEMPTS, 3, 10),
    childKillGraceMs: positiveInteger('CHILD_KILL_GRACE_MS', environment.CHILD_KILL_GRACE_MS, 5_000, 60_000),
    maxParseArtifactBytes: positiveInteger('MAX_PARSE_ARTIFACT_BYTES', environment.MAX_PARSE_ARTIFACT_BYTES, 512 * 1024 * 1024, 2 * 1024 * 1024 * 1024),
    maxParseArtifactOutputBytes: positiveInteger('MAX_PARSE_ARTIFACT_OUTPUT_BYTES', environment.MAX_PARSE_ARTIFACT_OUTPUT_BYTES, 1536 * 1024 * 1024, 2 * 1024 * 1024 * 1024),
    maxResultCompressedBytes: positiveInteger('MAX_RESULT_COMPRESSED_BYTES', environment.MAX_RESULT_COMPRESSED_BYTES, 8 * 1024 * 1024, 256 * 1024 * 1024),
    maxResultJsonBytes: positiveInteger('MAX_RESULT_JSON_BYTES', environment.MAX_RESULT_JSON_BYTES, 64 * 1024 * 1024, 512 * 1024 * 1024),
    maxResultJsonDepth: positiveInteger('MAX_RESULT_JSON_DEPTH', environment.MAX_RESULT_JSON_DEPTH, 128, 512),
    activeRatingPolicy: activePolicy(environment.ACTIVE_RATING_POLICY),
    retainSourceDemo: booleanFlag('RETAIN_SOURCE_DEMO', environment.RETAIN_SOURCE_DEMO, false)
  };
  if (config.heartbeatMs * 3 >= config.leaseMs) {
    throw new Error('JOB_HEARTBEAT_MS must be less than one third of JOB_LEASE_MS');
  }
  return config;
}
