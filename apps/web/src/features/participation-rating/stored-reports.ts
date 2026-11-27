import { useQuery } from '@tanstack/react-query';
import { evpReportSchema, playerRadarWithConfirmedEvidenceSchema, storedPlayerRadarReportSchema, type MatchData } from '@who-ruined/contracts';
import { ApiClientError, request } from '../../shared/api/transport.js';

function verifyRoster(match: MatchData, report: { matchId: string; players: { playerId: string; teamId: string }[] }, hash: string) {
  const teams = new Map(match.players.map(player => [player.id, player.teamId]));
  if (report.matchId !== match.matchId || hash !== match.fileSha256 || report.players.some(player => teams.get(player.playerId) !== player.teamId)) {
    throw new ApiClientError('INVALID_RESPONSE');
  }
}

export function useRadarReport(match: MatchData) {
  return useQuery({
    queryKey: ['player-radar', match.matchId, match.fileSha256],
    queryFn: async ({ signal }) => {
      const path = `/api/v1/matches/${encodeURIComponent(match.matchId)}/radar`;
      const report = await request(`${path}?include=confirmed`, { signal }, playerRadarWithConfirmedEvidenceSchema).catch((error: unknown) => {
        if (error instanceof ApiClientError && error.code === 'INVALID_QUERY') return request(path, { signal }, storedPlayerRadarReportSchema);
        throw error;
      });
      verifyRoster(match, report, report.sourceBinding.matchFileSha256);
      return report;
    },
    staleTime: 60_000,
  });
}

export function useEvpReport(match: MatchData | undefined, enabled = true) {
  return useQuery({
    enabled: enabled && !!match,
    queryKey: ['evp', match?.matchId, match?.fileSha256],
    queryFn: async ({ signal }) => {
      if (!match) throw new ApiClientError('MATCH_NOT_FOUND');
      const report = await request(`/api/v1/matches/${encodeURIComponent(match.matchId)}/evp`, { signal }, evpReportSchema);
      verifyRoster(match, report, report.binding.fileSha256);
      return report;
    },
    staleTime: 60_000,
  });
}
