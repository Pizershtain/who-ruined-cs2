import { useQuery } from '@tanstack/react-query';
import type { MatchData } from '@who-ruined/contracts';
import { ApiClientError, getPlayerScoringReport, getScoringReport } from '../api.js';

function retryScoring(count: number, error: unknown): boolean {
  return !(error instanceof ApiClientError && [404, 409, 422].includes(error.status)) && count < 1;
}

export function useScoring(match: MatchData | undefined) {
  return useQuery({
    queryKey: ['scoring-report', match?.matchId], enabled: !!match,
    queryFn: ({ signal }) => {
      if (!match) throw new Error('A match is required');
      return getScoringReport(match.matchId, signal);
    },
    staleTime: 60_000, retry: retryScoring,
  });
}

export function usePlayerScoring(match: MatchData | undefined, playerId: string) {
  return useQuery({
    queryKey: ['player-scoring-report', match?.matchId, playerId], enabled: !!match && !!playerId,
    queryFn: ({ signal }) => {
      if (!match) throw new Error('A match is required');
      return getPlayerScoringReport(match.matchId, playerId, signal);
    },
    staleTime: 60_000, retry: retryScoring,
  });
}
