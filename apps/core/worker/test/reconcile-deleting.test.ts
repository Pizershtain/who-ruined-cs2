import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  findMany: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock('@who-ruined/database', async (importOriginal) => ({
  ...await importOriginal<typeof import('@who-ruined/database')>(),
  prisma: {
    match: {
      findMany: database.findMany,
      deleteMany: database.deleteMany,
    },
  },
}));

import { reconcileDeletingMatches } from '../src/reconcile.js';

const roots: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('deleting match reconciliation', () => {
  it('does not remove a DELETING match that still has a QUEUED job', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-delete-reconcile-'));
    roots.push(root);
    database.findMany.mockResolvedValue([{
      id: 'match',
      rawFilePath: null,
      normalizedFilePath: null,
      resultFilePath: null,
      jobs: [{ status: 'QUEUED' }],
      reports: [],
    }]);

    await expect(reconcileDeletingMatches(root)).resolves.toBe(0);
    expect(database.deleteMany).not.toHaveBeenCalled();
  });
});
