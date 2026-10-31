import { useQuery } from '@tanstack/react-query';
import type { MatchData } from '@who-ruined/contracts';
import { ApiClientError, getReplayMetadata, getReplayRound } from '../api.js';

function retryReplay(count: number, error: unknown): boolean {
  return !(error instanceof ApiClientError && [404, 409, 422].includes(error.status)) && count < 1;
}

export function useReplayMetadata(match: MatchData | undefined) {
  return useQuery({
    queryKey: ['replay-metadata', match?.matchId],
    enabled: !!match,
    queryFn: ({ signal }) => {
      if (!match) throw new Error('A match is required');
      return getReplayMetadata(match.matchId, signal);
    },
    staleTime: 5 * 60_000,
    retry: retryReplay
  });
}

export function useReplayRound(match: MatchData | undefined, roundId: string | null) {
  return useQuery({
    queryKey: ['replay-round', match?.matchId, roundId],
    enabled: !!match && !!roundId,
    queryFn: ({ signal }) => {
      if (!match || !roundId) throw new Error('A match and round are required');
      return getReplayRound(match.matchId, roundId, signal);
    },
    staleTime: 5 * 60_000,
    gcTime: 15 * 60_000,
    retry: retryReplay
  });
}
