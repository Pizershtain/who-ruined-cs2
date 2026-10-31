import { useQuery } from '@tanstack/react-query';
import type { MatchData } from '@who-ruined/contracts';
import { ApiClientError, getActiveParticipationRating, getParticipationExplanation, getScoringReport } from '../api.js';

function retryRating(count: number, error: unknown): boolean {
  return !(error instanceof ApiClientError && [404, 409, 422].includes(error.status)) && count < 1;
}

export function isReportPending(error: unknown): boolean {
  return error instanceof ApiClientError && error.status === 409 && error.code === 'REPORT_NOT_READY';
}

export function useEvidenceReport(match: MatchData | undefined) {
  return useQuery({
    queryKey: ['evidence-report', match?.matchId], enabled: !!match,
    queryFn: ({ signal }) => {
      if (!match) throw new Error('A match is required');
      return getScoringReport(match.matchId, signal);
    },
    staleTime: 60_000,
    retry: retryRating,
    refetchInterval: (query) => isReportPending(query.state.error) ? 2000 : false,
  });
}

export function useParticipationRating(match: MatchData | undefined) {
  return useQuery({
    queryKey: ['active-participation-rating', match?.matchId], enabled: !!match,
    queryFn: ({ signal }) => {
      if (!match) throw new Error('A match is required');
      return getActiveParticipationRating(match.matchId, signal);
    },
    staleTime: 60_000, retry: retryRating,
  });
}

export function useParticipationExplanation(match: MatchData | undefined) {
  return useQuery({
    queryKey: ['participation-explanation', match?.matchId], enabled: !!match,
    queryFn: ({ signal }) => {
      if (!match) throw new Error('A match is required');
      return getParticipationExplanation(match.matchId, signal);
    },
    staleTime: 60_000,
    retry: retryRating,
    refetchInterval: (query) => isReportPending(query.state.error) ? 2000 : false,
  });
}
