import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveWorkerRuntimeConfig } from '../../worker/src/runtime-config.js';
import { resolveApiRuntimeConfig } from '../src/runtime-config.js';

const RESULT_LIMITS = [
  ['MAX_RESULT_COMPRESSED_BYTES', '8388608'],
  ['MAX_RESULT_JSON_BYTES', '67108864'],
  ['MAX_RESULT_JSON_DEPTH', '128'],
] as const;

describe('API and worker result-limit consistency', () => {
  it('uses the same native defaults in both processes', () => {
    const api = resolveApiRuntimeConfig({});
    const worker = resolveWorkerRuntimeConfig({});

    expect({
      compressedBytes: api.maxResultCompressedBytes,
      decompressedBytes: api.maxResultJsonBytes,
      jsonDepth: api.maxResultJsonDepth,
    }).toEqual({
      compressedBytes: worker.maxResultCompressedBytes,
      decompressedBytes: worker.maxResultJsonBytes,
      jsonDepth: worker.maxResultJsonDepth,
    });
  });

  it('forwards one shared Compose value and default to API and worker', async () => {
    const compose = await readFile(fileURLToPath(
      new URL('../../../docker-compose.yml', import.meta.url),
    ), 'utf8');

    for (const [name, fallback] of RESULT_LIMITS) {
      const expected = `${name}: \${${name}:-${fallback}}`;
      expect(compose.split(expected)).toHaveLength(3);
    }
  });

  it('exposes the residual native-process mismatch instead of silently equalizing it', () => {
    const api = resolveApiRuntimeConfig({ MAX_RESULT_JSON_DEPTH: '16' });
    const worker = resolveWorkerRuntimeConfig({ MAX_RESULT_JSON_DEPTH: '128' });

    expect(worker.maxResultJsonDepth).toBeGreaterThan(api.maxResultJsonDepth);
  });
});
