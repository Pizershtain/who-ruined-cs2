import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createJobRepository } from '@who-ruined/database';
import {
  createPostgresTestDatabase,
  postgresIntegrationAvailable,
  type PostgresTestDatabase,
} from '../../../../packages/database/test/postgres-test-database.js';
import { reconcileOrphanedMatchResults } from '../src/reconcile.js';

const databases: PostgresTestDatabase[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.skipIf(!postgresIntegrationAvailable)('orphan reconciliation on PostgreSQL', () => {
  it('observes an ordinary worker completion atomically and later removes a real orphan', async () => {
    const database = await createPostgresTestDatabase(2);
    databases.push(database);
    const [reconciler, worker] = database.clients;
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'wrc-reconcile-postgres-'));
    roots.push(dataRoot);
    const matchId = 'ordinary-worker-publication';
    const resultRelative = `results/${matchId}/current.json.gz`;
    const evpRelative = `experimental/evp/${matchId}/current.json.gz`;
    const resultFile = path.join(dataRoot, resultRelative);
    const evpFile = path.join(dataRoot, evpRelative);
    await mkdir(path.dirname(resultFile), { recursive: true });
    await mkdir(path.dirname(evpFile), { recursive: true });
    await writeFile(resultFile, 'result');
    await writeFile(evpFile, 'evp');
    await reconciler!.match.create({
      data: {
        id: matchId,
        originalFileName: 'synthetic.dem',
        fileSha256: 'a'.repeat(64),
        status: 'PROCESSING',
        parserVersion: 'synthetic-parser',
        normalizerVersion: 'synthetic-normalizer',
      },
    });
    const leaseToken = 'worker-lease';
    await reconciler!.job.create({
      data: {
        id: 'ordinary-worker-job',
        matchId,
        type: 'PARSE',
        status: 'SCORING',
        stage: 'SCORING',
        leaseToken,
        leaseUntil: new Date(Date.now() + 60_000),
      },
    });

    let completed = false;
    await expect(reconcileOrphanedMatchResults(dataRoot, {
      client: reconciler!,
      afterMatchLock: async (lockedMatchId) => {
        if (completed || lockedMatchId !== matchId) return;
        completed = true;
        await createJobRepository(worker!).completeOwnedJob({
          jobId: 'ordinary-worker-job',
          matchId,
          leaseToken,
          terminal: 'COMPLETED',
          matchData: {
            status: 'COMPLETED',
            quality: 'VALID',
            resultFilePath: resultRelative,
            evpFilePath: evpRelative,
          },
        });
      },
    })).resolves.toEqual({ removed: 0, retained: 2 });
    await expect(access(resultFile)).resolves.toBeUndefined();
    await expect(access(evpFile)).resolves.toBeUndefined();

    const orphan = path.join(dataRoot, 'experimental', 'evp', matchId, 'orphan.json.gz');
    await writeFile(orphan, 'orphan');
    await expect(reconcileOrphanedMatchResults(dataRoot, { client: reconciler! }))
      .resolves.toEqual({ removed: 1, retained: 2 });
    await expect(access(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(resultFile)).resolves.toBeUndefined();
    await expect(access(evpFile)).resolves.toBeUndefined();
  });
});
