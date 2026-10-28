import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reconcileOrphanedMatchResults, reconcileWorkerTemp } from '../src/reconcile.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

describe('worker provisional artifact reconciliation', () => {
  it('retains only a snapshot owned by a current persisted lease', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m42-reconcile-'));
    roots.push(root);
    const directory = path.join(root, 'worker-tmp', 'job');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'active.snapshot.json.gz'), 'active');
    await mkdir(path.join(root, 'worker-tmp', 'empty-job'), { recursive: true });
    await writeFile(path.join(directory, 'stale.snapshot.json.gz'), 'stale');
    await writeFile(path.join(directory, 'partial.snapshot.json.gz.123.tmp'), 'partial');
    await expect(reconcileWorkerTemp(root, async () => new Set(['active']))).resolves.toEqual({ removed: 2, retained: 1 });
    await expect(readFile(path.join(directory, 'active.snapshot.json.gz'), 'utf8')).resolves.toBe('active');
  });

  it('removes publication-before-pointer orphans but retains the DB pointer and active-job candidates', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m43-results-'));
    roots.push(root);
    for (const name of ['ready','active','missing']) await mkdir(path.join(root, 'results', name), { recursive: true });
    await writeFile(path.join(root, 'results', 'ready', 'current.json.gz'), 'current');
    await writeFile(path.join(root, 'results', 'ready', 'orphan.json.gz'), 'orphan');
    await writeFile(path.join(root, 'results', 'active', 'candidate.json.gz'), 'candidate');
    await writeFile(path.join(root, 'results', 'missing', 'orphan.json.gz'), 'orphan');
    const state = new Map([
      ['ready', { referencedPath: 'results/ready/current.json.gz', active: false }],
      ['active', { referencedPath: null, active: true }]
    ]);
    await expect(reconcileOrphanedMatchResults(root, async () => state)).resolves.toEqual({ removed: 2, retained: 2 });
    await expect(access(path.join(root, 'results', 'ready', 'current.json.gz'))).resolves.toBeUndefined();
    await expect(access(path.join(root, 'results', 'active', 'candidate.json.gz'))).resolves.toBeUndefined();
    await expect(access(path.join(root, 'results', 'ready', 'orphan.json.gz'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(path.join(root, 'results', 'missing'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
