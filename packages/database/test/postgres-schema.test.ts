import { afterEach, describe, expect, it } from 'vitest';
import {
  createPostgresTestDatabase,
  postgresIntegrationAvailable,
  type PostgresTestDatabase,
} from './postgres-test-database.js';

const databases: PostgresTestDatabase[] = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.dispose()));
});

function syntheticMatch(id: string, fileSha256: string) {
  return {
    id,
    originalFileName: `${id}.synthetic.dem`,
    fileSha256,
    status: 'COMPLETED',
    parserVersion: 'synthetic-parser',
    normalizerVersion: 'synthetic-normalizer',
  };
}

describe.skipIf(!postgresIntegrationAvailable)('PostgreSQL schema constraints', () => {
  it('enforces unique/FK constraints and cascades Match deletion', async () => {
    const database = await createPostgresTestDatabase();
    databases.push(database);
    const client = database.clients[0]!;

    await client.match.create({ data: syntheticMatch('match', 'a'.repeat(64)) });
    await expect(client.match.create({
      data: syntheticMatch('duplicate', 'a'.repeat(64)),
    })).rejects.toMatchObject({ code: 'P2002' });
    await expect(client.job.create({
      data: {
        id: 'orphan-job',
        matchId: 'missing-match',
        type: 'PARSE',
        status: 'QUEUED',
        stage: 'QUEUED',
      },
    })).rejects.toMatchObject({ code: 'P2003' });

    await client.job.create({
      data: {
        id: 'job',
        matchId: 'match',
        type: 'PARSE',
        status: 'COMPLETED',
        stage: 'COMPLETED',
        leaseUntil: null,
      },
    });
    await client.report.create({
      data: {
        id: 'report',
        matchId: 'match',
        scoringVersion: 'synthetic-scoring',
        configHash: 'b'.repeat(64),
        jsonFilePath: 'reports/match/synthetic.json.gz',
        quality: 'VALID',
      },
    });
    await expect(client.report.create({
      data: {
        id: 'duplicate-report',
        matchId: 'match',
        scoringVersion: 'synthetic-scoring',
        configHash: 'b'.repeat(64),
        jsonFilePath: 'reports/match/duplicate.json.gz',
        quality: 'VALID',
      },
    })).rejects.toMatchObject({ code: 'P2002' });

    await client.match.delete({ where: { id: 'match' } });
    await expect(Promise.all([
      client.job.count({ where: { matchId: 'match' } }),
      client.report.count({ where: { matchId: 'match' } }),
    ])).resolves.toEqual([0, 0]);
  });
});
