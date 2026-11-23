import type { StoredParticipationRating, MatchData } from '@who-ruined/contracts';
import { ApiClientError } from '../../shared/api/transport.js';
import { emptyMetrics } from '../../entities/match/adapter.js';
import type { Award, MatchAnalytics } from '../../entities/match/types.js';

function presentAward(
  match: MatchData,
  report: StoredParticipationRating,
  award: StoredParticipationRating['awards']['mvp'] | StoredParticipationRating['awards']['whoRuined'],
): Award {
  const scope = 'scope' in award ? award.scope : undefined;
  if (award.playerId === null) return {
    state: 'insufficient-data', poolSize: award.awardPoolSize, reason: award.reasonIfUnavailable,
    tied: award.tied, ...(scope ? { scope } : {}),
  };
  const identity = match.players.find((player) => player.id === award.playerId);
  const rated = report.players.find((player) => player.playerId === award.playerId);
  if (!identity || !rated || identity.teamId !== rated.teamId || !rated.rating) throw new ApiClientError('INVALID_RESPONSE');
  return {
    state: 'available', playerId: award.playerId, value: rated.rating.value,
    poolSize: award.awardPoolSize, close: award.close, tied: award.tied,
    scoreGap: award.scoreGap, tiedPlayerIds: [...award.tiedPlayerIds], ...(scope ? { scope } : {}),
  };
}

/** Adds the sole active backend rating while preserving nulls and roster identities. */
export function presentParticipationRating(match: MatchData, base: MatchAnalytics | undefined, report: StoredParticipationRating): MatchAnalytics {
  if (report.matchId !== match.matchId || report.players.length !== match.players.length) throw new ApiClientError('INVALID_RESPONSE');
  const roster = new Map(match.players.map((player) => [player.id, player.teamId]));
  const teams = new Set(match.teams.map((team) => team.id));
  const players = { ...(base?.players ?? {}) };
  const seen = new Set<string>();
  for (const rated of report.players) {
    if (seen.has(rated.playerId) || roster.get(rated.playerId) !== rated.teamId || !teams.has(rated.teamId)) {
      throw new ApiClientError('INVALID_RESPONSE');
    }
    seen.add(rated.playerId);
    const analytics = rated.analytics;
    players[rated.playerId] = {
      ...(players[rated.playerId] ?? emptyMetrics()),
      analytics, participation: rated.coverage,
      kills: rated.baseStats.kills, deaths: rated.baseStats.deaths, assists: rated.baseStats.assists,
      damage: analytics.enemyDamage, adr: rated.baseStats.adr, kast: rated.baseStats.kastPercent,
      openingKills: analytics.openingKills, openingDeaths: analytics.openingDeaths, trades: analytics.tradeKills,
      heDamage: analytics.grenades.heEnemyDamage, fireDamage: analytics.grenades.infernoEnemyDamage,
      enemiesFlashed: analytics.grenades.enemiesFlashed, enemyBlindSeconds: analytics.grenades.enemyBlindSeconds,
      rating: rated.availability.status === 'CALCULATED_RESEARCH_ONLY' ? rated.rating : null,
      ratingAvailability: rated.availability.status, ratingReason: rated.availability.reason,
      ratingCoverage: {
        verifiedRounds: rated.coverage.verifiedRounds, partialRounds: rated.coverage.partialRounds,
        unknownRounds: rated.coverage.unknownRounds, absentFullRounds: rated.coverage.absentFullRounds,
        globalExcludedRounds: rated.coverage.globalExcludedRounds,
      },
    };
    if (rated.availability.status === 'CALCULATED_RESEARCH_ONLY' && !rated.rating) throw new ApiClientError('INVALID_RESPONSE');
    if (rated.availability.status !== 'CALCULATED_RESEARCH_ONLY' && rated.rating) throw new ApiClientError('INVALID_RESPONSE');
  }
  if (seen.size !== roster.size) throw new ApiClientError('INVALID_RESPONSE');
  return {
    ...(base ?? { moments: null, roundImpact: null, insights: null, mvp: { state: 'unavailable' as const }, whoRuined: { state: 'unavailable' as const } }),
    source: 'm4', players,
    mvp: presentAward(match, report, report.awards.mvp),
    whoRuined: presentAward(match, report, report.awards.whoRuined),
    activeRating: {
      experimental: report.experimental, calibrated: report.calibrated, causalBlame: report.causalBlame,
      eligiblePoolSize: report.awards.eligiblePoolSize, incompletePool: report.awards.incompletePool,
      outcome: report.awards.outcome, warnings: report.warnings, limitations: report.limitations,
    },
  };
}
