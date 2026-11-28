import { isDeepStrictEqual } from 'node:util';
import {
  playerProfileHistorySchema, playerProfileSchema, profilePlayerMatchSchema, type MatchPublicationState, type MatchPublications,
} from '@who-ruined/contracts';
import { Prisma, PrismaClient } from '../generated/client/index.js';
import { ProfileAggregateBuilder } from './aggregate.js';

type Tx = Prisma.TransactionClient;
type Published = Extract<MatchPublicationState, { state: 'PUBLISHED' }>;
export type ProfileMatch = Pick<Published, 'matchId' | 'fileSha256' | 'uploadedAt' | 'playedAt' | 'map' | 'quality' | 'policy'> & {
  player: Published['players'][number];
};
export type HistoryCursor = { time: string; matchId: string };
const AGGREGATE_VERSION = 1;
const profileHistoryMatchSchema = playerProfileHistorySchema.shape.matches.element;
const transactionLimits = { maxWait: 10_000, timeout: 60_000 };

function representatives(steamId: string) {
  return Prisma.sql`
    SELECT DISTINCT ON (m."fileSha256") m."matchId", m."fileSha256", m."uploadedAt",
      m."playedAt", m."map", m."policy", m."quality",
      COALESCE(m."playedAt", m."uploadedAt") AS sort_time
    FROM "ProfileParticipation" p JOIN "ProfileMatch" m ON p."matchId" = m."matchId"
    WHERE p."steamId" = ${steamId} AND m."fileSha256" IS NOT NULL
    ORDER BY m."fileSha256", m."uploadedAt" DESC, m."matchId" DESC`;
}

async function compute(tx: Tx, steamId: string) {
  const builder = new ProfileAggregateBuilder(steamId);
  await tx.$executeRaw`
    DECLARE profile_aggregate_rows NO SCROLL CURSOR FOR
      SELECT d."policy", p."player"
      FROM (${representatives(steamId)}) d JOIN "ProfileParticipation" p
        ON p."steamId" = ${steamId} AND p."matchId" = d."matchId"
      ORDER BY d.sort_time DESC, d."matchId" DESC`;
  try {
    for (;;) {
      const rows = await tx.$queryRaw<Array<{ policy: unknown; player: unknown }>>`FETCH FORWARD 256 FROM profile_aggregate_rows`;
      for (const row of rows) {
        const player = profilePlayerMatchSchema.parse(row.player);
        if (player.steamId !== steamId) throw new Error('PROFILE_STORAGE_IDENTITY_MISMATCH');
        builder.add({ policy: profileHistoryMatchSchema.shape.policy.parse(row.policy), player });
      }
      if (rows.length < 256) break;
    }
  } finally {
    await tx.$executeRaw`CLOSE profile_aggregate_rows`;
  }
  return builder.build();
}

async function refresh(tx: Tx, steamId: string, revision: bigint, repair: boolean) {
  const summary = await compute(tx, steamId);
  const encoded = JSON.stringify(summary);
  const [stored] = await tx.$queryRaw<Array<{ version: number; matches: boolean }>>`
    SELECT version, summary = ${encoded}::jsonb AS matches
    FROM "ProfileAggregate" WHERE "steamId" = ${steamId}`;
  const differs = summary === null ? stored !== undefined
    : stored?.version !== AGGREGATE_VERSION || !stored.matches;
  if (!differs || !repair) return differs;
  if (summary === null) {
    await tx.profileAggregate.delete({ where: { steamId } });
  } else {
    // Pass JSON as text in both directions so float parsing and serialization
    // match a directly computed response in Node.
    await tx.$executeRaw`
      INSERT INTO "ProfileAggregate" ("steamId", version, revision, summary)
      VALUES (${steamId}, ${AGGREGATE_VERSION}, ${revision}, ${encoded}::jsonb)
      ON CONFLICT ("steamId") DO UPDATE SET version = EXCLUDED.version,
        revision = GREATEST("ProfileAggregate".revision, EXCLUDED.revision), summary = EXCLUDED.summary`;
  }
  return true;
}

// Synchronizes cursor and projection mutations, including an operator rebuild.
async function lock(tx: Tx): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(74292611270901000::bigint)`;
}

async function affectedPlayers(tx: Tx, matchId: string, incoming: string[]): Promise<string[]> {
  const previous = await tx.profileParticipation.findMany({ where: { matchId }, select: { steamId: true } });
  return [...new Set([...previous.map(player => player.steamId), ...incoming])].sort();
}

export class ProfileStore {
  constructor(readonly db: PrismaClient) {}

  async cursor(): Promise<bigint> {
    return (await this.db.profileFeedCursor.findUniqueOrThrow({ where: { id: 1 } })).revision;
  }

  async receive(after: bigint, events: MatchPublications['events']): Promise<void> {
    if (events.length === 0) return;
    let revision = after;
    const latest = new Map<string, MatchPublications['events'][number]>();
    for (const event of events) {
      const next = BigInt(event.revision);
      if (next <= revision) throw new Error('PUBLICATION_ORDER_INVALID');
      revision = next;
      latest.set(event.matchId, event);
    }
    await this.db.$transaction(async tx => {
      await lock(tx);
      const cursor = await tx.profileFeedCursor.updateMany({ where: { id: 1, revision: after }, data: { revision } });
      if (cursor.count !== 1) return;
      for (const { matchId, revision, kind } of latest.values()) {
        // A tombstone can only remove already projected contributions.
        const affectedSteamIds = kind === 'MATCH_DELETED' ? await affectedPlayers(tx, matchId, []) : Prisma.DbNull;
        const work = { revision: BigInt(revision), affectedSteamIds };
        await tx.profilePendingMatch.upsert({
          where: { matchId },
          create: { matchId, ...work },
          update: { ...work, retryAt: new Date(0), attempts: 0 },
        });
      }
    }, transactionLimits);
  }

  async pending() {
    return this.db.profilePendingMatch.findMany({
      where: { retryAt: { lte: new Date() } }, orderBy: [{ retryAt: 'asc' }, { revision: 'asc' }], take: 25,
    });
  }

  async failed(matchId: string, revision: bigint, attempts: number, snapshot: MatchPublicationState | null): Promise<void> {
    const delay = Math.min(60, 2 ** Math.min(attempts, 6));
    const where = { matchId, revision };
    const retry = { attempts: { increment: 1 }, retryAt: new Date(Date.now() + delay * 1000) };
    if (!snapshot) {
      await this.db.profilePendingMatch.updateMany({ where, data: retry });
      return;
    }
    await this.db.$transaction(async tx => {
      await lock(tx);
      // A different revision is not evidence about the pending revision.
      const affectedSteamIds = snapshot.matchId === matchId && BigInt(snapshot.revision) === revision
        ? await affectedPlayers(tx, matchId, snapshot.state === 'PUBLISHED' ? snapshot.players.map(player => player.steamId) : [])
        : Prisma.DbNull;
      await tx.profilePendingMatch.updateMany({ where, data: { ...retry, affectedSteamIds } });
    }, transactionLimits);
  }

  async apply(state: MatchPublicationState): Promise<void> {
    const { matchId } = state;
    const revision = BigInt(state.revision);
    await this.db.$transaction(async tx => {
      await lock(tx);
      const pending = await tx.profilePendingMatch.findUnique({ where: { matchId } });
      if (!pending || pending.revision > revision) return;
      const previous = await tx.profileMatch.findUnique({
        where: { matchId }, include: { players: { select: { steamId: true, player: true } } },
      });
      if (!previous || previous.revision < revision) {
        const match = state.state === 'PUBLISHED' ? {
          revision, fileSha256: state.fileSha256, uploadedAt: new Date(state.uploadedAt),
          playedAt: state.playedAt === null ? null : new Date(state.playedAt), map: state.map,
          quality: state.quality, policy: state.policy,
        } : { revision, fileSha256: null, uploadedAt: null, playedAt: null, map: null, quality: null, policy: Prisma.DbNull };
        await tx.profileMatch.upsert({ where: { matchId }, create: { matchId, ...match }, update: match });
        await tx.profileParticipation.deleteMany({ where: { matchId } });
        if (state.state === 'PUBLISHED' && state.players.length > 0) {
          await tx.profileParticipation.createMany({
            data: state.players.map(player => ({ matchId, steamId: player.steamId, player })),
          });
        }
        const before = new Map(previous?.players.map(row => [row.steamId, row.player]));
        const after = new Map(state.state === 'PUBLISHED' ? state.players.map(row => [row.steamId, row]) : []);
        const representativeChanged = previous?.fileSha256 !== match.fileSha256
          || previous?.uploadedAt?.getTime() !== match.uploadedAt?.getTime()
          || previous?.playedAt?.getTime() !== match.playedAt?.getTime()
          || !isDeepStrictEqual(previous?.policy, match.policy);
        for (const steamId of new Set([...before.keys(), ...after.keys()])) {
          if (representativeChanged || !isDeepStrictEqual(before.get(steamId), after.get(steamId))) {
            await refresh(tx, steamId, revision, true);
          }
        }
      }
      await tx.profilePendingMatch.delete({ where: { matchId } });
    }, transactionLimits);
  }

  async status() {
    const [state, pending, retrying] = await this.db.$transaction([
      this.db.profileFeedCursor.findUniqueOrThrow({ where: { id: 1 } }),
      this.db.profilePendingMatch.count(), this.db.profilePendingMatch.count({ where: { attempts: { gt: 0 } } }),
    ], { isolationLevel: 'RepeatableRead' });
    return { revision: state.revision.toString(), pending, retrying,
      aggregateBackfillComplete: state.aggregateBackfillComplete, replaying: state.replaying };
  }

  async aggregate(steamId: string) {
    const [row] = await this.db.$queryRaw<Array<{
      version: number | null; revision: bigint | null; summary: string | null; feedRevision: bigint;
      rebuilding: boolean; playerPending: boolean;
    }>>`
      SELECT a.version, a.revision, a.summary::text AS summary, c.revision AS "feedRevision",
        (c.replaying OR NOT c."aggregateBackfillComplete") AS rebuilding,
        (EXISTS (SELECT 1 FROM "ProfilePendingMatch" WHERE "affectedSteamIds" IS NULL)
          OR EXISTS (SELECT 1 FROM "ProfilePendingMatch" WHERE "affectedSteamIds" ? ${steamId}::text)) AS "playerPending"
      FROM "ProfileFeedCursor" c LEFT JOIN "ProfileAggregate" a ON a."steamId" = ${steamId}
      WHERE c.id = 1`;
    if (!row) throw new Error('PROFILE_FEED_CURSOR_MISSING');
    const profile = row.summary === null ? null : playerProfileSchema.parse(JSON.parse(row.summary) as unknown);
    if (profile && (profile.steamId !== steamId || row.version !== AGGREGATE_VERSION)) {
      throw new Error('PROFILE_AGGREGATE_BINDING_MISMATCH');
    }
    return { profile, revision: row.revision?.toString() ?? null, feedRevision: row.feedRevision.toString(),
      rebuilding: row.rebuilding, playerPending: row.playerPending };
  }

  async backfillNext(): Promise<boolean> {
    return this.db.$transaction(async tx => {
      await lock(tx);
      const state = await tx.profileFeedCursor.findUniqueOrThrow({ where: { id: 1 } });
      if (state.aggregateBackfillComplete) return false;
      const next = await tx.profileParticipation.findFirst({
        ...(state.aggregateBackfillAfter ? { where: { steamId: { gt: state.aggregateBackfillAfter } } } : {}),
        orderBy: { steamId: 'asc' }, select: { steamId: true },
      });
      if (next) await refresh(tx, next.steamId, state.revision, true);
      await tx.profileFeedCursor.update({ where: { id: 1 }, data: next
        ? { aggregateBackfillAfter: next.steamId }
        : { aggregateBackfillComplete: true, aggregateBackfillAfter: null } });
      return next !== null;
    }, transactionLimits);
  }

  async completeReplay(revision: bigint): Promise<void> {
    const state = await this.db.profileFeedCursor.findUniqueOrThrow({ where: { id: 1 } });
    if (state.replaying && state.aggregateBackfillComplete) {
      await this.db.$transaction(async tx => {
        await lock(tx);
        await tx.$executeRaw`UPDATE "ProfileFeedCursor" SET replaying = false
          WHERE id = 1 AND revision = ${revision} AND replaying AND "aggregateBackfillComplete"
            AND NOT EXISTS (SELECT 1 FROM "ProfilePendingMatch")`;
      }, transactionLimits);
    }
  }

  async auditNext(after: string, repair: boolean): Promise<{ steamId: string; differs: boolean } | null> {
    return this.db.$transaction(async tx => {
      await lock(tx);
      const [next] = await tx.$queryRaw<Array<{ steamId: string }>>`
        SELECT "steamId" FROM (
          (SELECT "steamId" FROM "ProfileParticipation" WHERE "steamId" > ${after} ORDER BY "steamId" LIMIT 1)
          UNION ALL
          (SELECT "steamId" FROM "ProfileAggregate" WHERE "steamId" > ${after} ORDER BY "steamId" LIMIT 1)
        ) candidates ORDER BY "steamId" LIMIT 1`;
      if (!next) return null;
      const state = await tx.profileFeedCursor.findUniqueOrThrow({ where: { id: 1 } });
      return { steamId: next.steamId, differs: await refresh(tx, next.steamId, state.revision, repair) };
    }, transactionLimits);
  }

  async rebuild(): Promise<void> {
    await this.db.$transaction(async tx => {
      await lock(tx);
      await tx.profilePendingMatch.deleteMany();
      await tx.profileFeedCursor.update({ where: { id: 1 }, data: {
        revision: 0n, replaying: true, aggregateBackfillAfter: null, aggregateBackfillComplete: false,
      } });
    }, transactionLimits);
  }

  read<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.$transaction(run, { isolationLevel: 'RepeatableRead', timeout: 15_000 });
  }

  async history(tx: Tx, steamId: string, take: number, cursor: HistoryCursor | null): Promise<ProfileMatch[]> {
    const whereCursor = cursor
      ? Prisma.sql`WHERE (sort_time, "matchId") < (${new Date(cursor.time)}::timestamp, ${cursor.matchId})`
      : Prisma.empty;
    const rows = await tx.$queryRaw<Array<{
      matchId: string; fileSha256: string; uploadedAt: Date; playedAt: Date | null;
      map: string | null; policy: unknown; quality: string; player: unknown;
    }>>`
      WITH page AS (
        SELECT * FROM (${representatives(steamId)}) demos ${whereCursor}
        ORDER BY sort_time DESC, "matchId" DESC LIMIT ${take}
      )
      SELECT page.*, p."player" FROM page JOIN "ProfileParticipation" p
        ON p."steamId" = ${steamId} AND p."matchId" = page."matchId"
      ORDER BY page.sort_time DESC, page."matchId" DESC`;
    return rows.map(row => {
      const { matchId, fileSha256, uploadedAt, playedAt, map, quality, policy, player } = row;
      const validated = profilePlayerMatchSchema.parse(player);
      if (validated.steamId !== steamId) throw new Error('PROFILE_STORAGE_IDENTITY_MISMATCH');
      return profileHistoryMatchSchema.parse({
        matchId, fileSha256, uploadedAt: uploadedAt.toISOString(), playedAt: playedAt?.toISOString() ?? null,
        map, quality, policy, player: validated,
      });
    });
  }
}

export function historyCursor(match: ProfileMatch): HistoryCursor {
  return { time: match.playedAt ?? match.uploadedAt, matchId: match.matchId };
}
