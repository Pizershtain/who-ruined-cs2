import { playerProfileSchema, playerProfileHistorySchema, publicationRevisionSchema } from '@who-ruined/contracts';
import { z } from 'zod';
import { ApiClientError, request, requestWithHeaders } from '../../shared/api/transport.js';

export type PlayerProfile = z.infer<typeof playerProfileSchema>;
export type PlayerProfileHistory = z.infer<typeof playerProfileHistorySchema>;
const syncState = z.enum(['CURRENT', 'STALE', 'REBUILDING']);

function path(steamId: string) {
  return `/api/v1/players/${encodeURIComponent(steamId)}/profile`;
}

export async function getProfile(steamId: string, signal: AbortSignal) {
  const { data, headers } = await requestWithHeaders(path(steamId), { signal }, playerProfileSchema);
  if (data.steamId !== steamId) throw new ApiClientError('INVALID_RESPONSE');
  return { profile: data, revision: publicationRevisionSchema.safeParse(headers.get('X-Profile-Revision')).data ?? null,
    syncState: syncState.safeParse(headers.get('X-Profile-Sync-State')).data ?? null };
}

export async function getProfileHistory(steamId: string, cursor: string | null, signal: AbortSignal, limit: 3 | 20 = 20): Promise<PlayerProfileHistory> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor !== null) params.set('cursor', cursor);
  const page = await request(`${path(steamId)}/matches?${params}`, { signal }, playerProfileHistorySchema);
  if (page.steamId !== steamId || page.matches.some(match => match.player.steamId !== steamId)) {
    throw new ApiClientError('INVALID_RESPONSE');
  }
  return page;
}
