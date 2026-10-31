import type { ActiveParticipationRatingReport, MatchAnalytics as AnalyticsDto, MatchData, ScoringReport } from '@who-ruined/contracts';
import { ApiClientError } from '../api.js';
import type { Award, MatchAnalytics, PlayerMetrics } from './types.js';

function emptyMetrics(): PlayerMetrics {
  return {
    kills: null, deaths: null, assists: null, damage: null, adr: null, kast: null,
    openingKills: null, openingDeaths: null, trades: null, utilityDamage: null,
    heDamage: null, fireDamage: null, enemiesFlashed: null, enemyBlindSeconds: null,
    rating: null,
  };
}

/** Presentation mapping only. All metrics are calculated by the analysis service. */
export function presentAnalytics(match: MatchData, source: AnalyticsDto): MatchAnalytics {
  const players = Object.create(null) as Record<string, PlayerMetrics>;
  if (source.matchId !== match.matchId) throw new ApiClientError('INVALID_RESPONSE');
  for (const item of source.players) {
    const player = match.players.find((candidate) => candidate.id === item.playerId);
    if (!player || player.teamId !== item.teamId || Object.hasOwn(players, item.playerId)) throw new ApiClientError('INVALID_RESPONSE');
    players[item.playerId] = {
      ...emptyMetrics(), kills: item.kills, deaths: item.deaths, assists: item.assists,
      damage: item.enemyDamage, adr: item.adr, kast: item.kastPercent,
      openingKills: item.openingKills, openingDeaths: item.openingDeaths, trades: item.tradeKills,
      heDamage: item.grenades.heEnemyDamage, fireDamage: item.grenades.infernoEnemyDamage,
      enemiesFlashed: item.grenades.enemiesFlashed, enemyBlindSeconds: item.grenades.enemyBlindSeconds,
    };
  }
  return {
    source: 'm2', players, availability: source.availability, limitations: source.limitations,
    mvp: { state: 'unavailable' }, whoRuined: { state: 'unavailable' },
    moments: null, roundImpact: null, insights: null,
  };
}

/** Adds backend evidence episodes only. Legacy report scores and awards are deliberately ignored. */
export function presentEvidenceReport(match: MatchData, base: MatchAnalytics | undefined, report: ScoringReport): MatchAnalytics {
  if (report.matchId !== match.matchId || report.players.length !== match.players.length) throw new ApiClientError('INVALID_RESPONSE');
  const roster = new Map(match.players.map((player) => [player.id, player.teamId]));
  const roundIds = new Set(match.rounds.map((round) => round.id));
  const seen = new Set<string>();
  for (const player of report.players) {
    if (seen.has(player.playerId) || roster.get(player.playerId) !== player.teamId) throw new ApiClientError('INVALID_RESPONSE');
    seen.add(player.playerId);
  }
  if (report.episodes.some((episode) => !roster.has(episode.playerId) || !roundIds.has(episode.roundId))) throw new ApiClientError('INVALID_RESPONSE');
  if (report.rounds.some((round) => !roundIds.has(round.roundId) || round.players.some((player) => !roster.has(player.playerId)))) {
    throw new ApiClientError('INVALID_RESPONSE');
  }
  const fallback: MatchAnalytics = {
    players: {}, mvp: { state: 'unavailable' }, whoRuined: { state: 'unavailable' },
    moments: null, roundImpact: null, insights: null,
  };
  return {
    ...(base ?? fallback),
    moments: report.episodes.map((episode) => ({
      id: episode.id, playerId: episode.playerId, roundId: episode.roundId, tick: episode.startTick,
      endTick: episode.endTick,
      category: episode.kind === 'HIGHLIGHT' ? 'positive' : episode.kind === 'ANTI_HIGHLIGHT' ? 'mistake' : 'fact',
      kind: episode.type, importance: (episode.significance ?? 0) >= 2 ? 'high' : 'medium',
      confidence: episode.confidence, evidenceStrength: episode.evidenceStrength, observedFacts: episode.observedFacts,
    })),
    roundImpact: report.rounds.map((round) => ({
      roundId: round.roundId,
      players: Object.fromEntries(round.players.map((player) => [player.playerId, player.net])),
    })),
  };
}

function presentAward(
  match: MatchData,
  report: ActiveParticipationRatingReport,
  award: ActiveParticipationRatingReport['awards']['mvp'] | ActiveParticipationRatingReport['awards']['whoRuined'],
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
export function presentParticipationRating(match: MatchData, base: MatchAnalytics | undefined, report: ActiveParticipationRatingReport): MatchAnalytics {
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
