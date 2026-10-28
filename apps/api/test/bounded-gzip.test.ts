import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let root = '';
vi.mock('../src/storage.js', () => ({ safeExistingDataPath: async (relative: string) => path.join(root, relative) }));
const { readBoundedGzipJson } = await import('../src/bounded-gzip.js');
const previous = { compressed: process.env.MAX_RESULT_COMPRESSED_BYTES, json: process.env.MAX_RESULT_JSON_BYTES, depth: process.env.MAX_RESULT_JSON_DEPTH };

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m44-gzip-'));
  await mkdir(path.join(root, 'results'), { recursive: true });
  process.env.MAX_RESULT_COMPRESSED_BYTES = '1048576';
  process.env.MAX_RESULT_JSON_BYTES = '1048576';
  process.env.MAX_RESULT_JSON_DEPTH = '32';
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  if (previous.compressed === undefined) delete process.env.MAX_RESULT_COMPRESSED_BYTES; else process.env.MAX_RESULT_COMPRESSED_BYTES = previous.compressed;
  if (previous.json === undefined) delete process.env.MAX_RESULT_JSON_BYTES; else process.env.MAX_RESULT_JSON_BYTES = previous.json;
  if (previous.depth === undefined) delete process.env.MAX_RESULT_JSON_DEPTH; else process.env.MAX_RESULT_JSON_DEPTH = previous.depth;
});

async function fixture(name: string, bytes: Buffer): Promise<string> {
  const relative = `results/${name}.json.gz`;
  await writeFile(path.join(root, relative), bytes);
  return relative;
}

describe('bounded gzip JSON reader', () => {
  it('validates a complete gzip and its compressed-byte checksum', async () => {
    const bytes = gzipSync(Buffer.from(JSON.stringify({ ok: true })));
    const relative = await fixture('valid', bytes);
    await expect(readBoundedGzipJson(relative, createHash('sha256').update(bytes).digest('hex'))).resolves.toEqual({ ok: true });
    await expect(readBoundedGzipJson(relative, '0'.repeat(64))).rejects.toMatchObject({ reason: 'CHECKSUM' });
  });

  it('rejects corrupt, truncated and compressed-over-limit input', async () => {
    await expect(readBoundedGzipJson(await fixture('corrupt', Buffer.from('not-gzip')))).rejects.toMatchObject({ reason: 'INVALID' });
    const truncated = gzipSync(Buffer.from('{"ok":true}')).subarray(0, 8);
    await expect(readBoundedGzipJson(await fixture('truncated', truncated))).rejects.toMatchObject({ reason: 'INVALID' });
    process.env.MAX_RESULT_COMPRESSED_BYTES = '16';
    await expect(readBoundedGzipJson(await fixture('large', Buffer.alloc(17)))).rejects.toMatchObject({ reason: 'COMPRESSED_LIMIT' });
  });

  it('aborts a high-ratio payload at the decompressed-byte ceiling', async () => {
    process.env.MAX_RESULT_JSON_BYTES = '1024';
    const compressed = gzipSync(Buffer.from(JSON.stringify({ value: '0'.repeat(2 * 1024 * 1024) })));
    expect(compressed.byteLength).toBeLessThan(8 * 1024);
    await expect(readBoundedGzipJson(await fixture('bomb', compressed))).rejects.toMatchObject({ reason: 'DECOMPRESSED_LIMIT' });
  });

  it('rejects structural depth independently of byte size', async () => {
    process.env.MAX_RESULT_JSON_DEPTH = '4';
    const text = `${'['.repeat(5)}0${']'.repeat(5)}`;
    await expect(readBoundedGzipJson(await fixture('deep', gzipSync(Buffer.from(text))))).rejects.toMatchObject({ reason: 'DEPTH' });
  });
});

