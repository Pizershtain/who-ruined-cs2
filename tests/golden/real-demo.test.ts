import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { CDataGCCStrike15_v2_MatchInfoSchema, fromBinary } from 'csgo-protobuf';
import { describe, expect, it } from 'vitest';
import { normalizeSnapshot, stableTeamId } from '../../packages/match-domain/dist/index.js';
import { NORMALIZER_VERSION, PARSER_LIBRARY_VERSION, parseDemoSnapshot } from '../../packages/parser-adapter/dist/index.js';
import { computeMatchAnalytics } from '../../packages/features/dist/index.js';

try {
  loadEnvFile(new URL('./.env.local', import.meta.url));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

interface GoldenFixture {
  id: string;
  envPrefix: string;
  sha256: string;
  parserVersion: string;
  normalizerVersion: string;
  expected: {
    map: string; players: number; teams: number; rounds: number; liveDeathEvents: number;
    nonLiveDeathEvents: number; tickRate: number; scoreAfterByReferenceTeam: number[][]; sortedKda: number[][];
    m2: { events: number; kills: number; deaths: number; assists: number; enemyDamage: number; teamDamage: number; trades: number; openings: number; plants: number; defuses: number; explosions: number; flashThrows: number; heThrows: number; infernos: number; smokes: number };
  };
}

const manifest = JSON.parse(await readFile(new URL('./manifest.json', import.meta.url), 'utf8')) as { fixtures: GoldenFixture[] };
const steamId64Base = 76_561_197_960_265_728n;

describe('real demo reconciliation', () => {
  for (const fixture of manifest.fixtures) {
    const legacyOffice = fixture.envPrefix === 'OFFICE';
    const demoPath = process.env[`GOLDEN_${fixture.envPrefix}_DEMO_PATH`] ?? (legacyOffice ? process.env.GOLDEN_DEMO_PATH : undefined);
    const infoPath = process.env[`GOLDEN_${fixture.envPrefix}_INFO_PATH`] ?? (legacyOffice ? process.env.GOLDEN_INFO_PATH : undefined);

    it.skipIf(!demoPath || !infoPath)(`${fixture.id}: matches manifest and external info`, async () => {
      if (!demoPath || !infoPath) throw new Error(`GOLDEN_${fixture.envPrefix}_DEMO_PATH and INFO_PATH are required`);
      const demoBytes = await readFile(demoPath);
      expect(createHash('sha256').update(demoBytes).digest('hex')).toBe(fixture.sha256);
      expect(PARSER_LIBRARY_VERSION).toBe(fixture.parserVersion);
      expect(NORMALIZER_VERSION).toBe(fixture.normalizerVersion);
      const match = normalizeSnapshot({
        matchId: fixture.id, fileSha256: fixture.sha256, normalizedAt: '2000-01-01T00:00:00.000Z',
        snapshot: parseDemoSnapshot(demoPath)
      });
      const info = fromBinary(CDataGCCStrike15_v2_MatchInfoSchema, await readFile(infoPath));
      const referenceRounds = info.roundstatsall; const finalReference = referenceRounds.at(-1);
      if (!finalReference?.reservation || finalReference.reservation.accountIds.length !== 10) throw new Error('Reference info does not contain a 10-player roster');
      const referencePlayerIds = finalReference.reservation.accountIds.map((accountId) => (BigInt(accountId) + steamId64Base).toString());
      const referenceTeamIds = [stableTeamId(referencePlayerIds.slice(0, 5)), stableTeamId(referencePlayerIds.slice(5, 10))];

      expect(match.quality).toBe('VALID');
      expect(match.qualityIssues).toEqual([]);
      expect(match.map).toBe(fixture.expected.map);
      expect(match.tickRate).toBe(fixture.expected.tickRate);
      expect(match.players).toHaveLength(fixture.expected.players);
      expect(match.teams).toHaveLength(fixture.expected.teams);
      expect(match.rounds).toHaveLength(fixture.expected.rounds);
      expect(match.rounds).toHaveLength(referenceRounds.length);
      expect(match.rounds.every((round) => round.isValid)).toBe(true);
      expect(match.rounds[0]?.sideByTeamId).not.toEqual(match.rounds[12]?.sideByTeamId);
      expect(new Set(match.players.map((player) => player.id)).size).toBe(10);
      expect(match.players.every((player) => player.steamId === player.id && /^7656119\d{10}$/.test(player.id))).toBe(true);
      expect(match.players.every((player) => player.displayName.length > 0 && !/^Игрок \d+$/.test(player.displayName))).toBe(true);

      const scoreSequence = match.rounds.map((round) => referenceTeamIds.map((teamId) => round.scoreAfter[teamId]));
      expect(scoreSequence).toEqual(referenceRounds.map((round) => round.teamScores));
      expect(scoreSequence).toEqual(fixture.expected.scoreAfterByReferenceTeam);
      const liveDeaths = match.events.filter((event) => event.kind === 'PLAYER_DEATH');
      const nonLiveDeaths = match.events.filter((event) => event.kind === 'PLAYER_DEATH_NONLIVE');
      expect(liveDeaths).toHaveLength(fixture.expected.liveDeathEvents);
      expect(nonLiveDeaths).toHaveLength(fixture.expected.nonLiveDeathEvents);
      expect(new Set(match.events.map((event) => event.id)).size).toBe(match.events.length);

      const actualKda = referencePlayerIds.map((playerId) => {
        const scoreboard = match.players.find((player) => player.id === playerId)?.scoreboard;
        return [scoreboard?.kills, scoreboard?.deaths, scoreboard?.assists];
      });
      const expectedKda = referencePlayerIds.map((_playerId, index) => [finalReference.kills[index], finalReference.deaths[index], finalReference.assists[index]]);
      expect(actualKda).toEqual(expectedKda);
      expect(actualKda.toSorted((a, b) => (a[0] ?? 0) - (b[0] ?? 0) || (a[1] ?? 0) - (b[1] ?? 0) || (a[2] ?? 0) - (b[2] ?? 0))).toEqual(fixture.expected.sortedKda);

      const analytics = computeMatchAnalytics(match, '2000-01-01T00:00:00.000Z');
      expect(analytics.players).toHaveLength(10);
      expect(analytics.availability.damage).toBe('AVAILABLE');
      expect(analytics.availability.flashes).toBe('AVAILABLE');
      expect(analytics.availability.economy).toBe('AVAILABLE');
      expect(analytics.players.every((player) => player.roundsPlayed === fixture.expected.rounds)).toBe(true);
      expect(analytics.players.reduce((sum, player) => sum + (player.deaths ?? 0), 0)).toBe(fixture.expected.liveDeathEvents);
      expect(analytics.players.every((player) => player.enemyDamage !== null && player.adr !== null && player.kastPercent !== null)).toBe(true);
      const sum = (pick: (player: typeof analytics.players[number]) => number | null): number => analytics.players.reduce((total, player) => total + (pick(player) ?? 0), 0);
      expect({
        events: match.events.length, kills: sum((player) => player.kills), deaths: sum((player) => player.deaths), assists: sum((player) => player.assists),
        enemyDamage: sum((player) => player.enemyDamage), teamDamage: sum((player) => player.teamDamage), trades: sum((player) => player.tradeKills), openings: sum((player) => player.openingKills),
        plants: sum((player) => player.bomb.plants), defuses: sum((player) => player.bomb.defuses), explosions: sum((player) => player.bomb.explosions),
        flashThrows: sum((player) => player.grenades.flashesThrown), heThrows: sum((player) => player.grenades.heThrown), infernos: sum((player) => player.grenades.infernosStarted), smokes: sum((player) => player.grenades.smokesThrown)
      }).toEqual(fixture.expected.m2);
      expect(sum((player) => player.tradeKills)).toBe(sum((player) => player.deathsTraded));
    });
  }
});
