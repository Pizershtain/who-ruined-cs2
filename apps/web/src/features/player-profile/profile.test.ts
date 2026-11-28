import { readFileSync } from 'node:fs';
import { afterEach, expect, it, vi } from 'vitest';
import type { PlayerMeasurement } from '@who-ruined/contracts';
import { getProfile, getProfileHistory } from './api.js';
import { measurementValue } from './metrics.js';
import { uniqueProfileMatches } from './queries.js';
import { playerProfilePath } from '../../entities/match/player.js';

// The repository's anonymized synthetic handoff example.
const fixture = JSON.parse(readFileSync(new URL('../../../../../docs/examples/player-profile-mixed-data.json', import.meta.url), 'utf8')) as {
  profile: unknown; history: { steamId: string };
};
const id = fixture.history.steamId;
const signal = new AbortController().signal;

afterEach(() => vi.unstubAllGlobals());

it.each(['CURRENT', 'STALE', 'REBUILDING'] as const)('reads %s and preserves an exact string revision', async syncState => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(fixture.profile, {
    headers: { 'X-Profile-Revision': '9007199254740993', 'X-Profile-Sync-State': syncState },
  })));
  await expect(getProfile(id, signal)).resolves.toMatchObject({
    profile: { steamId: id }, revision: '9007199254740993', syncState,
  });
  await expect(getProfile('76561198000003000', signal)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
});

it.each([[404, 'PROFILE_NOT_FOUND'], [503, 'PROFILE_NOT_READY'], [503, 'UPSTREAM_UNAVAILABLE']] as const)('keeps profile status %i %s distinct', async (status, code) => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code } }, { status })));
  await expect(getProfile(id, signal)).rejects.toMatchObject({ status, code });
});

it('keeps nextCursor opaque and deduplicates history without changing stored context', async () => {
  const fetcher = vi.fn(async () => Response.json(fixture.history));
  vi.stubGlobal('fetch', fetcher);
  const history = await getProfileHistory(id, 'opaque-cursor', signal);
  expect(fetcher).toHaveBeenCalledWith(`/api/v1/players/${id}/profile/matches?limit=20&cursor=opaque-cursor`, { signal });
  await getProfileHistory(id, null, signal, 3);
  expect(fetcher).toHaveBeenLastCalledWith(`/api/v1/players/${id}/profile/matches?limit=3`, { signal });
  const merged = uniqueProfileMatches([history, history]);
  expect(merged).toEqual(history.matches);
  expect(merged.map(item => item.player.displayName)).toEqual(expect.arrayContaining(['Synthetic Nova', 'Synthetic Alias']));
});

it('keeps confirmed zeros, unknown data and unavailable denominators separate', () => {
  const missing: PlayerMeasurement = { status: 'UNAVAILABLE', numerator: null, denominator: null, observedRounds: null, expectedRounds: 24 };
  expect(measurementValue(missing)).toBeNull();
  expect(measurementValue({ ...missing, status: 'AVAILABLE', numerator: 0 })).toBe(0);
  expect(measurementValue({ ...missing, status: 'PARTIAL', numerator: 10, denominator: 0 })).toBeNull();
  expect(measurementValue({ ...missing, status: 'PARTIAL', numerator: 6, denominator: 10 }, 100)).toBe(60);
  expect(playerProfilePath(null)).toBeNull();
  expect(playerProfilePath('123')).toBeNull();
  expect(playerProfilePath(id)).toBe(`/players/${id}`);
});
