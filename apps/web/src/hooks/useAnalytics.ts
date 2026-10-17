import { useQuery } from '@tanstack/react-query';
import type { MatchData } from '@who-ruined/contracts';
import { ApiClientError, getMatchAnalytics } from '../api.js';
import { presentAnalytics } from '../analytics/adapter.js';

export function useAnalytics(match: MatchData | undefined) {
  return useQuery({
    queryKey: ['analytics', match?.matchId], enabled: !!match,
    queryFn: async ({ signal }) => {
      if (!match) throw new Error('A match is required');
      return presentAnalytics(match, await getMatchAnalytics(match.matchId, signal));
    },
    staleTime: 60_000,
    retry: (count, error) => !(error instanceof ApiClientError && [404, 409].includes(error.status)) && count < 1,
  });
}
