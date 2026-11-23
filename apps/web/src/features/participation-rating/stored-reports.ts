import { useQuery } from '@tanstack/react-query';
import { evpReportSchema, storedPlayerRadarReportSchema, type MatchData } from '@who-ruined/contracts';
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
      const report = await request(`/api/v1/matches/${encodeURIComponent(match.matchId)}/radar`, { signal }, storedPlayerRadarReportSchema);
      verifyRoster(match, report, report.sourceBinding.matchFileSha256);
      return report;
    },
    staleTime: 60_000,
  });
}

export function useEvpReport(match: MatchData, enabled = true) {
  return useQuery({
    enabled,
    queryKey: ['evp', match.matchId, match.fileSha256],
    queryFn: async ({ signal }) => {
      const report = await request(`/api/v1/matches/${encodeURIComponent(match.matchId)}/evp`, { signal }, evpReportSchema);
      verifyRoster(match, report, report.binding.fileSha256);
      return report;
    },
    staleTime: 60_000,
  });
}
