import { describe, expect, it } from 'vitest';
import { resolveActiveRatingPolicy, resolveApiBindHost, resolveApiRuntimeConfig } from '../src/runtime-config.js';

describe('API bind host', () => {
  it('binds local-only by default', () => {
    expect(resolveApiBindHost({})).toBe('127.0.0.1');
  });

  it('accepts an explicit container bind address', () => {
    expect(resolveApiBindHost({ API_BIND_HOST: '0.0.0.0' })).toBe('0.0.0.0');
  });

  it('does not treat whitespace as an explicit address', () => {
    expect(resolveApiBindHost({ API_BIND_HOST: '  ' })).toBe('127.0.0.1');
  });
});

describe('active rating policy', () => {
  it('defaults to H2 and accepts only frozen owner policies', () => {
    expect(resolveActiveRatingPolicy({})).toBe('H2');
    expect(resolveActiveRatingPolicy({ ACTIVE_RATING_POLICY: 'H1' })).toBe('H1');
    expect(() => resolveActiveRatingPolicy({ ACTIVE_RATING_POLICY: 'H3' })).toThrow('ACTIVE_RATING_POLICY');
  });
});

describe('bounded API runtime configuration', () => {
  it('uses finite local defaults with measured canonical headroom', () => {
    const config = resolveApiRuntimeConfig({});
    expect(config).toMatchObject({
      bindHost: '127.0.0.1', port: 3000, jsonBodyBytes: 128 * 1024,
      maxQueryStringBytes: 8 * 1024, requestTimeoutMs: 30 * 60_000,
      maxResultCompressedBytes: 8 * 1024 * 1024, maxResultJsonBytes: 64 * 1024 * 1024,
      maxResultJsonDepth: 128, maxConcurrentUploads: 2, maxQueuedJobs: 32
    });
    expect(config.corsOrigins).toEqual(new Set(['http://127.0.0.1:5173','http://localhost:5173']));
  });

  it.each([
    ['MAX_JSON_BODY_BYTES','0'], ['MAX_QUERY_STRING_BYTES','NaN'], ['MAX_RESULT_JSON_DEPTH','513'],
    ['MAX_CONCURRENT_UPLOADS','33'], ['MAX_QUEUED_JOBS','-1'], ['API_PORT','65536']
  ])('rejects impossible %s=%s without a silent fallback', (name, value) => {
    expect(() => resolveApiRuntimeConfig({ [name]: value })).toThrow(name);
  });

  it('validates origins and the timeout ordering', () => {
    expect(() => resolveApiRuntimeConfig({ API_CORS_ORIGINS: 'http://localhost:5173/path' })).toThrow('API_CORS_ORIGINS');
    expect(() => resolveApiRuntimeConfig({ API_REQUEST_TIMEOUT_MS: '1000', API_HEADERS_TIMEOUT_MS: '1000' })).toThrow('API_HEADERS_TIMEOUT_MS');
  });
});
