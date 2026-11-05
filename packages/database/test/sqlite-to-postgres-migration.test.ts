import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateSqliteToPostgres } from '../src/migrate-sqlite-to-postgres.js';
import {
  createPostgresTestDatabase,
  postgresIntegrationAvailable,
  type PostgresTestDatabase,
} from './postgres-test-database.js';

const roots: string[] = [];
const databases: PostgresTestDatabase[] = [];
const archivedMigrations = [
  '20261015000000_initial_schema',
  '20261025190000_m42_job_fencing',
  '20261026120000_m43_compact_match_result',
] as const;

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.dispose()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function sourceFixture(options: {
  activeJob?: boolean;
  numericDates?: boolean;
} = {}): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-sqlite-migration-'));
  roots.push(root);
  const source = path.join(root, 'synthetic-owner.db');
  const database = new DatabaseSync(source);
  try {
    for (const migration of archivedMigrations) {
      const sql = await readFile(fileURLToPath(new URL(
        `../../../prisma/migrations-sqlite-archive/${migration}/migration.sql`,
        import.meta.url,
      )), 'utf8');
      database.exec(sql);
    }
    const createdAtIso = '2026-11-01T10:20:30.123Z';
    const createdAt = options.numericDates ? Date.parse(createdAtIso) : createdAtIso;
    const match = database.prepare(`
      INSERT INTO "Match" (
        "id", "originalFileName", "fileSha256", "map", "status", "quality",
        "createdAt", "updatedAt", "parserVersion", "normalizerVersion",
        "normalizedFilePath", "rawFilePath", "resultFilePath",
        "resultSchemaVersion", "resultSha256", "resultPolicyId",
        "resultPolicyDigest", "sourceDeletedAt", "deletionState",
        "deletionRequestedAt", "winningTeamId", "losingTeamId"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    match.run(
      'completed-match', 'completed.dem', 'a'.repeat(64), 'de_dust2',
      'COMPLETED', 'VALID', createdAt, createdAt, 'parser', 'normalizer',
      null, null, 'results/completed/result.json.gz', 'match-result@1',
      'b'.repeat(64), 'h2-policy', 'c'.repeat(64), createdAt, null, null,
      'team-a', 'team-b',
    );
    match.run(
      'partial-match', 'partial.dem', 'd'.repeat(64), null,
      'PARTIAL', 'PARTIAL', createdAt, createdAt, 'parser', 'normalizer',
      'cache/partial.json.gz', null, 'results/partial/result.json.gz',
      'match-result@1', 'e'.repeat(64), 'h2-policy', 'f'.repeat(64),
      null, null, null, null, null,
    );
    database.prepare(`
      INSERT INTO "Job" (
        "id", "matchId", "type", "status", "stage", "attempts",
        "leaseUntil", "leaseToken", "errorCode", "errorMessage",
        "requestedScoringVersion", "requestedConfigHash", "createdAt", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'job', 'completed-match', 'PARSE', options.activeJob ? 'QUEUED' : 'COMPLETED',
      options.activeJob ? 'QUEUED' : 'COMPLETED', 2, null, null, null,
      null, null, null, createdAt, createdAt,
    );
    database.prepare(`
      INSERT INTO "Report" (
        "id", "matchId", "scoringVersion", "configHash", "jsonFilePath",
        "createdAt", "quality"
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      'report', 'completed-match', 'legacy-v1', '1'.repeat(64),
      'reports/completed/legacy.json.gz', createdAt, 'VALID',
    );
  } finally {
    database.close();
  }
  return source;
}

async function fileHash(file: string): Promise<string> {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

describe('synthetic SQLite migration source safeguards', () => {
  it('blocks an active source Job before opening PostgreSQL', async () => {
    const source = await sourceFixture({ activeJob: true });

    await expect(migrateSqliteToPostgres({
      sqlitePath: source,
      postgresUrl: 'postgresql://unused:unused@127.0.0.1:1/unused',
    })).rejects.toThrow('SQLITE_ACTIVE_JOBS_PRESENT');
  });
});

describe.skipIf(!postgresIntegrationAvailable)('synthetic SQLite to PostgreSQL migration', () => {
  it('preserves rows, nullable fields, relationships and result metadata exactly', async () => {
    const source = await sourceFixture();
    const sourceHash = await fileHash(source);
    const destination = await createPostgresTestDatabase();
    databases.push(destination);

    await expect(migrateSqliteToPostgres({
      sqlitePath: source,
      postgresUrl: destination.databaseUrl,
      dryRun: true,
    })).resolves.toMatchObject({ matches: 2, jobs: 1, reports: 1, dryRun: true });
    await expect(destination.clients[0]!.match.count()).resolves.toBe(0);

    await expect(migrateSqliteToPostgres({
      sqlitePath: source,
      postgresUrl: destination.databaseUrl,
    })).resolves.toMatchObject({ matches: 2, jobs: 1, reports: 1, dryRun: false });

    await expect(destination.clients[0]!.match.findMany({ orderBy: { id: 'asc' } }))
      .resolves.toEqual([
        expect.objectContaining({
          id: 'completed-match',
          status: 'COMPLETED',
          resultFilePath: 'results/completed/result.json.gz',
          sourceDeletedAt: new Date('2026-11-01T10:20:30.123Z'),
        }),
        expect.objectContaining({
          id: 'partial-match',
          status: 'PARTIAL',
          quality: 'PARTIAL',
          map: null,
          rawFilePath: null,
        }),
      ]);
    await expect(destination.clients[0]!.job.findUnique({ where: { id: 'job' } }))
      .resolves.toMatchObject({ matchId: 'completed-match', attempts: 2, leaseToken: null });
    await expect(destination.clients[0]!.report.findUnique({ where: { id: 'report' } }))
      .resolves.toMatchObject({ matchId: 'completed-match', quality: 'VALID' });
    await expect(migrateSqliteToPostgres({
      sqlitePath: source,
      postgresUrl: destination.databaseUrl,
    })).rejects.toThrow('POSTGRESQL_DESTINATION_NOT_EMPTY');
    await expect(fileHash(source)).resolves.toBe(sourceHash);
  });

  it('rolls back every destination row when PostgreSQL rejects an imported job', async () => {
    const source = await sourceFixture();
    const destination = await createPostgresTestDatabase();
    databases.push(destination);
    await destination.clients[0]!.$executeRawUnsafe(`
      ALTER TABLE "Job"
      ADD CONSTRAINT "synthetic_reject_imported_job" CHECK ("id" <> 'job')
    `);

    await expect(migrateSqliteToPostgres({
      sqlitePath: source,
      postgresUrl: destination.databaseUrl,
    })).rejects.toThrow();
    await expect(Promise.all([
      destination.clients[0]!.match.count(),
      destination.clients[0]!.job.count(),
      destination.clients[0]!.report.count(),
    ])).resolves.toEqual([0, 0, 0]);
  });

  it('preserves legacy numeric millisecond timestamps and nullable dates exactly', async () => {
    const source = await sourceFixture({ numericDates: true });
    const destination = await createPostgresTestDatabase();
    databases.push(destination);
    const expected = new Date('2026-11-01T10:20:30.123Z');

    await migrateSqliteToPostgres({
      sqlitePath: source,
      postgresUrl: destination.databaseUrl,
    });

    const [completed, partial, job, report] = await Promise.all([
      destination.clients[0]!.match.findUniqueOrThrow({ where: { id: 'completed-match' } }),
      destination.clients[0]!.match.findUniqueOrThrow({ where: { id: 'partial-match' } }),
      destination.clients[0]!.job.findUniqueOrThrow({ where: { id: 'job' } }),
      destination.clients[0]!.report.findUniqueOrThrow({ where: { id: 'report' } }),
    ]);

    expect(completed.createdAt).toEqual(expected);
    expect(completed.updatedAt).toEqual(expected);
    expect(completed.sourceDeletedAt).toEqual(expected);
    expect(completed.deletionRequestedAt).toBeNull();
    expect(partial.createdAt).toEqual(expected);
    expect(partial.sourceDeletedAt).toBeNull();
    expect(partial.deletionRequestedAt).toBeNull();
    expect(job.createdAt).toEqual(expected);
    expect(job.updatedAt).toEqual(expected);
    expect(job.leaseUntil).toBeNull();
    expect(report.createdAt).toEqual(expected);
  });
});
