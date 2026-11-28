import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { matchPublicationStateSchema, type MatchPublicationState } from '@who-ruined/contracts';
import { PrismaClient } from '../generated/client/index.js';
import { ProfileAggregateBuilder } from '../src/aggregate.js';
import { ProfilesController } from '../src/profiles-controller.js';
import { ProfileQueries } from '../src/read-profiles.js';
import { ProfileStore } from '../src/store.js';
import { MatchPublicationClient, ProfileSynchronization } from '../src/synchronization.js';

const testUrl = process.env.TEST_PROFILES_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (process.env.REQUIRE_POSTGRES_INTEGRATION === '1' && !testUrl) throw new Error('PROFILE_TEST_DATABASE_REQUIRED');
if (testUrl) {
  const target = new URL(testUrl);
  if (!['postgres:', 'postgresql:'].includes(target.protocol)
    || !['localhost', '127.0.0.1', '[::1]', 'postgres'].includes(target.hostname)
    || !/(^|[_-])test($|[_-])/iu.test(decodeURIComponent(target.pathname).slice(1))) {
    throw new Error('PROFILE_TEST_DATABASE_MUST_BE_LOCAL_AND_DISPOSABLE');
  }
}

const steamId = '76561198000000041';
type Published = Extract<MatchPublicationState, { state: 'PUBLISHED' }>;
const migrations = ['20261127090100_profiles_initial', '20261127210000_profile_aggregates', '20261128120000_profile_pending_scope'];

describe.skipIf(!testUrl)('Profiles persisted aggregates on PostgreSQL', () => {
  const schema = 'wrc_profiles_test_' + randomUUID().replaceAll('-', '');
  let db: PrismaClient;
  let second: PrismaClient;
  let store: ProfileStore;
  let secondStore: ProfileStore;
  let fixture: Published['players'][number];
  let policy: Published['policy'];

  beforeAll(async () => {
    const target = new URL(testUrl!);
    target.searchParams.set('schema', schema);
    db = new PrismaClient({ datasourceUrl: target.href });
    second = new PrismaClient({ datasourceUrl: target.href });
    store = new ProfileStore(db);
    secondStore = new ProfileStore(second);
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    for (const migration of migrations) {
      const sql = await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url), 'utf8');
      for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) await db.$executeRawUnsafe(statement);
    }
    const example = JSON.parse(await readFile(new URL('../../../../docs/examples/player-profile-mixed-data.json', import.meta.url), 'utf8'));
    policy = example.history.matches[0].policy;
    fixture = { ...example.history.matches[0].player, steamId, playerId: steamId };
  }, 20_000);

  afterAll(async () => {
    await second?.$disconnect();
    if (db) {
      try {
        await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await db.$disconnect();
      }
    }
  }, 20_000);

  function state(matchId: string, revision: number, shaInput: string, time: number, kills: number): Published {
    return matchPublicationStateSchema.parse({
      schemaVersion: 'match-publication-state@1', state: 'PUBLISHED', matchId, revision: String(revision),
      fileSha256: createHash('sha256').update(shaInput).digest('hex'),
      uploadedAt: new Date(Date.UTC(2000, 0, 1, 0, 0, time)).toISOString(), playedAt: null,
      map: 'de_mirage', quality: 'VALID', policy,
      players: [{ ...fixture, displayName: matchId, measurements: {
        ...fixture.measurements, kills: { status: 'AVAILABLE', numerator: kills, denominator: null, observedRounds: 7, expectedRounds: 7 },
      } }],
    }) as Published;
  }

  async function publish(snapshot: MatchPublicationState) {
    await store.receive(await store.cursor(), [{
      matchId: snapshot.matchId, revision: snapshot.revision, kind: snapshot.state === 'PUBLISHED' ? 'RESULT_PUBLISHED' : 'MATCH_DELETED',
    }]);
    await store.apply(snapshot);
  }

  function tombstone(matchId: string, revision: number): MatchPublicationState {
    return { matchId, revision: String(revision), schemaVersion: 'match-publication-state@1', state: 'EXCLUDED' };
  }

  async function expectSummary(count: number, kills: number, name: string) {
    const result = (await store.aggregate(steamId)).profile;
    expect(result).toMatchObject({ matchCount: count, displayName: name, measurements: { kills: { value: kills } } });
    const recomputed = new ProfileAggregateBuilder(steamId);
    await store.read(async tx => {
      for (const row of await store.history(tx, steamId, 20, null)) recomputed.add(row);
    });
    expect(result).toEqual(recomputed.build());
  }

  it('keeps one winner per SHA through replacement, late delivery, updates and deletion', async () => {
    const first = state('first', 1, 'synthetic A', 1, 0);
    await publish(first);
    await expectSummary(1, 0, 'first');
    await store.apply(first);
    const secondCopy = state('second-copy', 3, 'synthetic A', 2, 2);
    await publish(secondCopy);
    await expectSummary(1, 2, 'second-copy');
    await publish(state('second-copy', 4, 'synthetic A', 2, 4));
    await store.apply(secondCopy);
    await expectSummary(1, 4, 'second-copy');
    await publish(tombstone('second-copy', 5));
    await expectSummary(1, 0, 'first');
    await publish(tombstone('first', 6));
    expect((await store.aggregate(steamId)).profile).toBeNull();
  });

  it('updates a shared player through concurrent connections and rolls back a failed projection write', async () => {
    const a = state('concurrent-a', 7, 'synthetic B', 1, 3);
    const b = state('concurrent-b', 8, 'synthetic C', 2, 5);
    await store.receive(6n, [a, b].map(({ matchId, revision }) => ({ matchId, revision, kind: 'RESULT_PUBLISHED' })));
    await Promise.all([store.apply(a), secondStore.apply(b)]);
    await expectSummary(2, 8, 'concurrent-b');
    expect((await store.aggregate(steamId)).revision).toBe('8');
    const c = state('rolled-back', 9, 'synthetic D', 3, 1);
    await store.receive(8n, [{ matchId: c.matchId, revision: c.revision, kind: 'RESULT_PUBLISHED' }]);
    await db.$executeRaw`ALTER TABLE "ProfileAggregate" ADD CONSTRAINT "test_projection_rollback" CHECK ((summary->>'matchCount')::int < 3)`;
    await expect(store.apply(c)).rejects.toThrow();
    expect(await db.profileMatch.findUnique({ where: { matchId: c.matchId } })).toBeNull();
    expect(await db.profilePendingMatch.count()).toBe(1);
    await expectSummary(2, 8, 'concurrent-b');
    await db.$executeRaw`ALTER TABLE "ProfileAggregate" DROP CONSTRAINT "test_projection_rollback"`;
    await secondStore.apply(c);
    await expectSummary(3, 9, 'rolled-back');
  });

  it('finds drift without writes, repairs it and retains readable projections during replay', async () => {
    await db.profileAggregate.update({ where: { steamId }, data: { version: 0 } });
    await expect(store.auditNext('', false)).resolves.toEqual({ steamId, differs: true });
    expect((await db.profileAggregate.findUniqueOrThrow({ where: { steamId } })).version).toBe(0);
    await expect(store.auditNext('', true)).resolves.toEqual({ steamId, differs: true });
    await expect(store.auditNext('', false)).resolves.toEqual({ steamId, differs: false });
    const before = (await store.aggregate(steamId)).profile;
    await store.rebuild();
    expect(await store.aggregate(steamId)).toMatchObject({ rebuilding: true, profile: before });
    while (await secondStore.backfillNext()) { /* resumed from a persisted checkpoint */ }
    expect(await store.aggregate(steamId)).toMatchObject({ rebuilding: true, profile: before });
    await store.completeReplay(0n);
    expect(await store.aggregate(steamId)).toMatchObject({ rebuilding: false, profile: before });
  });

  it.each([1_000, 10_000])('backfills and reads a profile with %i synthetic matches', async size => {
    const player = String(BigInt(steamId) + BigInt(size));
    const prefix = 'synthetic-volume-' + size + '-';
    const snapshot = state('sample', 10, 'volume', 1, 2);
    await db.$executeRaw`
      INSERT INTO "ProfileMatch" ("matchId", revision, "fileSha256", "uploadedAt", quality, policy)
      SELECT ${prefix} || n, 10::bigint, lpad(to_hex(n), 64, '0'),
        timestamp '2000-01-01' + n * interval '1 second', 'VALID', ${JSON.stringify(policy)}::jsonb
      FROM generate_series(1, ${size}::int) n`;
    await db.$executeRaw`
      INSERT INTO "ProfileParticipation" ("steamId", "matchId", player)
      SELECT ${player}, ${prefix} || n, ${JSON.stringify({ ...snapshot.players[0], steamId: player, playerId: player })}::jsonb
      FROM generate_series(1, ${size}::int) n`;
    const diagnostic = await store.auditNext(String(BigInt(player) - 1n), true);
    expect(diagnostic).toEqual({ steamId: player, differs: true });
    expect(await store.aggregate(player)).toMatchObject({ profile: { matchCount: size, measurements: { kills: { value: 2 * size } } } });
    expect(await store.auditNext(String(BigInt(player) - 1n), false)).toEqual({ steamId: player, differs: false });
  }, 45_000);

  it('reports freshness for the affected player and keeps unknown scope, outages and rebuilds conservative', async () => {
    const affected = '76561198000000091';
    const independent = '76561198000000092';
    const newcomer = '76561198000000093';
    const absent = '76561198000000094';
    let revision = Number(await store.cursor());
    const initial = state('scope-update', ++revision, 'scope A', 1, 2);
    const other = state('scope-independent', ++revision, 'scope B', 2, 3);
    await publish({ ...initial, players: [{ ...initial.players[0]!, steamId: affected, playerId: affected }] });
    await publish({ ...other, players: [{ ...other.players[0]!, steamId: independent, playerId: independent }] });

    const client = new MatchPublicationClient(new URL('http://localhost'), 'synthetic');
    const list = vi.spyOn(client, 'list').mockResolvedValue([]);
    const snapshot = vi.spyOn(client, 'state').mockRejectedValue(new Error('Synthetic unreadable snapshot'));
    const sync = new ProfileSynchronization(store, client);
    const controller = new ProfilesController(new ProfileQueries(store), store, sync);
    const poll = () => sync.poll(new AbortController().signal);
    async function check(id: string, status: string, errorStatus?: number, expectedRevision?: string) {
      const setHeader = vi.fn();
      const result = controller.profile(id, { query: {} } as Request, { setHeader } as unknown as Response);
      if (errorStatus) await expect(result).rejects.toMatchObject({ status: errorStatus });
      else await expect(result).resolves.toMatchObject({ steamId: id });
      expect(setHeader).toHaveBeenCalledWith('X-Profile-Sync-State', status);
      if (expectedRevision) expect(setHeader).toHaveBeenCalledWith('X-Profile-Revision', expectedRevision);
    }

    list.mockResolvedValueOnce([{ matchId: initial.matchId, revision: String(++revision), kind: 'MATCH_DELETED' }]);
    await poll();
    await check(affected, 'STALE', undefined, initial.revision);
    await check(independent, 'CURRENT', undefined, other.revision);
    await check(absent, 'CURRENT', 404);
    await expect(controller.ready()).resolves.toMatchObject({ status: 'degraded', sourceOnline: true, feedCaughtUp: true, pending: 1 });

    const replacement = state(initial.matchId, ++revision, 'scope A', 1, 8);
    list.mockResolvedValueOnce([{ matchId: replacement.matchId, revision: replacement.revision, kind: 'RESULT_UPDATED' }]);
    await poll();
    await check(independent, 'STALE');
    await check(absent, 'STALE', 503);
    // Even a validated snapshot must leave its pending row visible after a failed SQL projection.
    snapshot.mockResolvedValue({ ...replacement, players: [{
      ...replacement.players[0]!, steamId: newcomer, playerId: newcomer, displayName: 'scope-rejected',
    }] });
    const releaseRetry = () => db.profilePendingMatch.update({ where: { matchId: replacement.matchId }, data: { retryAt: new Date(0) } });
    await db.$executeRaw`ALTER TABLE "ProfileAggregate" ADD CONSTRAINT "test_scope_rollback" CHECK (summary->>'displayName' <> 'scope-rejected') NOT VALID`;
    try {
      await releaseRetry();
      await poll();
      await check(affected, 'STALE');
      await check(newcomer, 'STALE', 503);
      await check(independent, 'CURRENT', undefined, other.revision);
      await check(absent, 'CURRENT', 404);
    } finally {
      await db.$executeRaw`ALTER TABLE "ProfileAggregate" DROP CONSTRAINT "test_scope_rollback"`;
    }
    await releaseRetry();
    await poll();
    await check(affected, 'CURRENT', 404);
    await check(newcomer, 'CURRENT', undefined, replacement.revision);
    await expect(controller.ready()).resolves.toMatchObject({ status: 'ready', pending: 0 });

    list.mockRejectedValueOnce(new Error('Synthetic Core outage'));
    await expect(poll()).rejects.toThrow('Synthetic Core outage');
    await check(independent, 'STALE');
    await check(absent, 'STALE', 503);
    await expect(controller.ready()).resolves.toMatchObject({ status: 'degraded', sourceOnline: false });
    await poll();
    await check(independent, 'CURRENT');

    await store.rebuild();
    await poll();
    await check(independent, 'REBUILDING', undefined, other.revision);
    await check(absent, 'REBUILDING', 503);
  });
});
