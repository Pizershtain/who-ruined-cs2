import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { matchDataSchema, scoringReportSchema, type MatchData } from '@who-ruined/contracts';
import { ApiClientError, getScoringReport } from './api.js';
import { presentScoring } from './analytics/adapter.js';
import type { MatchAnalytics, PlayerMetrics } from './analytics/types.js';

const report = scoringReportSchema.parse(JSON.parse(readFileSync(new URL('../../../tests/fixtures/m3-scoring-report.json', import.meta.url), 'utf8')) as unknown);
const match: MatchData = matchDataSchema.parse({
  schemaVersion: '1', matchId: report.matchId, fileSha256: 'a'.repeat(64), map: 'de_fixture', tickRate: 64,
  teams: [
    { id: 'team_1', label: 'Roster 1', playerIds: ['player_01'] },
    { id: 'team_2', label: 'Roster 2', playerIds: ['player_02'] }
  ],
  players: [
    { id: 'player_01', steamId: null, displayName: 'Player 01', teamId: 'team_1' },
    { id: 'player_02', steamId: null, displayName: 'Player 02', teamId: 'team_2' }
  ],
  rounds: [{ id: 'round_03', ordinal: 3, startTick: 3000, freezeEndTick: 3050, endTick: 4000, winnerTeamId: 'team_1', winnerSide: 'CT', sideByTeamId: { team_1: 'CT', team_2: 'T' }, scoreBefore: { team_1: 1, team_2: 1 }, scoreAfter: { team_1: 2, team_2: 1 }, isValid: true, issues: [] }],
  events: [], quality: 'VALID', qualityIssues: [], provenance: { parser: 'fixture', parserVersion: 'fixture', normalizedAt: '2000-01-01T00:00:00.000Z' }
});
const emptyMetrics = (): PlayerMetrics => ({
  damage: null, adr: null, kast: null, openingKills: null, openingDeaths: null, trades: null,
  utilityDamage: null, performance: null, impact: null, mistakes: null
});
const base: MatchAnalytics = {
  source: 'm2', mvp: { state: 'unavailable' }, whoRuined: { state: 'unavailable' },
  players: { player_01: emptyMetrics(), player_02: emptyMetrics() }, moments: null,
  roundImpact: null, insights: null
};

afterEach(() => vi.unstubAllGlobals());

describe('live M3 integration boundary', () => {
  it('maps only server-computed leaders, components and evidence', () => {
    const view = presentScoring(match, base, report);
    expect(view.mvp).toMatchObject({ state: 'available', playerId: 'player_01', value: 1.25 });
    expect(view.whoRuined).toMatchObject({ state: 'available', playerId: 'player_02', value: 100 });
    expect(view.players.player_02?.mistakes).toBe(0.208333);
    expect(view.moments).toEqual([expect.objectContaining({ playerId: 'player_02', category: 'mistake', kind: 'TEAM_KILL_EPISODE', evidenceStrength: 'DIRECT' })]);
    expect(view.roundImpact?.[0]?.players.player_02).toBe(-2.5);
    expect(view.scoring?.experimental).toBe(true);
  });

  it('rejects roster mismatches instead of attaching a score to another player', () => {
    const changed = { ...report, players: report.players.map((player) => player.playerId === 'player_02' ? { ...player, teamId: 'team_1' } : player) };
    expect(() => presentScoring(match, base, changed)).toThrow(ApiClientError);
  });

  it('rejects a Who Ruined leader outside the losing roster', () => {
    const changed = { ...report, whoRuined: report.whoRuined && { ...report.whoRuined, playerId: 'player_01' } };
    expect(() => presentScoring(match, base, changed)).toThrow(ApiClientError);
  });

  it('validates a real-shaped HTTP report response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(report), { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(getScoringReport(report.matchId, new AbortController().signal)).resolves.toEqual(report);
  });

  it('preserves backend 409 codes without a synthetic fallback', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: { code: 'INCOMPLETE_MATCH' }, requestId: 'fixture-request' }), { status: 409, headers: { 'content-type': 'application/json' } })));
    await expect(getScoringReport(report.matchId, new AbortController().signal)).rejects.toMatchObject({ code: 'INCOMPLETE_MATCH', status: 409, requestId: 'fixture-request' });
  });
});
