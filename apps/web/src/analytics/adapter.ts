import type { MatchAnalytics as AnalyticsDto, MatchData, PlayerScoringReport, ScoringReport } from '@who-ruined/contracts';
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

/** Adds only server-computed M3 values; the UI never derives a score or blame label. */
export function presentScoring(match: MatchData, base: MatchAnalytics, report: ScoringReport): MatchAnalytics {
  if (report.matchId !== match.matchId) throw new ApiClientError('INVALID_RESPONSE');
  const roster = new Map(match.players.map((player) => [player.id, player.teamId]));
  if (report.players.length !== match.players.length) throw new ApiClientError('INVALID_RESPONSE');
  const players = { ...base.players };
  const scoredPlayerIds = new Set<string>();
  for (const scored of report.players) {
    if (scoredPlayerIds.has(scored.playerId) || roster.get(scored.playerId) !== scored.teamId || !players[scored.playerId]) {
      throw new ApiClientError('INVALID_RESPONSE');
    }
    scoredPlayerIds.add(scored.playerId);
    players[scored.playerId] = {
      ...players[scored.playerId]!,
      performance: scored.performanceRate,
      impact: scored.contextContributionRate,
      mistakes: scored.confirmedHarmRate,
    };
  }
  const leader = report.mvp;
  const ruined = report.whoRuined;
  if ((leader && !roster.has(leader.playerId)) || (ruined && roster.get(ruined.playerId) !== report.losingTeamId)) {
    throw new ApiClientError('INVALID_RESPONSE');
  }
  const eligible = report.coverage.eligible && report.status === 'COMPLETED';
  return {
    ...base,
    players,
    mvp: !eligible || !leader ? { state: 'insufficient-data' } : {
      state: 'available', playerId: leader.playerId, value: leader.rate, margin: leader.margin,
      close: leader.close, tied: leader.tied
    },
    whoRuined: !eligible || !ruined ? { state: 'insufficient-data' } : {
      state: 'available', playerId: ruined.playerId, value: ruined.relativeIndex, margin: ruined.margin,
      close: ruined.close, tied: ruined.primaryScoreTied, noConfirmedHarm: ruined.noConfirmedHarm
    },
    moments: report.episodes.map((episode) => ({
      id: episode.id, playerId: episode.playerId, roundId: episode.roundId, tick: episode.startTick,
      endTick: episode.endTick,
      category: episode.kind === 'HIGHLIGHT' ? 'positive' : episode.kind === 'ANTI_HIGHLIGHT' ? 'mistake' : 'fact',
      kind: episode.type, importance: (episode.significance ?? 0) >= 2 ? 'high' : 'medium',
      confidence: episode.confidence, evidenceStrength: episode.evidenceStrength, observedFacts: episode.observedFacts
    })),
    roundImpact: report.rounds.map((round) => ({
      roundId: round.roundId,
      players: Object.fromEntries(round.players.map((player) => [player.playerId, player.net]))
    })),
    scoring: {
      scorerVersion: report.scorerVersion, configHash: report.configHash, model: report.model,
      experimental: report.experimental, status: report.status, coverage: report.coverage,
      warnings: report.warnings, limitations: report.limitations
    }
  };
}

export function presentPlayerScoring(match: MatchData, base: MatchAnalytics, report: PlayerScoringReport): MatchAnalytics {
  if (report.matchId !== match.matchId) throw new ApiClientError('INVALID_RESPONSE');
  const scored = report.player;
  const player = match.players.find((candidate) => candidate.id === scored.playerId);
  if (!player || player.teamId !== scored.teamId || !base.players[scored.playerId]) throw new ApiClientError('INVALID_RESPONSE');
  return {
    ...base,
    players: {
      ...base.players,
      [scored.playerId]: {
        ...base.players[scored.playerId]!, performance: scored.performanceRate,
        impact: scored.contextContributionRate, mistakes: scored.confirmedHarmRate
      }
    },
    moments: report.episodes.map((episode) => ({
      id: episode.id, playerId: episode.playerId, roundId: episode.roundId, tick: episode.startTick,
      endTick: episode.endTick,
      category: episode.kind === 'HIGHLIGHT' ? 'positive' : episode.kind === 'ANTI_HIGHLIGHT' ? 'mistake' : 'fact',
      kind: episode.type, importance: (episode.significance ?? 0) >= 2 ? 'high' : 'medium',
      confidence: episode.confidence, evidenceStrength: episode.evidenceStrength, observedFacts: episode.observedFacts
    })),
    roundImpact: report.rounds.map((round) => ({ roundId: round.roundId, players: { [scored.playerId]: round.player.net } }))
  };
}
