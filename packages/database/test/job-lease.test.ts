import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/client/index.js';
import { createJobRepository } from '../src/index.js';

const roots: string[] = [];
const clients: PrismaClient[] = [];

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-m42-lease-'));
  roots.push(root);
  const databasePath = path.join(root, 'lease.db');
  const sql = new DatabaseSync(databasePath);
  sql.exec(`
    CREATE TABLE Match (
      id TEXT PRIMARY KEY, originalFileName TEXT NOT NULL, fileSha256 TEXT NOT NULL,
      map TEXT, status TEXT NOT NULL, quality TEXT, createdAt DATETIME NOT NULL,
      updatedAt DATETIME NOT NULL, parserVersion TEXT NOT NULL, normalizerVersion TEXT NOT NULL,
      normalizedFilePath TEXT, rawFilePath TEXT, winningTeamId TEXT, losingTeamId TEXT
    );
    CREATE TABLE Job (
      id TEXT PRIMARY KEY, matchId TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL,
      stage TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, leaseUntil DATETIME,
      leaseToken TEXT, errorCode TEXT, errorMessage TEXT, requestedScoringVersion TEXT,
      requestedConfigHash TEXT, createdAt DATETIME NOT NULL, updatedAt DATETIME NOT NULL,
      FOREIGN KEY(matchId) REFERENCES Match(id) ON DELETE CASCADE
    );
    CREATE INDEX Job_status_createdAt_idx ON Job(status, createdAt);
    CREATE INDEX Job_leaseUntil_idx ON Job(leaseUntil);
  `);
  const now = new Date().toISOString();
  sql.prepare('INSERT INTO Match (id,originalFileName,fileSha256,status,createdAt,updatedAt,parserVersion,normalizerVersion) VALUES (?,?,?,?,?,?,?,?)')
    .run('match', 'fixture.dem', 'a'.repeat(64), 'QUEUED', now, now, 'parser', 'normalizer');
  sql.prepare('INSERT INTO Job (id,matchId,type,status,stage,attempts,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?,?)')
    .run('job', 'match', 'PARSE', 'QUEUED', 'QUEUED', 0, now, now);
  sql.close();
  const url = `file:${databasePath.replaceAll('\\', '/')}`;
  const first = new PrismaClient({ datasourceUrl: url });
  const second = new PrismaClient({ datasourceUrl: url });
  clients.push(first, second);
  return { first, second };
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.$disconnect()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('durable job ownership', () => {
  it('allows only one of two workers to claim one queued job', async () => {
    const { first, second } = await fixture();
    const policy = { leaseMs: 30_000, maxAttempts: 3 };
    const [a, b] = await Promise.all([
      createJobRepository(first).claimNextJob(policy),
      createJobRepository(second).claimNextJob(policy)
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect((a ?? b)?.attempt).toBe(1);
  });

  it('reclaims an expired lease and fences the late former owner', async () => {
    const { first, second } = await fixture();
    const policy = { leaseMs: 1_000, maxAttempts: 3 };
    const old = await createJobRepository(first).claimNextJob(policy, new Date('2026-01-01T00:00:00.000Z'));
    expect(old).not.toBeNull();
    const replacement = await createJobRepository(second).claimNextJob(policy, new Date('2026-01-01T00:00:02.000Z'));
    expect(replacement?.attempt).toBe(2);
    await expect(createJobRepository(first).advanceStage('job', old!.leaseToken, 'SCORING', 1_000, new Date('2026-01-01T00:00:02.100Z')))
      .rejects.toThrow('STALE_JOB_OWNER');
    await expect(createJobRepository(second).advanceStage('job', replacement!.leaseToken, 'NORMALIZING', 1_000, new Date('2026-01-01T00:00:02.100Z')))
      .resolves.toBeUndefined();
  });

  it('terminally fails an expired job after its finite attempt budget', async () => {
    const { first } = await fixture();
    await first.job.update({
      where: { id: 'job' },
      data: { status: 'PARSING', stage: 'PARSING', attempts: 3, leaseToken: 'old', leaseUntil: new Date('2026-01-01T00:00:00.000Z') }
    });
    const result = await createJobRepository(first).recoverExpiredJobs({ leaseMs: 1_000, maxAttempts: 3 }, new Date('2026-01-01T00:00:01.000Z'));
    expect(result).toEqual({ requeued: 0, failed: 1 });
    await expect(first.job.findUnique({ where: { id: 'job' } })).resolves.toMatchObject({ status: 'FAILED', errorCode: 'WORKER_RECOVERY_EXHAUSTED', leaseToken: null });
  });
});
