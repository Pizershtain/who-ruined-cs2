import { gzipSync } from 'node:zlib';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readCanonicalMatchResult } from '../src/match-result-storage.js';

const roots: string[] = [];
const previous = { compressed: process.env.MAX_RESULT_COMPRESSED_BYTES, json: process.env.MAX_RESULT_JSON_BYTES };

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  if (previous.compressed === undefined) delete process.env.MAX_RESULT_COMPRESSED_BYTES; else process.env.MAX_RESULT_COMPRESSED_BYTES = previous.compressed;
  if (previous.json === undefined) delete process.env.MAX_RESULT_JSON_BYTES; else process.env.MAX_RESULT_JSON_BYTES = previous.json;
});

async function fixture(bytes: Buffer): Promise<{ root: string; relative: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m44-worker-result-'));
  roots.push(root);
  const relative = 'results/synthetic/value.json.gz';
  await mkdir(path.dirname(path.join(root, relative)), { recursive: true });
  await writeFile(path.join(root, relative), bytes);
  return { root, relative };
}

describe('worker canonical read resource bounds', () => {
  it('rejects compressed bytes beyond the configured ceiling before decoding', async () => {
    process.env.MAX_RESULT_COMPRESSED_BYTES = '16';
    const value = await fixture(Buffer.alloc(17));
    await expect(readCanonicalMatchResult(value.root, value.relative)).rejects.toThrow('REPORT_CORRUPT');
  });

  it('rejects a high-expansion gzip using the independent output ceiling', async () => {
    process.env.MAX_RESULT_JSON_BYTES = '1024';
    const bytes = gzipSync(Buffer.from(JSON.stringify({ value: 'x'.repeat(1024 * 1024) })));
    expect(bytes.byteLength).toBeLessThan(8 * 1024);
    const value = await fixture(bytes);
    await expect(readCanonicalMatchResult(value.root, value.relative)).rejects.toThrow('REPORT_CORRUPT');
  });
});
