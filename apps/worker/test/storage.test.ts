import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { assertNoSymlinkComponents, publishImmutableBytes, resolveDataPath } from '../src/storage.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('artifact path confinement', () => {
  it('keeps artifacts under DATA_DIR', () => expect(resolveDataPath(path.resolve('data'), 'cache/m.json.gz')).toBe(path.resolve('data/cache/m.json.gz')));
  it('rejects traversal and the root itself', () => {
    expect(() => resolveDataPath(path.resolve('data'), '../secret')).toThrow('Unsafe artifact path');
    expect(() => resolveDataPath(path.resolve('data'), '.')).toThrow('Unsafe artifact path');
  });

  it('rejects an existing symlink component before read or deletion can escape DATA_DIR', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m43-root-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'wrc-m43-outside-'));
    roots.push(root, outside);
    await mkdir(path.join(root, 'results'), { recursive: true });
    await writeFile(path.join(outside, 'private.txt'), 'keep');
    await symlink(outside, path.join(root, 'results', 'escape'), 'junction');
    await expect(assertNoSymlinkComponents(root, path.join(root, 'results', 'escape', 'private.txt'))).rejects.toThrow('SYMLINK_ARTIFACT_PATH');
    await expect(readFile(path.join(outside, 'private.txt'), 'utf8')).resolves.toBe('keep');
  });
});

describe('immutable publication', () => {
  it('creates once, reuses identical bytes, and refuses conflicting bytes', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m42-artifact-'));
    roots.push(root);
    const target = path.join(root, 'artifact.bin');
    await expect(publishImmutableBytes(target, Buffer.from('stable'))).resolves.toBe('CREATED');
    await expect(publishImmutableBytes(target, Buffer.from('stable'))).resolves.toBe('REUSED');
    await expect(publishImmutableBytes(target, Buffer.from('conflict'))).rejects.toThrow('IMMUTABLE_ARTIFACT_CONFLICT');
    await expect(readFile(target, 'utf8')).resolves.toBe('stable');
  });

  it('checks the current lease immediately before final publication', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m42-fenced-artifact-'));
    roots.push(root);
    const target = path.join(root, 'artifact.bin');
    await expect(publishImmutableBytes(target, Buffer.from('late'), async () => { throw new Error('STALE_JOB_OWNER'); })).rejects.toThrow('STALE_JOB_OWNER');
    await expect(readFile(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
