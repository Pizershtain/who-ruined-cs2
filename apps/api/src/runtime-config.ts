export function resolveApiBindHost(environment: NodeJS.ProcessEnv = process.env): string {
  return environment.API_BIND_HOST?.trim() || '127.0.0.1';
}

const MIB = 1024 * 1024;

function positiveInteger(name: string, value: string | undefined, fallback: number, maximum: number): number {
  const candidate = value?.trim() || String(fallback);
  if (!/^[1-9][0-9]*$/.test(candidate)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) throw new Error(`${name} is outside the supported range`);
  return parsed;
}

function origins(value: string | undefined): ReadonlySet<string> {
  const candidates = (value?.trim() || 'http://127.0.0.1:5173,http://localhost:5173')
    .split(',').map((entry) => entry.trim()).filter(Boolean);
  const result = new Set<string>();
  for (const candidate of candidates) {
    let parsed: URL;
    try { parsed = new URL(candidate); } catch { throw new Error('API_CORS_ORIGINS must contain absolute HTTP origins'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== candidate || parsed.username || parsed.password) {
      throw new Error('API_CORS_ORIGINS must contain comma-separated origins without paths or credentials');
    }
    result.add(candidate);
  }
  return result;
}

export interface ApiRuntimeConfig {
  bindHost: string;
  port: number;
  corsOrigins: ReadonlySet<string>;
  jsonBodyBytes: number;
  maxQueryStringBytes: number;
  requestTimeoutMs: number;
  headersTimeoutMs: number;
  keepAliveTimeoutMs: number;
  maxResultCompressedBytes: number;
  maxResultJsonBytes: number;
  maxResultJsonDepth: number;
  maxConcurrentUploads: number;
  maxQueuedJobs: number;
}

export function resolveApiRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): ApiRuntimeConfig {
  const requestTimeoutMs = positiveInteger('API_REQUEST_TIMEOUT_MS', environment.API_REQUEST_TIMEOUT_MS, 30 * 60_000, 60 * 60_000);
  const headersTimeoutMs = positiveInteger('API_HEADERS_TIMEOUT_MS', environment.API_HEADERS_TIMEOUT_MS, 15_000, 60_000);
  if (headersTimeoutMs >= requestTimeoutMs) throw new Error('API_HEADERS_TIMEOUT_MS must be less than API_REQUEST_TIMEOUT_MS');
  return {
    bindHost: resolveApiBindHost(environment),
    port: positiveInteger('API_PORT', environment.API_PORT ?? environment.PORT, 3000, 65_535),
    corsOrigins: origins(environment.API_CORS_ORIGINS),
    jsonBodyBytes: positiveInteger('MAX_JSON_BODY_BYTES', environment.MAX_JSON_BODY_BYTES, 128 * 1024, 4 * MIB),
    maxQueryStringBytes: positiveInteger('MAX_QUERY_STRING_BYTES', environment.MAX_QUERY_STRING_BYTES, 8 * 1024, 64 * 1024),
    requestTimeoutMs,
    headersTimeoutMs,
    keepAliveTimeoutMs: positiveInteger('API_KEEP_ALIVE_TIMEOUT_MS', environment.API_KEEP_ALIVE_TIMEOUT_MS, 5_000, 60_000),
    maxResultCompressedBytes: positiveInteger('MAX_RESULT_COMPRESSED_BYTES', environment.MAX_RESULT_COMPRESSED_BYTES, 8 * MIB, 256 * MIB),
    maxResultJsonBytes: positiveInteger('MAX_RESULT_JSON_BYTES', environment.MAX_RESULT_JSON_BYTES, 64 * MIB, 512 * MIB),
    maxResultJsonDepth: positiveInteger('MAX_RESULT_JSON_DEPTH', environment.MAX_RESULT_JSON_DEPTH, 128, 512),
    maxConcurrentUploads: positiveInteger('MAX_CONCURRENT_UPLOADS', environment.MAX_CONCURRENT_UPLOADS, 2, 32),
    maxQueuedJobs: positiveInteger('MAX_QUEUED_JOBS', environment.MAX_QUEUED_JOBS, 32, 10_000)
  };
}

export function resolveActiveRatingPolicy(environment: NodeJS.ProcessEnv = process.env): 'H2' | 'H1' {
  const value = environment.ACTIVE_RATING_POLICY?.trim() || 'H2';
  if (value !== 'H2' && value !== 'H1') throw new Error('ACTIVE_RATING_POLICY must be H2 or H1');
  return value;
}
