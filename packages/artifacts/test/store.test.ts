import os from 'node:os';
import path from 'node:path';
import { mkdtemp, open, readFile, readdir, rm } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ArtifactError,
  FileArtifactStore,
  canonicalJson,
  gzipJson,
  parseArtifact,
  parseCanonicalMatchResult,
  sha256Bytes,
} from '../src/index.js';

const roots: string[] = [];
const limits = { compressedBytes: 1024, decompressedBytes: 1024, jsonDepth: 8 };

async function fixture(): Promise<{ root: string; store: FileArtifactStore }> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-artifacts-'));
  roots.push(root);
  return { root, store: new FileArtifactStore(root, limits) };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('canonical match-result codec', () => {
  it('rejects a schema mismatch before checking bindings', () => {
    expect(() => parseCanonicalMatchResult({ schemaVersion: 'synthetic-invalid' }, {
      matchId: 'synthetic-match',
    })).toThrowError(expect.objectContaining({ reason: 'SCHEMA_MISMATCH' }));
  });
});

describe('FileArtifactStore', () => {
  it('rejects absolute paths, traversal and the storage root', async () => {
    const { store } = await fixture();
    for (const unsafe of ['', '..', '../outside', path.resolve('outside')]) {
      expect(() => store.resolve(unsafe)).toThrowError(ArtifactError);
    }
  });

  it('publishes immutably, reuses identical bytes and rejects conflicts', async () => {
    const { root, store } = await fixture();
    let callbackSawTarget = false;
    const first = await store.publishImmutable('results/a.json.gz', Buffer.from('one'), async () => {
      callbackSawTarget = await readFile(path.join(root, 'results/a.json.gz'))
        .then(() => true)
        .catch(() => false);
    });
    expect(callbackSawTarget).toBe(false);
    expect(first.publication).toBe('CREATED');
    expect((await store.publishImmutable('results/a.json.gz', Buffer.from('one'))).publication).toBe('REUSED');
    await expect(store.publishImmutable('results/a.json.gz', Buffer.from('two'))).rejects.toMatchObject({
      reason: 'IMMUTABLE_CONFLICT',
    });
  });

  it('removes the temporary artifact when writing fails', async () => {
    const { root, store } = await fixture();
    const probe = await open(path.join(root, 'probe'), 'w');
    const writeFile = vi.spyOn(
      Object.getPrototypeOf(probe) as { writeFile: typeof probe.writeFile },
      'writeFile',
    ).mockRejectedValueOnce(new Error('synthetic write failure'));
    await probe.close();
    try {
      await expect(store.publishImmutable('results/a.json.gz', Buffer.from('one')))
        .rejects.toThrow('synthetic write failure');
      expect((await readdir(path.join(root, 'results'))).filter((name) => name.endsWith('.tmp')))
        .toEqual([]);
    } finally {
      writeFile.mockRestore();
    }
  });

  it('checks compressed SHA-256 and bounded decompression before parsing JSON', async () => {
    const { store } = await fixture();
    const bytes = await gzipJson({ matchId: 'synthetic-match' }, limits);
    await store.publishImmutable('results/a.json.gz', bytes);
    await expect(store.readGzipJson('results/a.json.gz', '0'.repeat(64))).rejects.toMatchObject({
      reason: 'CHECKSUM',
    });
    await expect(store.readGzipJson('results/a.json.gz', sha256Bytes(bytes))).resolves.toEqual({
      matchId: 'synthetic-match',
    });

    const smallStore = new FileArtifactStore(store.root, { ...limits, decompressedBytes: 10 });
    await expect(smallStore.readGzipJson('results/a.json.gz')).rejects.toMatchObject({
      reason: 'DECOMPRESSED_LIMIT',
    });
  });
});

describe('artifact primitives', () => {
  it('canonicalizes object keys recursively without reordering arrays', () => {
    expect(canonicalJson({ z: 1, a: [{ y: 2, x: 1 }] })).toBe('{"a":[{"x":1,"y":2}],"z":1}');
  });

  it('maps schema rejection to a neutral artifact error', () => {
    const schema = { safeParse: () => ({ success: false as const }) };
    expect(() => parseArtifact(schema, {})).toThrowError(
      expect.objectContaining({ reason: 'SCHEMA_MISMATCH' }),
    );
  });

  it('rejects generated JSON that a configured reader could not consume', async () => {
    await expect(gzipJson(
      { value: 'x'.repeat(128) },
      { compressedBytes: 1024, decompressedBytes: 64, jsonDepth: 8 },
    )).rejects.toMatchObject({ reason: 'DECOMPRESSED_LIMIT' });

    await expect(gzipJson(
      { value: 'synthetic' },
      { compressedBytes: 1, decompressedBytes: 1024, jsonDepth: 8 },
    )).rejects.toMatchObject({ reason: 'COMPRESSED_LIMIT' });

    await expect(gzipJson(
      { outer: { inner: true } },
      { compressedBytes: 1024, decompressedBytes: 1024, jsonDepth: 1 },
    )).rejects.toMatchObject({ reason: 'DEPTH' });
  });
});
