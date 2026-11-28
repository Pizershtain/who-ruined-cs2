import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { ApiClientError } from '../../shared/api/transport.js';
import { getProfile, getProfileHistory, type PlayerProfileHistory } from './api.js';

export function usePlayerProfile(steamId: string | null) {
  return useQuery({
    queryKey: ['player-profile', steamId], enabled: steamId !== null,
    queryFn: ({ signal }) => getProfile(steamId!, signal),
    retry: (failures, error) => failures < 1 && !(error instanceof ApiClientError && [404, 422].includes(error.status)),
  });
}

export function useProfileHistory(steamId: string, limit: 3 | 20) {
  return useInfiniteQuery({
    queryKey: ['player-profile-matches', steamId, limit], initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => getProfileHistory(steamId, pageParam, signal, limit),
    getNextPageParam: (last, _pages, _lastParam, params) => limit === 20 && last.nextCursor && !params.includes(last.nextCursor) ? last.nextCursor : undefined,
  });
}

export function uniqueProfileMatches(pages: readonly PlayerProfileHistory[]): PlayerProfileHistory['matches'] {
  const seen = new Set<string>();
  return pages.flatMap(page => page.matches.filter(match => {
    if (seen.has(match.matchId)) return false;
    seen.add(match.matchId);
    return true;
  }));
}
