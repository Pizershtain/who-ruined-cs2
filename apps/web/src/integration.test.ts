import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeParticipationRatingReportSchema, matchDataSchema, scoringReportSchema, type ActiveParticipationRatingReport, type MatchData, type ScoringReport } from '@who-ruined/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { ApiClientError, getActiveParticipationRating, getScoringReport } from './api.js';
import { presentEvidenceReport, presentParticipationRating } from './analytics/adapter.js';
import { Scoreboard } from './components/Scoreboard.js';
import { canRetryRatingError } from './shared/scoring.js';
import { isReportPending } from './hooks/useScoring.js';

const ids = Array.from({ length: 10 }, (_, index) => `player_${String(index + 1).padStart(2, '0')}`);
const match: MatchData = matchDataSchema.parse({
  schemaVersion: '1', matchId: 'synthetic-m4-web-match', fileSha256: 'a'.repeat(64), map: 'de_fixture', tickRate: 64,
  teams: [
    { id: 'team_1', label: 'Roster 1', playerIds: ids.slice(0, 5) },
    { id: 'team_2', label: 'Roster 2', playerIds: ids.slice(5) }
  ],
  players: ids.map((id, index) => ({ id, steamId: null, displayName: `Synthetic ${index + 1}`, teamId: index < 5 ? 'team_1' : 'team_2' })),
  rounds: [{ id: 'round_01', ordinal: 1, startTick: 0, freezeEndTick: 50, endTick: 1000, winnerTeamId: 'team_1', winnerSide: 'CT', sideByTeamId: { team_1: 'CT', team_2: 'T' }, scoreBefore: { team_1: 0, team_2: 0 }, scoreAfter: { team_1: 13, team_2: 8 }, isValid: true, issues: [] }],
  events: [], quality: 'VALID', qualityIssues: [], provenance: { parser: 'synthetic-test', parserVersion: 'fixture', normalizedAt: '2026-10-29T00:00:00.000Z' }
});

function analytics(playerId: string, teamId: string) {
  return {
    playerId, teamId, roundsPlayed: 21, kills: 10, deaths: 10, assists: 5, kdaRatio: 1.5,
    enemyDamage: 1500, teamDamage: 0, adr: 75, kastRounds: 15, kastPercent: 71.4, survivedRounds: 5,
    openingKills: 2, openingDeaths: 2, tradeKills: 3, deathsTraded: 2, untradedDeaths: 8, tradeParticipation: 5,
    multiKills: { two: 1, three: 0, four: 0, five: 0 }, clutches: {}, killsWithAdvantage: 2, killsAtDisadvantage: 1,
    teamKills: 0, suicides: 0, bomb: { plants: 0, defuses: 0, explosions: 0 },
    grenades: { flashesThrown: 3, enemiesFlashed: 2, teammatesFlashed: 0, enemyBlindSeconds: 4, teamBlindSeconds: 0, heThrown: 2, heEnemyDamage: 30, heTeamDamage: 0, infernosStarted: 1, infernoEnemyDamage: 20, infernoTeamDamage: 0, smokesThrown: 3, smokeEffectiveness: null },
    economy: { availability: 'AVAILABLE' as const, freezeEquipmentValueTotal: 50000, freezeRoundsObserved: 21, money: null }, facts: []
  };
}

function makeReport(absentIndex: number | null = 8, draw = false): ActiveParticipationRatingReport {
  const players = ids.map((playerId, index) => {
    const teamId = index < 5 ? 'team_1' : 'team_2';
    const absent = index === absentIndex;
    const families = { COMBAT: 0.04, SUPPORT: 0.01, DEATH_RELATED: -0.02, DIRECT_HARM: index === 0 ? 0 : -0.001 * index, CONTEXT: 0.002, OBJECTIVES: 0.003 };
    const final = { COMBAT: 0.4, SUPPORT: 0.1, DEATH_RELATED: -0.03, DIRECT_HARM: index === 0 ? 0 : -0.002 * index, CONTEXT: 0.02, OBJECTIVES: 0.03 };
    const value = 1 + Object.values(final).reduce((sum, item) => sum + item, 0);
    return {
      playerId, teamId, displayName: `Synthetic ${index + 1}`, steamId: null, steamProfileUrl: null,
      availability: { status: absent ? 'PARTICIPATION_ABSENT_GT_2_ROUNDS' as const : 'CALCULATED_RESEARCH_ONLY' as const, reason: absent ? 'SYNTHETIC_ABSENCE' : null },
      coverage: { verifiedRounds: absent ? 9 : 21, absentFullRounds: absent ? 12 : 0, partialRounds: 0, unknownRounds: 0, globalExcludedRounds: 0, countedOpportunities: 21, excludedOpportunities: 0, sideExposure: { T: 10, CT: 11 }, causeCodes: [] },
      rating: absent ? null : {
        value, rank: index + 1, losingTeamRank: index >= 5 || draw ? index + 1 : null, rawFamilyInputs: families,
        aggregates: { positiveMass: 0.055, negativeMass: 0.02, positiveTerm: 0.55, negativeTerm: -0.03, harmTerm: index === 0 ? 0 : -0.002 * index },
        finalAttribution: final, arithmetic: { origin: 1 as const, reconstructed: value, tolerance: 1e-12 as const, exactWithinTolerance: true as const },
        kernelDetails: { factorContributions: { CONTEXT: {}, OBJECTIVES: {} }, directHarm: { raw: 0, soft: 0, adjustment: 0, transformed: false, k: 0, a: 0 }, context: { uncenteredSignal: 0, saturated: false, winningTagByAnchor: {} }, objectives: { positiveCapped: false, negativeCapped: false } }
      },
      baseStats: { kills: 10, deaths: 10, assists: 5, kdaRatio: 1.5, adr: 75, kastPercent: 71.4 },
      analytics: analytics(playerId, teamId)
    };
  });
  return activeParticipationRatingReportSchema.parse({
    schemaVersion: 'm4.3-participation-rating@1', reportVersion: 'match-result@1', matchId: match.matchId,
    experimental: true, calibrated: false, causalBlame: false, scorerVersion: 'm3c8-p7.2-f-rating-projector@1.0.0-experimental',
    scenario: 'BOMB', applicability: { status: 'SUPPORTED', reason: null },
    match: { map: match.map, quality: 'VALID', totalRounds: 21, validRounds: 21, teams: [{ teamId: 'team_1', score: draw ? 12 : 13 }, { teamId: 'team_2', score: draw ? 12 : 8 }] },
    players, ordering: ids.filter((_, index) => index !== absentIndex), losingTeamOrdering: ids.slice(5).filter((_, index) => index + 5 !== absentIndex),
    awards: {
      eligiblePoolSize: absentIndex === null ? 10 : 9, incompletePool: absentIndex !== null, losingTeamId: draw ? null : 'team_2', outcome: draw ? 'DRAW' : 'DECIDED',
      mvp: { playerId: 'player_01', awardPoolSize: absentIndex === null ? 10 : 9, tied: false, close: false, tiedPlayerIds: [], scoreGap: 0.1, reasonIfUnavailable: null },
      whoRuined: { playerId: 'player_10', awardPoolSize: draw ? (absentIndex === null ? 10 : 9) : 4, tied: false, close: false, tiedPlayerIds: [], scoreGap: 0.1, reasonIfUnavailable: null, scope: draw ? 'DRAW_ALL_ELIGIBLE' : 'LOSING_TEAM_ELIGIBLE' }
    },
    warnings: [], limitations: [], provenance: { parserVersion: 'fixture', normalizerVersion: 'fixture', featureVersion: 'fixture', originalDemoParsedAtRequest: false }
  });
}

function makeEvidenceReport(): ScoringReport {
  const players = ids.map((playerId, index) => ({
    playerId, teamId: index < 5 ? 'team_1' : 'team_2', validRounds: 1,
    positive: index === 0 ? 1 : 0, negative: 0, net: index === 0 ? 1 : 0,
    positiveRate: index === 0 ? 1 : 0, performanceRate: index === 0 ? 1 : 0,
    contextContributionRate: 0, confirmedHarmRate: 0, teamReference: 0,
    positiveShortfall: 0, ruinRaw: 0, relativeIndex: index,
    components: {
      performance: { kills: 0, assists: 0, enemyDamage: 0, adr: 0, kastPercent: 0, survivedRounds: 0, multiKillRounds: 0, flashAssists: 0, enemyBlindSeconds: 0 },
      contextContribution: { points: 0, openingKills: 0, tradeKills: 0, killsWithAdvantage: 0, killsAtDisadvantage: 0, bombPlantsWon: 0, bombDefuses: 0 },
      confirmedHarm: { points: 0, teamDamage: 0, teamKills: 0, teamBlindSeconds: 0, liveSuicides: 0 },
    },
    findings: [], episodeIds: index === 0 ? ['synthetic-evidence-episode'] : [],
  }));
  return scoringReportSchema.parse({
    schemaVersion: 'm3-score-1', matchId: match.matchId, scorerVersion: 'synthetic-scoring@1', configHash: 'b'.repeat(64),
    model: 'SUCCESSOR', experimental: true, status: 'COMPLETED', quality: 'VALID', winningTeamId: 'team_1', losingTeamId: 'team_2',
    coverage: { score: 1, rounds: 1, identities: 1, deaths: 1, enemyDamage: 1, teamDamage: 1, eligible: true, reasons: [] },
    mvp: null, whoRuined: null, v1ClearRuinerPlayerId: null, players,
    episodes: [{
      id: 'synthetic-evidence-episode', kind: 'HIGHLIGHT', type: 'DAMAGE_CONTRIBUTION', scorerVersion: 'synthetic-scoring@1', configHash: 'b'.repeat(64),
      playerId: 'player_01', roundId: 'round_01', startTick: 200, endTick: 220, evidenceEventIds: ['synthetic-event'],
      observedFacts: ['ENEMY_DAMAGE=0.5'], significance: 0.5, confidence: 1, evidenceStrength: 'DIRECT', explanationKey: 'episode.enemy_damage', supportingFindingCodes: ['ENEMY_DAMAGE'],
      context: { phase: 'LIVE', side: 'CT', weapon: 'ak47', bombState: 'NOT_PLANTED', secondsFromFreezeEnd: 2.5, equipmentValue: 2700, aliveByTeamId: { team_1: 5, team_2: 5 } }, research: null,
    }],
    rounds: [{ roundId: 'round_01', ordinal: 1, players: players.map((player) => ({ playerId: player.playerId, positive: player.positive, negative: player.negative, net: player.net, findingIds: [], episodeIds: player.episodeIds })) }],
    warnings: [], limitations: [],
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('active M4 participation rating boundary', () => {
  it('loads evidence episodes from the production report without adopting its legacy scores or awards', async () => {
    const report = makeEvidenceReport();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(report), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getScoringReport(match.matchId, new AbortController().signal)).resolves.toEqual(report);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/matches/synthetic-m4-web-match/report', expect.anything());

    const evidence = presentEvidenceReport(match, undefined, report);
    expect(evidence.moments).toEqual([expect.objectContaining({ id: 'synthetic-evidence-episode', category: 'positive', kind: 'DAMAGE_CONTRIBUTION' })]);
    expect(evidence.roundImpact).toEqual([expect.objectContaining({ roundId: 'round_01' })]);
    expect(evidence.players).toEqual({});
    expect(evidence.mvp).toEqual({ state: 'unavailable' });
    expect(evidence.whoRuined).toEqual({ state: 'unavailable' });

    const combined = presentParticipationRating(match, evidence, makeReport(null));
    expect(combined.moments).toHaveLength(1);
    expect(combined.players.player_01?.rating?.value).toBe(makeReport(null).players[0]?.rating?.value);
  });

  it('polls only a genuinely pending evidence report', () => {
    expect(isReportPending(new ApiClientError('REPORT_NOT_READY', 409))).toBe(true);
    expect(isReportPending(new ApiClientError('REPORT_CORRUPT', 409))).toBe(false);
    expect(isReportPending(new ApiClientError('INCOMPLETE_MATCH', 409))).toBe(false);
  });

  it('maps all 10/10 server ratings without calculating a replacement value', () => {
    const view = presentParticipationRating(match, undefined, makeReport(null));
    expect(Object.values(view.players).filter((player) => player.rating !== null)).toHaveLength(10);
    expect(view.activeRating).toMatchObject({ eligiblePoolSize: 10, incompletePool: false });
    expect(view.players.player_10?.rating?.value).toBe(makeReport(null).players[9]?.rating?.value);
  });

  it('preserves a 9/10 null while keeping every other server rating available', () => {
    const view = presentParticipationRating(match, undefined, makeReport());
    expect(view.mvp).toMatchObject({ state: 'available', playerId: 'player_01' });
    expect(view.whoRuined).toMatchObject({ state: 'available', playerId: 'player_10', scope: 'LOSING_TEAM_ELIGIBLE' });
    expect(view.players.player_09).toMatchObject({ rating: null, ratingAvailability: 'PARTICIPATION_ABSENT_GT_2_ROUNDS' });
    expect(Object.values(view.players).filter((player) => player.rating !== null)).toHaveLength(9);
    expect(view.activeRating).toMatchObject({ experimental: true, calibrated: false, causalBlame: false, eligiblePoolSize: 9, incompletePool: true });
  });

  it('preserves all six raw and final families, including negative values', () => {
    const rating = presentParticipationRating(match, undefined, makeReport(null)).players.player_02?.rating;
    expect(Object.keys(rating?.rawFamilyInputs ?? {}).sort()).toEqual(['COMBAT', 'CONTEXT', 'DEATH_RELATED', 'DIRECT_HARM', 'OBJECTIVES', 'SUPPORT']);
    expect(Object.keys(rating?.finalAttribution ?? {}).sort()).toEqual(['COMBAT', 'CONTEXT', 'DEATH_RELATED', 'DIRECT_HARM', 'OBJECTIVES', 'SUPPORT']);
    expect(rating?.rawFamilyInputs).toMatchObject({ DEATH_RELATED: -0.02, DIRECT_HARM: -0.001 });
    expect(rating?.finalAttribution).toMatchObject({ DEATH_RELATED: -0.03, DIRECT_HARM: -0.002 });
  });

  it('honors a genuine draw and the backend DRAW_ALL_ELIGIBLE pool', () => {
    const view = presentParticipationRating(match, undefined, makeReport(null, true));
    expect(view.whoRuined).toMatchObject({ state: 'available', scope: 'DRAW_ALL_ELIGIBLE', poolSize: 10 });
    expect(view.activeRating?.outcome).toBe('DRAW');
  });

  it('preserves nullable awards and their incomplete-pool diagnostics', () => {
    const source = makeReport();
    const report = activeParticipationRatingReportSchema.parse({
      ...source,
      awards: {
        ...source.awards,
        mvp: { playerId: null, awardPoolSize: 9, tied: false, close: false, tiedPlayerIds: [], scoreGap: null, reasonIfUnavailable: 'SYNTHETIC_NO_MVP' },
        whoRuined: { playerId: null, awardPoolSize: 4, tied: false, close: false, tiedPlayerIds: [], scoreGap: null, reasonIfUnavailable: 'SYNTHETIC_NO_LOSER_AWARD', scope: 'UNAVAILABLE' },
      },
    });
    const view = presentParticipationRating(match, undefined, report);
    expect(view.mvp).toEqual({ state: 'insufficient-data', poolSize: 9, reason: 'SYNTHETIC_NO_MVP', tied: false });
    expect(view.whoRuined).toEqual({ state: 'insufficient-data', poolSize: 4, reason: 'SYNTHETIC_NO_LOSER_AWARD', tied: false, scope: 'UNAVAILABLE' });
    expect(view.activeRating).toMatchObject({ eligiblePoolSize: 9, incompletePool: true });
  });

  it('uses backend tie metadata without selecting a client-side winner', () => {
    const source = makeReport(null);
    const report = activeParticipationRatingReportSchema.parse({
      ...source,
      players: source.players.map((player) => player.playerId === 'player_02' && player.rating ? { ...player, rating: { ...player.rating, value: source.players[0]!.rating!.value, rank: 1 } } : player),
      awards: { ...source.awards, mvp: { ...source.awards.mvp, tied: true, close: true, tiedPlayerIds: ['player_01', 'player_02'], scoreGap: 0 } },
    });
    expect(presentParticipationRating(match, undefined, report).mvp).toMatchObject({ playerId: 'player_01', tied: true, close: true, tiedPlayerIds: ['player_01', 'player_02'], scoreGap: 0 });
  });

  it('rejects roster mismatches instead of attaching a rating to another team', () => {
    const report = makeReport();
    const changed = { ...report, players: report.players.map((player) => player.playerId === 'player_02' ? { ...player, teamId: 'team_2' } : player) };
    expect(() => presentParticipationRating(match, undefined, changed)).toThrow(ApiClientError);
  });

  it('validates the active endpoint response and never sends a policy selector', async () => {
    const report = makeReport();
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(report), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getActiveParticipationRating(report.matchId, new AbortController().signal)).resolves.toEqual(report);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/matches/synthetic-m4-web-match/experimental-participation-rating', expect.anything());
  });

  it.each([
    ['REPORT_NOT_READY', 409],
    ['REPORT_CORRUPT', 409],
    ['REPORT_POLICY_MISMATCH', 409],
    ['EXPERIMENTAL_PARTICIPATION_RATING_DISABLED', 404],
  ] as const)('preserves %s and performs no legacy fallback', async (code, status) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { code }, requestId: 'synthetic-request' }), { status, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getActiveParticipationRating(match.matchId, new AbortController().signal)).rejects.toMatchObject({ code, status, requestId: 'synthetic-request' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/matches/synthetic-m4-web-match/experimental-participation-rating', expect.anything());
  });

  it('rejects an old or malformed rating payload instead of falling back', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ matchId: match.matchId, players: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getActiveParticipationRating(match.matchId, new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('offers retry only for rating errors that can change without operator action', () => {
    expect(canRetryRatingError(new ApiClientError('REPORT_NOT_READY', 409))).toBe(true);
    expect(canRetryRatingError(new ApiClientError('REPORT_CORRUPT', 409))).toBe(false);
    expect(canRetryRatingError(new ApiClientError('REPORT_POLICY_MISMATCH', 409))).toBe(false);
    expect(canRetryRatingError(new ApiClientError('EXPERIMENTAL_PARTICIPATION_RATING_DISABLED', 404))).toBe(false);
  });

  it('keeps roster identity stable when the same teams swap T and CT sides', () => {
    const first = match.rounds[0]!;
    const swapped: MatchData = {
      ...match,
      rounds: [first, { ...first, id: 'round_02', ordinal: 2, startTick: 1001, freezeEndTick: 1050, endTick: 2000, winnerTeamId: 'team_2', winnerSide: 'CT', sideByTeamId: { team_1: 'T', team_2: 'CT' }, scoreBefore: { team_1: 1, team_2: 0 }, scoreAfter: { team_1: 1, team_2: 1 } }],
    };
    const view = presentParticipationRating(swapped, undefined, makeReport(null));
    expect(view.players.player_01?.rating).not.toBeNull();
    expect(view.players.player_06?.rating).not.toBeNull();
    expect(swapped.players.find((player) => player.id === 'player_01')?.teamId).toBe('team_1');
    expect(swapped.rounds[1]?.sideByTeamId.team_1).toBe('T');
  });

  it('renders a missing rating as an em dash, never as zero or a baseline', async () => {
    const i18n = createInstance();
    await i18n.init({ lng: 'en', fallbackLng: 'en', ns: ['match'], defaultNS: 'match', resources: { en: { match: {} } }, interpolation: { escapeValue: false } });
    const view = presentParticipationRating(match, undefined, makeReport());
    const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(MemoryRouter, null, createElement(Scoreboard, { match, analytics: view, base: '/synthetic' }))));
    expect(html).toContain('aria-label="Player was absent for too many verified rounds">—</span>');
    expect(html).not.toContain('aria-label="Player was absent for too many verified rounds">0</span>');
    expect(html).not.toContain('aria-label="Player was absent for too many verified rounds">1</span>');
  });
});
