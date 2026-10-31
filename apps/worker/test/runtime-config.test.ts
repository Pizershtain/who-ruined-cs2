import { describe, expect, it } from 'vitest';
import { resolveWorkerRuntimeConfig } from '../src/runtime-config.js';

describe('worker runtime config', () => {
  it('keeps explicit finite defaults', () => {
    expect(resolveWorkerRuntimeConfig({})).toEqual({
      parseTimeoutMs: 120_000,
      pollMs: 1_000,
      leaseMs: 30_000,
      heartbeatMs: 5_000,
      maxJobAttempts: 3,
      childKillGraceMs: 5_000,
      maxParseArtifactBytes: 512 * 1024 * 1024,
      maxParseArtifactOutputBytes: 1536 * 1024 * 1024,
      maxReplayParseArtifactBytes: 64 * 1024 * 1024,
      maxReplayParseArtifactOutputBytes: 256 * 1024 * 1024,
      maxReplayRoundCompressedBytes: 8 * 1024 * 1024,
      maxReplayTotalCompressedBytes: 64 * 1024 * 1024,
      maxResultCompressedBytes: 8 * 1024 * 1024,
      maxResultJsonBytes: 64 * 1024 * 1024,
      maxResultJsonDepth: 128,
      activeRatingPolicy: 'H2',
      retainSourceDemo: false
    });
  });

  it('validates owner policy and debug source retention', () => {
    expect(resolveWorkerRuntimeConfig({ ACTIVE_RATING_POLICY: 'H1', RETAIN_SOURCE_DEMO: '1' })).toMatchObject({ activeRatingPolicy: 'H1', retainSourceDemo: true });
    expect(() => resolveWorkerRuntimeConfig({ ACTIVE_RATING_POLICY: 'H3' })).toThrow('ACTIVE_RATING_POLICY');
    expect(() => resolveWorkerRuntimeConfig({ RETAIN_SOURCE_DEMO: 'maybe' })).toThrow('RETAIN_SOURCE_DEMO');
  });

  it('accepts supported overrides', () => {
    expect(resolveWorkerRuntimeConfig({ PARSE_TIMEOUT_MS: '300000', WORKER_POLL_MS: '250' })).toMatchObject({ parseTimeoutMs: 300_000, pollMs: 250 });
  });

  it.each([
    ['PARSE_TIMEOUT_MS', '0'],
    ['PARSE_TIMEOUT_MS', 'NaN'],
    ['PARSE_TIMEOUT_MS', '3600001'],
    ['WORKER_POLL_MS', '-1'],
    ['WORKER_POLL_MS', '60001'],
    ['JOB_LEASE_MS', '0'],
    ['JOB_HEARTBEAT_MS', '60001'],
    ['MAX_JOB_ATTEMPTS', '11'],
    ['CHILD_KILL_GRACE_MS', '0'],
    ['MAX_PARSE_ARTIFACT_BYTES', '2147483649']
  ])('rejects invalid %s=%s', (name, value) => {
    expect(() => resolveWorkerRuntimeConfig({ [name]: value })).toThrow(name);
  });

  it('rejects a heartbeat that cannot leave three missed intervals before expiry', () => {
    expect(() => resolveWorkerRuntimeConfig({ JOB_LEASE_MS: '12000', JOB_HEARTBEAT_MS: '4000' })).toThrow('JOB_HEARTBEAT_MS');
  });
});
