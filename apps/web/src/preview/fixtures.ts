import { matchDataSchema, type MatchData } from '@who-ruined/contracts';
import type { MatchAnalytics } from '../analytics/types.js';

export const scenarios = ['available', 'low-confidence', 'insufficient-data', 'm1', 'partial'] as const;
export type PreviewScenario = typeof scenarios[number];

// Synthetic design fixture. Never import this module from a production data loader.
const names = ['SPECTRE', 'nova', 'oxide', 'vanta', 'echo', 'cipher', 'flux', 'rook', 'haze', 'drift'];
const players: MatchData['players'] = names.map((displayName, index) => ({
  id: 'sample-player-' + index, steamId: null, displayName, teamId: index < 5 ? 'roster-alpha' : 'roster-bravo',
  scoreboard: { kills: [26, 21, 18, 15, 12, 23, 17, 14, 10, 8][index] ?? 0, deaths: 11 + index % 5,
    assists: 3 + index % 7, teamKills: 0, source: 'PARSED_DEATH_EVENTS_SCOREBOARD_PHASES' },
}));
const scores: Record<string, number> = { 'roster-alpha': 0, 'roster-bravo': 0 };
const rounds: MatchData['rounds'] = Array.from({ length: 21 }, (_, index) => {
  const winnerTeamId = [1, 3, 5, 6, 9, 12, 15, 18].includes(index) ? 'roster-bravo' : 'roster-alpha';
  const scoreBefore = { ...scores };
  scores[winnerTeamId] = (scores[winnerTeamId] ?? 0) + 1;
  const sideByTeamId = { 'roster-alpha': index < 12 ? 'CT' as const : 'T' as const, 'roster-bravo': index < 12 ? 'T' as const : 'CT' as const };
  return { id: 'sample-round-' + index, ordinal: index + 1, startTick: index * 6400, freezeEndTick: index * 6400 + 960,
    endTick: index * 6400 + 6200, winnerTeamId, winnerSide: sideByTeamId[winnerTeamId as keyof typeof sideByTeamId],
    sideByTeamId, scoreBefore, scoreAfter: { ...scores }, isValid: true, issues: [] };
});
export const syntheticMatch: MatchData = matchDataSchema.parse({
  schemaVersion: '1', matchId: 'synthetic-design-match', fileSha256: '0'.repeat(64), map: 'de_mirage', tickRate: 64,
  teams: [{ id: 'roster-alpha', label: 'NORTH', playerIds: players.slice(0, 5).map((player) => player.id) }, { id: 'roster-bravo', label: 'SOUTH', playerIds: players.slice(5).map((player) => player.id) }],
  players, rounds,
  events: rounds.map((round, index) => ({ id: 'sample-event-' + index, kind: 'PLAYER_DEATH', roundId: round.id,
    tick: round.startTick + 1600, actorId: players[index % 5]?.id, targetId: players[5 + index % 5]?.id,
    assisterId: null, attrs: { friendlyFire: false }, source: { eventName: 'player_death', rowIndex: index } })),
  quality: 'VALID', qualityIssues: [], provenance: { parser: 'SYNTHETIC_DESIGN_FIXTURE', parserVersion: 'none', normalizedAt: '2026-01-01T12:00:00Z' },
});
export function previewData(scenario: PreviewScenario): { match: MatchData; analytics?: MatchAnalytics } {
  const match = structuredClone(syntheticMatch);
  if (scenario === 'm1') return { match };
  if (scenario === 'partial') {
    match.quality = 'PARTIAL'; match.tickRate = null;
    match.qualityIssues = [{ code: 'SAMPLE_MISSING_DATA', message: 'Synthetic fixture: some source values are intentionally absent.' }];
    const last = match.rounds.at(-1);
    if (last) { last.scoreAfter = {}; last.isValid = false; }
    const firstPlayer = match.players[0];
    if (firstPlayer) delete firstPlayer.scoreboard;
    return { match };
  }
  const awardState = scenario === 'available' ? null : { state: 'insufficient-data' as const, reason: 'SYNTHETIC_PREVIEW_UNAVAILABLE' };
  return { match, analytics: {
    source: 'm4',
    mvp: awardState ?? { state: 'available', playerId: 'sample-player-0', value: 1.42, poolSize: 10, scoreGap: 0.08, close: false, tied: false, tiedPlayerIds: [] },
    whoRuined: awardState ?? { state: 'available', playerId: 'sample-player-9', value: 0.68, poolSize: 5, scoreGap: 0.06, close: false, tied: false, tiedPlayerIds: [], scope: 'LOSING_TEAM_ELIGIBLE' },
    players: Object.fromEntries(players.map((player, index) => [player.id, {
      kills: player.scoreboard?.kills ?? null, deaths: player.scoreboard?.deaths ?? null, assists: player.scoreboard?.assists ?? null,
      damage: 2188 - index * 107, adr: 104.2 - index * 5.1, kast: 85.7 - index * 2.8, openingKills: 5 - index % 5, openingDeaths: index % 4,
      trades: 4 - index % 4, utilityDamage: null, heDamage: 80 - index * 3, fireDamage: 45 - index * 2,
      ratingAvailability: 'CALCULATED_RESEARCH_ONLY', ratingReason: null,
      ratingCoverage: { verifiedRounds: 21, partialRounds: 0, unknownRounds: 0, absentFullRounds: 0, globalExcludedRounds: 0 },
      rating: { value: 1.42 - index * 0.08, rank: index + 1, losingTeamRank: index < 5 ? null : index - 4,
        rawFamilyInputs: { COMBAT: 0.04 - index * 0.002, SUPPORT: 0.01, DEATH_RELATED: -0.01, OBJECTIVES: 0.003, CONTEXT: 0.002, DIRECT_HARM: index === 0 ? 0 : -index * 0.001 },
        finalAttribution: { COMBAT: 0.4 - index * 0.02, SUPPORT: 0.1, DEATH_RELATED: -0.03, OBJECTIVES: 0.03, CONTEXT: 0.02, DIRECT_HARM: index === 0 ? 0 : -index * 0.002 } },
    }])),
    moments: [
      { id: 'sample-trade', playerId: 'sample-player-0', roundId: 'sample-round-3', tick: 21300, category: 'positive', kind: 'trade', importance: 'high', confidence: 0.96 },
      { id: 'sample-flash', playerId: 'sample-player-6', roundId: 'sample-round-9', tick: 59200, category: 'positive', kind: 'flash-assist', importance: 'medium', confidence: 0.91 },
      { id: 'sample-mistake', playerId: 'sample-player-9', roundId: 'sample-round-16', tick: 104000, category: 'mistake', kind: 'untraded-entry', importance: 'high', confidence: 0.82 },
      { id: 'sample-recovery', playerId: 'sample-player-9', roundId: 'sample-round-6', tick: 40500, category: 'positive', kind: 'trade', importance: 'medium', confidence: 0.9 },
    ],
    roundImpact: rounds.map((round, index) => ({ roundId: round.id, players: Object.fromEntries(players.map((player, playerIndex) => [player.id, ((index * 7 + playerIndex * 3) % 15) - 4])) })),
    insights: Object.fromEntries(players.map((player, index) => [player.id, {
      strengths: index % 2 ? ['utility-support'] : ['opening-duels'], opportunities: index > 4 ? ['untraded-entries'] : [],
    }])),
    activeRating: { experimental: true, calibrated: false, causalBlame: false, eligiblePoolSize: 10, incompletePool: false, outcome: 'DECIDED', warnings: [], limitations: [] },
  } };
}
