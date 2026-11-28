import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { matchArtifactSchema, type CanonicalMatchResult } from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import {
  buildCanonicalMatchResult,
  HISTORICAL_H1_PARTICIPATION_POLICY_IDENTITY,
} from '@who-ruined/scoring';
import { syntheticValidMatch } from '@who-ruined/testkit';
import {
  createPostgresTestDatabase,
  postgresIntegrationAvailable,
  type PostgresTestDatabase,
} from '../../../../packages/database/test/postgres-test-database.js';
import { runEvpBackfill } from '../src/backfill-evp.js';
import { readStoredEvpReport } from '../src/evp-report-storage.js';
import { publishCanonicalMatchResult } from '../src/match-result-storage.js';
import { reconcileOrphanedMatchResults } from '../src/reconcile.js';
import { syntheticParticipationSidecar } from './fixtures/synthetic-participation-sidecar.js';
import { waitForMatchArtifactLockWait } from './fixtures/postgres-lock-wait.js';

const databases: PostgresTestDatabase[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function canonical() {
  const match = syntheticValidMatch();
  return buildCanonicalMatchResult({
    artifact: matchArtifactSchema.parse({
      schemaVersion: 'm2-artifact-1',
      match,
      analytics: computeMatchAnalytics(match),
    }),
    sidecar: syntheticParticipationSidecar(),
    productionReports: [],
    sourceDemoRetained: false,
    createdAt: '2026-11-08T00:00:00.000Z',
  });
}

async function fixture(result: CanonicalMatchResult = canonical(), clientCount = 1) {
  const database = await createPostgresTestDatabase(clientCount);
  databases.push(database);
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'wrc-evp-backfill-'));
  roots.push(dataRoot);
  const published = await publishCanonicalMatchResult(dataRoot, result);
  const client = database.clients[0]!;
  await client.match.create({
    data: {
      id: result.artifact.match.matchId,
      originalFileName: 'synthetic.dem',
      fileSha256: result.artifact.match.fileSha256,
      status: 'COMPLETED',
      quality: 'VALID',
      parserVersion: 'synthetic-parser',
      normalizerVersion: 'synthetic-normalizer',
      resultFilePath: published.relativePath,
      resultSchemaVersion: result.schemaVersion,
      resultSha256: published.sha256,
      resultPolicyId: result.internal.selectedPolicyId,
      resultPolicyDigest: result.internal.selectedPolicyDigest,
    },
  });
  return { client, clients: database.clients, dataRoot, result };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

describe.skipIf(!postgresIntegrationAvailable)('EVP historical backfill on PostgreSQL', () => {
  it('supports dry-run, apply, idempotent reuse, and active-job blocking', async () => {
    const { client, dataRoot, result } = await fixture();
    const output: string[] = [];
    const errors: string[] = [];
    const shared = {
      client,
      dataRoot,
      matchId: result.artifact.match.matchId,
      writeOutput: (line: string) => output.push(line),
      writeError: (line: string) => errors.push(line),
    };

    await expect(runEvpBackfill({ ...shared, mode: 'dry-run' })).resolves.toEqual({
      mode: 'dry-run', matches: 1, created: 0, reused: 0, blocked: 0,
    });
    expect(output).toEqual([expect.stringContaining('WOULD_CREATE')]);
    await expect(client.match.findUnique({ where: { id: result.artifact.match.matchId } }))
      .resolves.toMatchObject({ evpFilePath: null, evpSha256: null });

    output.length = 0;
    await expect(runEvpBackfill({ ...shared, mode: 'apply' })).resolves.toEqual({
      mode: 'apply', matches: 1, created: 1, reused: 0, blocked: 0,
    });
    const persisted = await client.match.findUniqueOrThrow({
      where: { id: result.artifact.match.matchId },
    });
    expect(persisted).toMatchObject({
      evpSchemaVersion: 'evp-report@1',
      evpPolicyId: 'evp-policy@1-experimental',
    });
    expect(persisted.evpFilePath).toMatch(/^experimental\/evp\//u);
    expect(persisted.evpSha256).toMatch(/^[a-f0-9]{64}$/u);

    output.length = 0;
    await expect(runEvpBackfill({ ...shared, mode: 'apply' })).resolves.toEqual({
      mode: 'apply', matches: 1, created: 0, reused: 1, blocked: 0,
    });
    expect(output).toEqual([expect.stringContaining('REUSED')]);

    await client.match.update({
      where: { id: result.artifact.match.matchId },
      data: {
        evpFilePath: null,
        evpSchemaVersion: null,
        evpSha256: null,
        evpPolicyId: null,
        evpBindingDigest: null,
      },
    });
    await client.job.create({
      data: {
        id: 'active-job',
        matchId: result.artifact.match.matchId,
        type: 'RESCORE',
        status: 'SCORING',
        stage: 'SCORING',
      },
    });
    errors.length = 0;
    await expect(runEvpBackfill({ ...shared, mode: 'apply' })).resolves.toEqual({
      mode: 'apply', matches: 1, created: 0, reused: 0, blocked: 1,
    });
    expect(errors).toEqual([expect.stringContaining('MATCH_ACTIVE')]);
    await expect(client.match.findUnique({ where: { id: result.artifact.match.matchId } }))
      .resolves.toMatchObject({ evpFilePath: null, evpSha256: null });

    await client.job.update({
      where: { id: 'active-job' },
      data: { status: 'COMPLETED', stage: 'COMPLETED' },
    });
    await client.match.update({
      where: { id: result.artifact.match.matchId },
      data: {
        evpFilePath: persisted.evpFilePath,
        evpSchemaVersion: persisted.evpSchemaVersion,
        evpSha256: persisted.evpSha256,
        evpPolicyId: 'incompatible-policy',
        evpBindingDigest: persisted.evpBindingDigest,
      },
    });
    errors.length = 0;
    await expect(runEvpBackfill({ ...shared, mode: 'apply' })).resolves.toEqual({
      mode: 'apply', matches: 1, created: 0, reused: 0, blocked: 1,
    });
    expect(errors).toEqual([expect.stringContaining('EVP_POINTER_INCOMPATIBLE')]);
    await expect(client.match.findUnique({ where: { id: result.artifact.match.matchId } }))
      .resolves.toMatchObject({ evpPolicyId: 'incompatible-policy' });
  });

  it('blocks historical H1 and directs the owner to rating:rebuild', async () => {
    const historical = structuredClone(canonical());
    historical.internal.selectedPolicySelector = 'H1';
    historical.internal.selectedPolicyId = HISTORICAL_H1_PARTICIPATION_POLICY_IDENTITY.id;
    historical.internal.selectedPolicyDigest = HISTORICAL_H1_PARTICIPATION_POLICY_IDENTITY.digest;
    const { client, dataRoot, result } = await fixture(historical);
    const errors: string[] = [];

    await expect(runEvpBackfill({
      client,
      dataRoot,
      mode: 'apply',
      matchId: result.artifact.match.matchId,
      writeOutput: () => undefined,
      writeError: (line) => errors.push(line),
    })).resolves.toMatchObject({ blocked: 1, created: 0 });
    expect(errors).toEqual([
      expect.stringContaining('CANONICAL_POLICY_NOT_H2_RUN_RATING_REBUILD_FIRST'),
    ]);
    await expect(client.match.findUniqueOrThrow({ where: { id: result.artifact.match.matchId } }))
      .resolves.toMatchObject({ evpFilePath: null, evpSha256: null });
  });

  it('keeps a published EVP protected until its pointer commits across connections', async () => {
    const { clients, dataRoot, result } = await fixture(canonical(), 3);
    const [publisher, reconciler, observer] = clients;
    const published = deferred();
    const allowCommit = deferred();
    const backfill = runEvpBackfill({
      client: publisher!,
      dataRoot,
      mode: 'apply',
      matchId: result.artifact.match.matchId,
      writeOutput: () => undefined,
      writeError: () => undefined,
      afterPublishBeforePointer: async () => {
        published.resolve();
        await allowCommit.promise;
      },
    });
    await published.promise;
    const reconciliation = reconcileOrphanedMatchResults(dataRoot, { client: reconciler! });
    await waitForMatchArtifactLockWait(observer!, result.artifact.match.matchId);
    allowCommit.resolve();

    await expect(backfill).resolves.toMatchObject({ created: 1, blocked: 0 });
    await expect(reconciliation).resolves.toMatchObject({ removed: 0 });
    const persisted = await publisher!.match.findUniqueOrThrow({
      where: { id: result.artifact.match.matchId },
    });
    await expect(access(path.join(dataRoot, persisted.evpFilePath!))).resolves.toBeUndefined();
    await expect(readStoredEvpReport(
      dataRoot,
      persisted.evpFilePath!,
      persisted.evpSha256!,
      result,
    )).resolves.toMatchObject({
      matchId: result.artifact.match.matchId,
      binding: { inputDigest: persisted.evpBindingDigest },
    });
  });

  it('removes a rolled-back publication on the next reconciliation', async () => {
    const { client, clients, dataRoot, result } = await fixture(canonical(), 2);
    await expect(runEvpBackfill({
      client,
      dataRoot,
      mode: 'apply',
      matchId: result.artifact.match.matchId,
      writeOutput: () => undefined,
      writeError: () => undefined,
      afterPublishBeforePointer: () => { throw new Error('SIMULATED_PROCESS_LOSS_BEFORE_COMMIT'); },
    })).resolves.toMatchObject({ blocked: 1, created: 0 });
    const evpDirectory = path.join(dataRoot, 'experimental', 'evp', result.artifact.match.matchId);
    await expect(access(evpDirectory)).resolves.toBeUndefined();
    await expect(reconcileOrphanedMatchResults(dataRoot, { client: clients[1]! }))
      .resolves.toMatchObject({ removed: 1 });
    await expect(access(evpDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('publishes safely after reconciliation acquires the match lock first', async () => {
    const { clients, dataRoot, result } = await fixture(canonical(), 2);
    const evpDirectory = path.join(dataRoot, 'experimental', 'evp', result.artifact.match.matchId);
    const orphan = path.join(evpDirectory, 'orphan.json.gz');
    await mkdir(evpDirectory, { recursive: true });
    await writeFile(orphan, 'orphan');
    const locked = deferred();
    const allowReconciliation = deferred();
    const reconciliation = reconcileOrphanedMatchResults(dataRoot, {
      client: clients[1]!,
      afterMatchLock: async () => {
        locked.resolve();
        await allowReconciliation.promise;
      },
    });
    await locked.promise;
    const backfill = runEvpBackfill({
      client: clients[0]!,
      dataRoot,
      mode: 'apply',
      matchId: result.artifact.match.matchId,
      writeOutput: () => undefined,
      writeError: () => undefined,
    });
    allowReconciliation.resolve();

    await expect(reconciliation).resolves.toMatchObject({ removed: 1 });
    await expect(backfill).resolves.toMatchObject({ created: 1, blocked: 0 });
    await expect(access(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
    const persisted = await clients[0]!.match.findUniqueOrThrow({
      where: { id: result.artifact.match.matchId },
    });
    await expect(readStoredEvpReport(
      dataRoot,
      persisted.evpFilePath!,
      persisted.evpSha256!,
      result,
    )).resolves.toMatchObject({
      matchId: result.artifact.match.matchId,
      binding: { inputDigest: persisted.evpBindingDigest },
    });
  });
});
