import { playerProfileHistorySchema } from '@who-ruined/contracts';
import { historyCursor, type HistoryCursor, type ProfileStore } from './store.js';

export function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

export function decodeHistoryCursor(encoded: string): HistoryCursor | null {
  if (!/^[A-Za-z0-9_-]{1,512}$/u.test(encoded)) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (typeof value !== 'object' || value === null || !('time' in value) || !('matchId' in value)
      || typeof value.time !== 'string' || typeof value.matchId !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/u.test(value.matchId)
      || new Date(value.time).toISOString() !== value.time) return null;
    const cursor = { time: value.time, matchId: value.matchId };
    return encodeHistoryCursor(cursor) === encoded ? cursor : null;
  } catch {
    return null;
  }
}

export class ProfileQueries {
  constructor(private readonly store: ProfileStore) {}

  profile(steamId: string) {
    return this.store.aggregate(steamId);
  }

  history(steamId: string, limit: number, cursor: HistoryCursor | null) {
    return this.store.read(async tx => {
      const rows = await this.store.history(tx, steamId, limit + 1, cursor);
      const matches = rows.slice(0, limit);
      return playerProfileHistorySchema.parse({
        schemaVersion: 'player-profile-history@1', steamId, matches,
        nextCursor: rows.length > limit ? encodeHistoryCursor(historyCursor(matches[matches.length - 1]!)) : null,
      });
    });
  }
}
