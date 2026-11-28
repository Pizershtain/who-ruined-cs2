import { afterEach, expect, it, vi } from 'vitest';
import { h3PolicyDigest, h3PolicyId, profileMetricIds, profileSteamIdSchema, type PlayerMeasurement, type ProfilePlayerMatch } from '@who-ruined/contracts';
import { ProfileAggregateBuilder } from '../src/aggregate.js';
import { decodeHistoryCursor, encodeHistoryCursor } from '../src/read-profiles.js';
import { MatchPublicationClient, ProfileSynchronization } from '../src/synchronization.js';
import type { ProfileMatch, ProfileStore } from '../src/store.js';

const steamId = '76561198000000001';
const measure = (numerator: number | null, observedRounds: number | null, denominator: number | null = null): PlayerMeasurement => ({
  status: numerator === null ? 'UNAVAILABLE' : observedRounds !== null && observedRounds < 10 ? 'PARTIAL' : 'AVAILABLE',
  numerator, denominator, observedRounds, expectedRounds: 10,
});
function match(matchId: string, displayName: string, outcome: ProfilePlayerMatch['outcome'], measurements: Partial<ProfilePlayerMatch['measurements']>): ProfileMatch {
  return {
    matchId, fileSha256: 'a'.repeat(64), uploadedAt: '2026-11-27T12:00:00.000Z',
    playedAt: null, map: 'de_mirage', quality: 'VALID',
    policy: { id: h3PolicyId, digest: h3PolicyDigest },
    player: {
      playerId: steamId, steamId, teamId: 'team-a', teamLabel: 'A', displayName, outcome,
      measurements: { ...Object.fromEntries(profileMetricIds.map(id => [id, measure(null, null)])), ...measurements } as ProfilePlayerMatch['measurements'],
      radar: null, rating: null, awards: { mvp: false, whoRuined: null, evp: [] },
    },
  };
}

it('aggregates rates only over measured opportunities and keeps independent facts and genuine zeros', () => {
  const summary = new ProfileAggregateBuilder(steamId);
  summary.add(match('newer', 'New nickname', 'WIN', { kills: measure(8, 10), adr: measure(250, 10, 10), kast: measure(7, 10, 10), heDamage: measure(0, 10), enemyBlindSeconds: measure(2, null) }));
  summary.add(match('earlier', 'Earlier nickname', 'DRAW', { kills: measure(6, 10), adr: measure(120, 3, 3), kast: measure(3, 3, 3), heDamage: measure(0, 10) }));
  summary.add(match('unknown', 'Older nickname', 'UNKNOWN', { kills: measure(0, 10), adr: measure(null, null) }));
  const profile = summary.build()!;
  expect(profile).toMatchObject({ displayName: 'New nickname', steamId, matchCount: 3, results: {
    wins: 1, losses: 0, draws: 1, unknown: 1, winRate: { value: 50, status: 'PARTIAL', observedMatches: 2 },
  } });
  expect(profile.measurements.adr).toMatchObject({ value: 370 / 13, numerator: 370, denominator: 13, observedRounds: 13, expectedRounds: 30, status: 'PARTIAL' });
  expect(profile.measurements.kast).toMatchObject({ value: 10 / 13 * 100, status: 'PARTIAL' });
  expect(profile.measurements.kills).toMatchObject({ value: 14, observedMatches: 3, status: 'AVAILABLE' });
  expect(profile.measurements.heDamage).toMatchObject({ value: 0, status: 'PARTIAL', observedMatches: 2 });
  expect(profile.measurements.enemyBlindSeconds).toMatchObject({ value: 2, observedRounds: null, status: 'PARTIAL' });
  expect(profile.measurements.damage).toMatchObject({ value: null, status: 'UNAVAILABLE' });
  expect(profile.awards.evp.value).toBe(0);
  expect(profile.awards.whoRuined.value).toBeNull();
});

it('recognizes exact desktop SteamID64s without guessing bots, nicknames or zero IDs', () => {
  for (const value of [null, '0', 'bot', '76561197960265728', '76561202255233024', '7656119ABCDEFGHIJ']) {
    expect(profileSteamIdSchema.safeParse(value).success).toBe(false);
  }
  expect(profileSteamIdSchema.parse(steamId)).toBe(steamId);
  expect(profileSteamIdSchema.parse('76561198000000002')).not.toBe(steamId);
});

it('round-trips history cursors and rejects invalid dates and malformed match IDs', () => {
  const data = { time: '2026-11-27T12:00:00.000Z', matchId: 'match-1' };
  expect(decodeHistoryCursor(encodeHistoryCursor(data))).toEqual(data);
  expect(decodeHistoryCursor(encodeHistoryCursor({ ...data, time: 'November 27' }))).toBeNull();
  expect(decodeHistoryCursor(encodeHistoryCursor({ ...data, matchId: '../other' }))).toBeNull();
});

afterEach(() => vi.unstubAllGlobals());

it('accepts same-or-newer snapshots after delayed delivery and rejects wrong bindings', async () => {
  const client = new MatchPublicationClient(new URL('http://localhost:3000'), 'a'.repeat(64));
  const signal = new AbortController().signal;
  const state = { schemaVersion: 'match-publication-state@1', revision: '8', state: 'EXCLUDED', matchId: 'match-1' };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(state)));
  await expect(client.state('match-1', 2n, signal)).resolves.toEqual(state);
  await expect(client.state('match-1', 9n, signal)).rejects.toThrow('PUBLICATION_STATE_BINDING_MISMATCH');
  await expect(client.state('another', 2n, signal)).rejects.toThrow('PUBLICATION_STATE_BINDING_MISMATCH');
});

it('does not report a reset checkpoint ready from an earlier successful poll', async () => {
  const client = new MatchPublicationClient(new URL('http://localhost:3000'), 'a'.repeat(64));
  vi.spyOn(client, 'list').mockResolvedValue([{ revision: '10', matchId: 'match-1', kind: 'RESULT_PUBLISHED' }]);
  const sync = new ProfileSynchronization({
    cursor: vi.fn(async () => 9n), receive: vi.fn(), pending: vi.fn(async () => []),
    apply: vi.fn(), failed: vi.fn(), backfillNext: vi.fn(), completeReplay: vi.fn(),
  }, client);
  await sync.poll(new AbortController().signal);
  expect(sync.readiness('10').feedCaughtUp).toBe(true);
  expect(sync.readiness('0').feedCaughtUp).toBe(false);
});

it('keeps the feed stale on a full page, on a newer snapshot, and on a snapshot connection failure', async () => {
  const client = new MatchPublicationClient(new URL('http://localhost:3000'), 'synthetic');
  const list = vi.spyOn(client, 'list').mockResolvedValue([]);
  const pending = vi.fn<ProfileStore['pending']>().mockResolvedValue([]);
  const completeReplay = vi.fn();
  const sync = new ProfileSynchronization({
    cursor: vi.fn(async () => 100n), receive: vi.fn(), pending,
    apply: vi.fn(), failed: vi.fn(), backfillNext: vi.fn(), completeReplay,
  }, client);
  const signal = new AbortController().signal;
  list.mockResolvedValueOnce(Array.from({ length: 100 }, (_, i) => ({
    revision: String(i + 101), matchId: 'match-' + i, kind: 'RESULT_PUBLISHED',
  })));
  await sync.poll(signal);
  expect(sync.readiness('200')).toMatchObject({ sourceOnline: true, feedCaughtUp: false });

  const work = { matchId: 'match-1', revision: 100n, attempts: 0, retryAt: new Date(0), affectedSteamIds: null };
  pending.mockResolvedValueOnce([work]).mockResolvedValueOnce([work]);
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(Response.json({ schemaVersion: 'match-publication-state@1', state: 'EXCLUDED', matchId: work.matchId, revision: '101' }))
    .mockRejectedValueOnce(new TypeError('Synthetic Core transport failure')));
  await sync.poll(signal);
  expect(sync.readiness('100')).toMatchObject({ sourceOnline: true, feedCaughtUp: false });
  await sync.poll(signal);
  expect(sync.readiness('100')).toMatchObject({ sourceOnline: false, feedCaughtUp: false });
  expect(completeReplay).not.toHaveBeenCalled();

  await sync.poll(signal);
  expect(sync.readiness('100')).toMatchObject({ sourceOnline: true, feedCaughtUp: true });
});
