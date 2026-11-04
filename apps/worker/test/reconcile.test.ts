import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { reconcileOrphanedMatchResults, reconcileWorkerTemp } from '../src/reconcile.js';

const roots: string[] = [];
afterEach(async () => Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))));

function leases(...pairs: Array<[token: string, jobId: string]>): Map<string, string> {
  return new Map(pairs);
}

describe('worker provisional artifact reconciliation', () => {
  it('retains normal, replay and partial snapshots owned by active leases', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m42-reconcile-'));
    roots.push(root);
    const directory = path.join(root, 'worker-tmp', 'job');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'active.snapshot.json.gz'), 'active');
    await writeFile(path.join(directory, 'replay.replay-snapshot.json.gz'), 'active replay');
    await writeFile(path.join(directory, 'partial.snapshot.json.gz.tmp'), 'active partial');

    await expect(reconcileWorkerTemp(root, async () => leases(
      ['active', 'job'],
      ['replay', 'job'],
      ['partial', 'job'],
    ))).resolves.toEqual({ removed: 0, retained: 3 });
    await expect(readFile(path.join(directory, 'active.snapshot.json.gz'), 'utf8'))
      .resolves.toBe('active');
    await expect(readFile(path.join(directory, 'replay.replay-snapshot.json.gz'), 'utf8'))
      .resolves.toBe('active replay');
  });

  it('removes stale normal, replay and partial snapshots and their empty directory', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m42-reconcile-'));
    roots.push(root);
    const directory = path.join(root, 'worker-tmp', 'job');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'stale.snapshot.json.gz'), 'stale');
    await writeFile(path.join(directory, 'stale-replay.replay-snapshot.json.gz'), 'stale replay');
    await writeFile(path.join(directory, 'partial.snapshot.json.gz.123.tmp'), 'partial');

    await expect(reconcileWorkerTemp(root, async () => leases()))
      .resolves.toEqual({ removed: 3, retained: 0 });
    await expect(access(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not protect foreign tokens or unsupported suffixes by substring', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m42-reconcile-'));
    roots.push(root);
    const directory = path.join(root, 'worker-tmp', 'job');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'active.snapshot.json.gz'), 'foreign job');
    await writeFile(path.join(directory, 'active-other.snapshot.json.gz'), 'foreign token');
    await writeFile(path.join(directory, 'active.snapshot.json.gz.backup'), 'invalid');

    await expect(reconcileWorkerTemp(root, async () => leases(['active', 'different-job'])))
      .resolves.toEqual({ removed: 3, retained: 0 });
  });

  it('protects snapshots belonging to two different active workers', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m42-reconcile-'));
    roots.push(root);
    const firstDirectory = path.join(root, 'worker-tmp', 'first-job');
    const secondDirectory = path.join(root, 'worker-tmp', 'second-job');
    await mkdir(firstDirectory, { recursive: true });
    await mkdir(secondDirectory, { recursive: true });
    await writeFile(path.join(firstDirectory, 'first.snapshot.json.gz'), 'first');
    await writeFile(path.join(secondDirectory, 'second.replay-snapshot.json.gz'), 'second');

    await expect(reconcileWorkerTemp(root, async () => leases(
      ['first', 'first-job'],
      ['second', 'second-job'],
    )))
      .resolves.toEqual({ removed: 0, retained: 2 });
  });

  it('refreshes leases before deletion and tolerates a new active snapshot during traversal', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m42-reconcile-'));
    roots.push(root);
    const directory = path.join(root, 'worker-tmp', 'job');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'stale.snapshot.json.gz'), 'stale');
    let reads = 0;
    const readActiveLeases = async (): Promise<Map<string, string>> => {
      reads += 1;
      if (reads === 2) {
        await writeFile(path.join(directory, 'new-owner.replay-snapshot.json.gz'), 'new active');
        return leases(['new-owner', 'job']);
      }
      return leases();
    };

    await expect(reconcileWorkerTemp(root, readActiveLeases))
      .resolves.toEqual({ removed: 1, retained: 0 });
    await expect(readFile(
      path.join(directory, 'new-owner.replay-snapshot.json.gz'),
      'utf8',
    )).resolves.toBe('new active');
  });

  it('is idempotent after removing stale snapshots and empty job directories', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m42-reconcile-'));
    roots.push(root);
    const directory = path.join(root, 'worker-tmp', 'empty-job');
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'stale.snapshot.json.gz'), 'stale');

    await expect(reconcileWorkerTemp(root, async () => leases()))
      .resolves.toEqual({ removed: 1, retained: 0 });
    await expect(reconcileWorkerTemp(root, async () => leases()))
      .resolves.toEqual({ removed: 0, retained: 0 });
  });

  it('does not traverse a worker-tmp symlink outside DATA_DIR', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m42-reconcile-root-'));
    const outside = await mkdtemp(path.join(os.tmpdir(), 'wrc-m42-reconcile-outside-'));
    roots.push(root, outside);
    await writeFile(path.join(outside, 'private.snapshot.json.gz'), 'keep');
    await symlink(outside, path.join(root, 'worker-tmp'), 'junction');

    await expect(reconcileWorkerTemp(root, async () => leases()))
      .rejects.toThrow('SYMLINK_ARTIFACT_PATH');
    await expect(readFile(path.join(outside, 'private.snapshot.json.gz'), 'utf8'))
      .resolves.toBe('keep');
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
