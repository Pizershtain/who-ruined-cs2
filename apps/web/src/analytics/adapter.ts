import type { MatchAnalytics as AnalyticsDto, MatchData } from '@who-ruined/contracts';
import { ApiClientError } from '../api.js';
import type { MatchAnalytics, PlayerMetrics } from './types.js';

/** Presentation mapping only. All metrics are calculated by the analysis service. */
export function presentAnalytics(match: MatchData, source: AnalyticsDto): MatchAnalytics {
  const players = Object.create(null) as Record<string, PlayerMetrics>;
  if (source.matchId !== match.matchId) throw new ApiClientError('INVALID_RESPONSE');
  for (const item of source.players) {
    const player = match.players.find((candidate) => candidate.id === item.playerId);
    if (!player || player.teamId !== item.teamId || Object.hasOwn(players, item.playerId)) throw new ApiClientError('INVALID_RESPONSE');
    players[item.playerId] = {
      damage: item.enemyDamage, adr: item.adr, kast: item.kastPercent,
      openingKills: item.openingKills, openingDeaths: item.openingDeaths, trades: item.tradeKills,
      heDamage: item.grenades.heEnemyDamage, fireDamage: item.grenades.infernoEnemyDamage,
      enemiesFlashed: item.grenades.enemiesFlashed, enemyBlindSeconds: item.grenades.enemyBlindSeconds,
      utilityDamage: null, performance: null, impact: null, mistakes: null,
    };
  }
  return {
    source: 'm2', players, availability: source.availability, limitations: source.limitations,
    mvp: { state: 'unavailable' }, whoRuined: { state: 'unavailable' },
    moments: null, roundImpact: null, insights: null,
  };
}
