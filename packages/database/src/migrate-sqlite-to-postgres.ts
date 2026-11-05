import { createHash } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  Prisma,
  PrismaClient,
} from '../generated/client/index.js';
import { UNFINISHED_JOB_STATUSES } from './job-status.js';

type SqliteRow = Record<string, SQLOutputValue>;

const SOURCE_COLUMNS = {
  Match: [
    'id', 'originalFileName', 'fileSha256', 'map', 'status', 'quality',
    'createdAt', 'updatedAt', 'parserVersion', 'normalizerVersion',
    'normalizedFilePath', 'rawFilePath', 'resultFilePath',
    'resultSchemaVersion', 'resultSha256', 'resultPolicyId',
    'resultPolicyDigest', 'sourceDeletedAt', 'deletionState',
    'deletionRequestedAt', 'winningTeamId', 'losingTeamId',
  ],
  Job: [
    'id', 'matchId', 'type', 'status', 'stage', 'attempts', 'leaseUntil',
    'leaseToken', 'errorCode', 'errorMessage', 'requestedScoringVersion',
    'requestedConfigHash', 'createdAt', 'updatedAt',
  ],
  Report: [
    'id', 'matchId', 'scoringVersion', 'configHash', 'jsonFilePath',
    'createdAt', 'quality',
  ],
} as const;

interface MigrationSnapshot {
  matches: Prisma.MatchCreateManyInput[];
  jobs: Prisma.JobCreateManyInput[];
  reports: Prisma.ReportCreateManyInput[];
}

export interface SqliteToPostgresMigrationOptions {
  sqlitePath: string;
  postgresUrl: string;
  dryRun?: boolean;
}

export interface SqliteToPostgresMigrationResult {
  dryRun: boolean;
  matches: number;
  jobs: number;
  reports: number;
  fingerprint: string;
}

function requiredString(row: SqliteRow, name: string): string {
  const value = row[name];
  if (typeof value !== 'string') throw new Error(`SQLITE_INVALID_${name}`);
  return value;
}

function nullableString(row: SqliteRow, name: string): string | null {
  const value = row[name];
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`SQLITE_INVALID_${name}`);
  return value;
}

function requiredInteger(row: SqliteRow, name: string): number {
  const value = row[name];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`SQLITE_INVALID_${name}`);
  }
  return value;
}

function dateValue(value: SQLOutputValue, name: string): Date {
  let date: Date;
  if (typeof value === 'string' || typeof value === 'number') {
    date = new Date(value);
  } else if (typeof value === 'bigint' && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    date = new Date(Number(value));
  } else {
    throw new Error(`SQLITE_INVALID_${name}`);
  }
  if (Number.isNaN(date.getTime())) throw new Error(`SQLITE_INVALID_${name}`);
  return date;
}

function requiredDate(row: SqliteRow, name: string): Date {
  return dateValue(row[name] ?? null, name);
}

function nullableDate(row: SqliteRow, name: string): Date | null {
  const value = row[name];
  if (value === undefined) throw new Error(`SQLITE_MISSING_${name}`);
  return value === null ? null : dateValue(value, name);
}

function matchRow(row: SqliteRow): Prisma.MatchCreateManyInput {
  return {
    id: requiredString(row, 'id'),
    originalFileName: requiredString(row, 'originalFileName'),
    fileSha256: requiredString(row, 'fileSha256'),
    map: nullableString(row, 'map'),
    status: requiredString(row, 'status'),
    quality: nullableString(row, 'quality'),
    createdAt: requiredDate(row, 'createdAt'),
    updatedAt: requiredDate(row, 'updatedAt'),
    parserVersion: requiredString(row, 'parserVersion'),
    normalizerVersion: requiredString(row, 'normalizerVersion'),
    normalizedFilePath: nullableString(row, 'normalizedFilePath'),
    rawFilePath: nullableString(row, 'rawFilePath'),
    resultFilePath: nullableString(row, 'resultFilePath'),
    resultSchemaVersion: nullableString(row, 'resultSchemaVersion'),
    resultSha256: nullableString(row, 'resultSha256'),
    resultPolicyId: nullableString(row, 'resultPolicyId'),
    resultPolicyDigest: nullableString(row, 'resultPolicyDigest'),
    sourceDeletedAt: nullableDate(row, 'sourceDeletedAt'),
    deletionState: nullableString(row, 'deletionState'),
    deletionRequestedAt: nullableDate(row, 'deletionRequestedAt'),
    winningTeamId: nullableString(row, 'winningTeamId'),
    losingTeamId: nullableString(row, 'losingTeamId'),
  };
}

function jobRow(row: SqliteRow): Prisma.JobCreateManyInput {
  return {
    id: requiredString(row, 'id'),
    matchId: requiredString(row, 'matchId'),
    type: requiredString(row, 'type'),
    status: requiredString(row, 'status'),
    stage: requiredString(row, 'stage'),
    attempts: requiredInteger(row, 'attempts'),
    leaseUntil: nullableDate(row, 'leaseUntil'),
    leaseToken: nullableString(row, 'leaseToken'),
    errorCode: nullableString(row, 'errorCode'),
    errorMessage: nullableString(row, 'errorMessage'),
    requestedScoringVersion: nullableString(row, 'requestedScoringVersion'),
    requestedConfigHash: nullableString(row, 'requestedConfigHash'),
    createdAt: requiredDate(row, 'createdAt'),
    updatedAt: requiredDate(row, 'updatedAt'),
  };
}

function reportRow(row: SqliteRow): Prisma.ReportCreateManyInput {
  return {
    id: requiredString(row, 'id'),
    matchId: requiredString(row, 'matchId'),
    scoringVersion: requiredString(row, 'scoringVersion'),
    configHash: requiredString(row, 'configHash'),
    jsonFilePath: requiredString(row, 'jsonFilePath'),
    createdAt: requiredDate(row, 'createdAt'),
    quality: requiredString(row, 'quality'),
  };
}

function tableRows(database: DatabaseSync, table: keyof typeof SOURCE_COLUMNS): SqliteRow[] {
  return database.prepare(`SELECT * FROM "${table}" ORDER BY "id"`).all() as SqliteRow[];
}

function assertSourceSchema(database: DatabaseSync): void {
  const quickCheck = database.prepare('PRAGMA quick_check').get() as SqliteRow | undefined;
  if (!quickCheck || Object.values(quickCheck)[0] !== 'ok') {
    throw new Error('SQLITE_INTEGRITY_CHECK_FAILED');
  }
  const foreignKeyFailures = database.prepare('PRAGMA foreign_key_check').all();
  if (foreignKeyFailures.length > 0) throw new Error('SQLITE_FOREIGN_KEY_CHECK_FAILED');

  for (const [table, expectedColumns] of Object.entries(SOURCE_COLUMNS)) {
    const columns = database.prepare(`PRAGMA table_info("${table}")`).all() as SqliteRow[];
    if (columns.length === 0) throw new Error(`SQLITE_MISSING_TABLE_${table}`);
    const actual = columns.map((column) => requiredString(column, 'name')).sort();
    const expected = [...expectedColumns].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`SQLITE_UNSUPPORTED_SCHEMA_${table}`);
    }
  }
}

function readSnapshot(sqlitePath: string): MigrationSnapshot {
  const database = new DatabaseSync(sqlitePath, {
    readOnly: true,
    enableForeignKeyConstraints: true,
  });
  try {
    database.exec('PRAGMA query_only = ON; BEGIN;');
    try {
      assertSourceSchema(database);
      const snapshot = {
        matches: tableRows(database, 'Match').map(matchRow),
        jobs: tableRows(database, 'Job').map(jobRow),
        reports: tableRows(database, 'Report').map(reportRow),
      };
      if (snapshot.jobs.some((job) => (
        UNFINISHED_JOB_STATUSES as readonly string[]
      ).includes(job.status))) {
        throw new Error('SQLITE_ACTIVE_JOBS_PRESENT');
      }
      database.exec('COMMIT;');
      return snapshot;
    } catch (error) {
      database.exec('ROLLBACK;');
      throw error;
    }
  } finally {
    database.close();
  }
}

function comparable(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(comparable);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, comparable(entry)]));
  }
  return value;
}

function snapshotFingerprint(snapshot: MigrationSnapshot): string {
  return createHash('sha256').update(JSON.stringify(comparable({
    matches: [...snapshot.matches].sort((a, b) => a.id.localeCompare(b.id)),
    jobs: [...snapshot.jobs].sort((a, b) => a.id.localeCompare(b.id)),
    reports: [...snapshot.reports].sort((a, b) => a.id.localeCompare(b.id)),
  }))).digest('hex');
}

async function assertDestinationReady(client: PrismaClient): Promise<void> {
  const version = await client.$queryRaw<Array<{ version: string }>>`
    SELECT current_setting('server_version_num') AS version
  `;
  if (Number(version[0]?.version ?? 0) < 170000) {
    throw new Error('POSTGRESQL_17_OR_NEWER_REQUIRED');
  }
  const [matches, jobs, reports] = await Promise.all([
    client.match.count(),
    client.job.count(),
    client.report.count(),
  ]);
  if (matches !== 0 || jobs !== 0 || reports !== 0) {
    throw new Error('POSTGRESQL_DESTINATION_NOT_EMPTY');
  }
}

async function importSnapshot(
  client: PrismaClient,
  snapshot: MigrationSnapshot,
): Promise<void> {
  const expectedFingerprint = snapshotFingerprint(snapshot);
  await client.$transaction(async (transaction) => {
    if (snapshot.matches.length > 0) {
      await transaction.match.createMany({ data: snapshot.matches });
    }
    if (snapshot.jobs.length > 0) {
      await transaction.job.createMany({ data: snapshot.jobs });
    }
    if (snapshot.reports.length > 0) {
      await transaction.report.createMany({ data: snapshot.reports });
    }
    const actual: MigrationSnapshot = {
      matches: await transaction.match.findMany({ orderBy: { id: 'asc' } }),
      jobs: await transaction.job.findMany({ orderBy: { id: 'asc' } }),
      reports: await transaction.report.findMany({ orderBy: { id: 'asc' } }),
    };
    if (snapshotFingerprint(actual) !== expectedFingerprint) {
      throw new Error('POSTGRESQL_IMPORT_INTEGRITY_MISMATCH');
    }
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    maxWait: 10_000,
    timeout: 5 * 60_000,
  });
}

export async function migrateSqliteToPostgres(
  options: SqliteToPostgresMigrationOptions,
): Promise<SqliteToPostgresMigrationResult> {
  const sqlitePath = path.resolve(options.sqlitePath);
  if (!(await stat(sqlitePath)).isFile()) throw new Error('SQLITE_SOURCE_NOT_FILE');
  if (!/^postgres(?:ql)?:\/\//i.test(options.postgresUrl)) {
    throw new Error('POSTGRESQL_DESTINATION_URL_REQUIRED');
  }
  const snapshot = readSnapshot(sqlitePath);
  const client = new PrismaClient({ datasourceUrl: options.postgresUrl });
  try {
    await client.$connect();
    await assertDestinationReady(client);
    if (!options.dryRun) await importSnapshot(client, snapshot);
  } finally {
    await client.$disconnect();
  }
  return {
    dryRun: options.dryRun ?? false,
    matches: snapshot.matches.length,
    jobs: snapshot.jobs.length,
    reports: snapshot.reports.length,
    fingerprint: snapshotFingerprint(snapshot),
  };
}

function argumentValue(argumentsList: string[], name: string): string | undefined {
  const index = argumentsList.indexOf(name);
  return index === -1 ? undefined : argumentsList[index + 1];
}

async function main(): Promise<void> {
  const argumentsList = process.argv.slice(2);
  const sqlitePath = argumentValue(argumentsList, '--sqlite');
  const postgresUrl = argumentValue(argumentsList, '--postgres-url');
  const postgresUrlEnvironment = argumentValue(argumentsList, '--postgres-url-env');
  const resolvedPostgresUrl = postgresUrl
    ?? (postgresUrlEnvironment ? process.env[postgresUrlEnvironment] : undefined);
  if (!sqlitePath || !resolvedPostgresUrl || (postgresUrl && postgresUrlEnvironment)) {
    throw new Error(
      'Usage: --sqlite <path> (--postgres-url <url> | --postgres-url-env <name>) [--dry-run]',
    );
  }
  const result = await migrateSqliteToPostgres({
    sqlitePath,
    postgresUrl: resolvedPostgresUrl,
    dryRun: argumentsList.includes('--dry-run'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
