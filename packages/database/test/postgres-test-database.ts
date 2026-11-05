import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '../generated/client/index.js';

export const postgresTestDatabaseUrl = process.env.TEST_DATABASE_URL;
export const postgresIntegrationAvailable = Boolean(postgresTestDatabaseUrl);

function schemaUrl(databaseUrl: string, schema: string): string {
  const url = new URL(databaseUrl);
  url.searchParams.set('schema', schema);
  return url.toString();
}

function migrationStatements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\r?\n|$)/u)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export interface PostgresTestDatabase {
  databaseUrl: string;
  clients: PrismaClient[];
  dispose: () => Promise<void>;
}

export async function createPostgresTestDatabase(
  clientCount = 1,
): Promise<PostgresTestDatabase> {
  if (!postgresTestDatabaseUrl) throw new Error('TEST_DATABASE_URL_REQUIRED');
  const schema = `wrc_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new PrismaClient({ datasourceUrl: postgresTestDatabaseUrl });
  try {
    await admin.$connect();
    const version = await admin.$queryRaw<Array<{ version: string }>>`
      SELECT current_setting('server_version_num') AS version
    `;
    if (Number(version[0]?.version ?? 0) < 170000) {
      throw new Error('POSTGRESQL_17_OR_NEWER_REQUIRED');
    }
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
  } catch (error) {
    await admin.$disconnect();
    throw error;
  }

  const clients = Array.from({ length: clientCount }, () => new PrismaClient({
    datasourceUrl: schemaUrl(postgresTestDatabaseUrl, schema),
  }));
  try {
    await clients[0]!.$connect();
    const migration = await readFile(fileURLToPath(new URL(
      '../../../prisma/migrations/20261105000000_postgresql_initial/migration.sql',
      import.meta.url,
    )), 'utf8');
    for (const statement of migrationStatements(migration)) {
      await clients[0]!.$executeRawUnsafe(statement);
    }
    await Promise.all(clients.slice(1).map((client) => client.$connect()));
  } catch (error) {
    await Promise.allSettled(clients.map((client) => client.$disconnect()));
    await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.$disconnect();
    throw error;
  }

  return {
    databaseUrl: schemaUrl(postgresTestDatabaseUrl, schema),
    clients,
    dispose: async () => {
      await Promise.allSettled(clients.map((client) => client.$disconnect()));
      try {
        await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await admin.$disconnect();
      }
    },
  };
}
