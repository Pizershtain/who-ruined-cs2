import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '@who-ruined/contracts';
import { syntheticValidMatch } from '@who-ruined/testkit';
import { computeMatchAnalytics } from '../src/index.js';

function event(index: number, kind: string, tick: number, actorId: string | null, targetId: string | null, attrs: MatchEvent['attrs'] = {}): MatchEvent {
  const match = syntheticValidMatch();
  const actor = match.players.find((player) => player.id === actorId);
  const target = match.players.find((player) => player.id === targetId);
  return {
    id: `1:test:${index}`, kind, roundId: 'round_1', tick, actorId, targetId, assisterId: null, attrs,
    context: { phase: 'LIVE', actorTeamId: actor?.teamId ?? null, targetTeamId: target?.teamId ?? null, actorSide: actor ? match.rounds[0]?.sideByTeamId[actor.teamId] ?? null : null, targetSide: target ? match.rounds[0]?.sideByTeamId[target.teamId] ?? null : null, aliveByTeamId: { team_synthetic_a: 5, team_synthetic_b: 5 }, secondsFromFreezeEnd: (tick - 1100) / 64, bombState: 'NOT_PLANTED', actorEquipmentValue: null, actorMoney: null },
    source: { eventName: kind.toLowerCase(), rowIndex: index }
  };
}

describe('M2 factual analytics', () => {
  it('caps overkill damage and matches one trade death to one later revenge kill', () => {
    const match = syntheticValidMatch();
    const [a1, a2] = match.teams[0]!.playerIds;
    const [b1, b2] = match.teams[1]!.playerIds;
    match.events = [
      event(0, 'PLAYER_HURT', 1200, a1!, b1!, { rawHealthDamage: 90, healthAfter: 10, weapon: 'ak47', friendlyFire: false }),
      event(1, 'PLAYER_HURT', 1210, a1!, b1!, { rawHealthDamage: 40, healthAfter: 0, weapon: 'ak47', friendlyFire: false }),
      event(2, 'PLAYER_DEATH', 1210, a1!, b1!, { friendlyFire: false, suicide: false }),
      event(3, 'PLAYER_DEATH', 1400, b2!, a1!, { friendlyFire: false, suicide: false }),
      event(4, 'PLAYER_DEATH', 1410, a2!, b2!, { friendlyFire: false, suicide: false })
    ];
    const analytics = computeMatchAnalytics(match, '2026-10-16T00:00:00.000Z');
    const attacker = analytics.players.find((player) => player.playerId === a1)!;
    const firstVictim = analytics.players.find((player) => player.playerId === b1)!;
    const revenge = analytics.players.find((player) => player.playerId === b2)!;
    expect(attacker.enemyDamage).toBe(100);
    expect(firstVictim.deathsTraded).toBe(1);
    expect(revenge.tradeKills).toBe(1);
    expect(analytics.players.reduce((sum, player) => sum + (player.deathsTraded ?? 0), 0)).toBe(2);
  });

  it('does not use a future kill outside the five-second trade window', () => {
    const match = syntheticValidMatch();
    const a1 = match.teams[0]!.playerIds[0]!; const b1 = match.teams[1]!.playerIds[0]!; const b2 = match.teams[1]!.playerIds[1]!;
    match.events = [event(0, 'PLAYER_DEATH', 1200, a1, b1, { friendlyFire: false, suicide: false }), event(1, 'PLAYER_DEATH', 1200 + 64 * 5 + 1, b2, a1, { friendlyFire: false, suicide: false })];
    const analytics = computeMatchAnalytics(match, '2026-10-16T00:00:00.000Z');
    expect(analytics.players.find((player) => player.playerId === b1)?.deathsTraded).toBe(0);
  });

  it('includes a revenge kill exactly on the five-second boundary', () => {
    const match = syntheticValidMatch();
    const a1 = match.teams[0]!.playerIds[0]!; const b1 = match.teams[1]!.playerIds[0]!; const b2 = match.teams[1]!.playerIds[1]!;
    match.events = [event(0, 'PLAYER_DEATH', 1200, a1, b1, { friendlyFire: false, suicide: false }), event(1, 'PLAYER_DEATH', 1200 + 64 * 5, b2, a1, { friendlyFire: false, suicide: false })];
    const analytics = computeMatchAnalytics(match, '2026-10-16T00:00:00.000Z');
    expect(analytics.players.find((player) => player.playerId === b1)?.deathsTraded).toBe(1);
    expect(analytics.players.find((player) => player.playerId === b2)?.tradeKills).toBe(1);
  });

  it('does not link a one-second revenge kill across round boundaries', () => {
    const match = syntheticValidMatch();
    const a1 = match.teams[0]!.playerIds[0]!;
    const b1 = match.teams[1]!.playerIds[0]!;
    const b2 = match.teams[1]!.playerIds[1]!;
    const original = event(0, 'PLAYER_DEATH', 1_800, a1, b1, { friendlyFire: false, suicide: false });
    const nextRound = event(1, 'PLAYER_DEATH', 1_864, b2, a1, { friendlyFire: false, suicide: false });
    nextRound.roundId = 'round_2';
    match.events = [original, nextRound];

    const analytics = computeMatchAnalytics(match, '2026-10-16T00:00:00.000Z');
    expect(analytics.players.find((player) => player.playerId === b1)).toMatchObject({
      deathsTraded: 0,
      kastRounds: 12,
    });
    expect(analytics.players.find((player) => player.playerId === b2)?.tradeKills).toBe(0);
  });

  it('assigns one death to only the first of two possible revenge kills', () => {
    const match = syntheticValidMatch();
    const a1 = match.teams[0]!.playerIds[0]!;
    const [b1, b2, b3] = match.teams[1]!.playerIds;
    match.events = [
      event(0, 'PLAYER_DEATH', 1_200, a1, b1!, { friendlyFire: false, suicide: false }),
      event(1, 'PLAYER_DEATH', 1_250, b2!, a1, { friendlyFire: false, suicide: false }),
      event(2, 'PLAYER_DEATH', 1_260, b3!, a1, { friendlyFire: false, suicide: false }),
    ];

    const analytics = computeMatchAnalytics(match, '2026-10-16T00:00:00.000Z');
    expect(analytics.players.find((player) => player.playerId === b1)?.deathsTraded).toBe(1);
    expect(analytics.players.reduce((sum, player) => sum + (player.tradeKills ?? 0), 0)).toBe(1);
    expect(analytics.players.find((player) => player.playerId === b2)?.tradeKills).toBe(1);
    expect(analytics.players.find((player) => player.playerId === b3)?.tradeKills).toBe(0);
  });

  it('does not classify an unknown player team as enemy or friendly', () => {
    const match = syntheticValidMatch();
    const actorId = match.teams[0]!.playerIds[0]!;
    match.events = [
      event(0, 'PLAYER_DEATH', 1_200, actorId, 'unknown-player', { friendlyFire: false, suicide: false }),
      event(1, 'PLAYER_HURT', 1_210, actorId, 'unknown-player', { rawHealthDamage: 25, healthAfter: 75, weapon: 'hegrenade' }),
      event(2, 'PLAYER_BLIND', 1_220, actorId, 'unknown-player', { blindDuration: 2 }),
    ];

    const player = computeMatchAnalytics(match, '2026-10-16T00:00:00.000Z')
      .players.find((candidate) => candidate.playerId === actorId)!;
    expect(player).toMatchObject({ kills: 0, enemyDamage: 0, teamDamage: 0, tradeKills: 0 });
    expect(player.grenades).toMatchObject({
      enemiesFlashed: 0,
      teammatesFlashed: 0,
      heEnemyDamage: 0,
      heTeamDamage: 0,
    });
  });

  it('keeps unsupported parser fields unavailable instead of inventing zeroes', () => {
    const match = syntheticValidMatch();
    const analytics = computeMatchAnalytics(match, '2026-10-16T00:00:00.000Z');
    expect(analytics.availability).toEqual({ damage: 'UNAVAILABLE', flashes: 'UNAVAILABLE', economy: 'UNAVAILABLE', aliveContext: 'UNAVAILABLE' });
    expect(analytics.players[0]?.adr).toBeNull();
    expect(analytics.players[0]?.grenades.smokeEffectiveness).toBeNull();
    expect(analytics.players[0]?.economy.money).toBeNull();
  });

  it('classifies team damage and suicide as errors but ordinary deaths as neutral facts', () => {
    const match = syntheticValidMatch();
    const [a1, a2] = match.teams[0]!.playerIds;
    match.events = [event(0, 'PLAYER_HURT', 1200, a1!, a2!, { rawHealthDamage: 20, healthAfter: 80, weapon: 'hegrenade', friendlyFire: true }), event(1, 'PLAYER_DEATH', 1300, a2!, a2!, { friendlyFire: false, suicide: true })];
    const analytics = computeMatchAnalytics(match, '2026-10-16T00:00:00.000Z');
    expect(analytics.players.find((player) => player.playerId === a1)?.facts.map((fact) => fact.kind)).toContain('TEAM_DAMAGE');
    expect(analytics.players.find((player) => player.playerId === a2)?.facts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'DEATH', category: 'NEUTRAL' }), expect.objectContaining({ kind: 'SUICIDE', category: 'ERROR' })]));
  });

  it('uses parser row order for simultaneous events and never trades backwards in time', () => {
    const match = syntheticValidMatch();
    const a1 = match.teams[0]!.playerIds[0]!; const b1 = match.teams[1]!.playerIds[0]!; const b2 = match.teams[1]!.playerIds[1]!;
    match.events = [event(1, 'PLAYER_DEATH', 1200, a1, b1, { friendlyFire: false, suicide: false }), event(0, 'PLAYER_DEATH', 1200, b2, a1, { friendlyFire: false, suicide: false })];
    const analytics = computeMatchAnalytics(match, '2026-10-16T00:00:00.000Z');
    expect(analytics.players.find((player) => player.playerId === b1)?.deathsTraded).toBe(0);
    expect(analytics.players.find((player) => player.playerId === b2)?.tradeKills).toBe(0);
  });

  it('counts team kills and world deaths without crediting an enemy kill', () => {
    const match = syntheticValidMatch(); const [a1, a2] = match.teams[0]!.playerIds; const b1 = match.teams[1]!.playerIds[0]!;
    match.events = [event(0, 'PLAYER_DEATH', 1200, a1!, a2!, { friendlyFire: true, suicide: false }), event(1, 'PLAYER_DEATH', 1300, null, b1, { friendlyFire: false, suicide: false, weapon: 'world' })];
    const analytics = computeMatchAnalytics(match, '2026-10-16T00:00:00.000Z');
    expect(analytics.players.find((player) => player.playerId === a1)?.teamKills).toBe(1);
    expect(analytics.players.reduce((sum, player) => sum + (player.kills ?? 0), 0)).toBe(0);
    expect(analytics.players.reduce((sum, player) => sum + (player.deaths ?? 0), 0)).toBe(2);
  });

  it('detects a won 1v5 clutch and an exact five-kill round without double counting', () => {
    const match = syntheticValidMatch(); const a = match.teams[0]!.playerIds; const b = match.teams[1]!.playerIds;
    match.events = [
      ...a.slice(1).map((target, index) => event(index, 'PLAYER_DEATH', 1200 + index, b[0]!, target, { friendlyFire: false, suicide: false })),
      ...b.map((target, index) => event(10 + index, 'PLAYER_DEATH', 1300 + index, a[0]!, target, { friendlyFire: false, suicide: false }))
    ];
    const analytics = computeMatchAnalytics(match, '2026-10-16T00:00:00.000Z'); const survivor = analytics.players.find((player) => player.playerId === a[0])!;
    expect(survivor.clutches).toEqual({ '1v5': 1 });
    expect(survivor.multiKills.five).toBe(1);
    expect(survivor.kills).toBe(5);
    expect(survivor.kastRounds).toBe(13);
  });

  it('aggregates flash assists, blind time, utility damage and freeze equipment exactly once', () => {
    const match = syntheticValidMatch(); const [a1, a2] = match.teams[0]!.playerIds; const [b1] = match.teams[1]!.playerIds;
    const flashDeath = event(2, 'PLAYER_DEATH', 1300, a2!, b1!, { friendlyFire: false, suicide: false, assistedFlash: true }); flashDeath.assisterId = a1!;
    match.events = [
      event(0, 'PLAYER_BLIND', 1200, a1!, b1!, { blindDuration: 2.5 }), event(1, 'PLAYER_BLIND', 1210, a1!, a2!, { blindDuration: 1.25 }), flashDeath,
      event(3, 'PLAYER_HURT', 1220, a1!, b1!, { rawHealthDamage: 30, healthAfter: 70, weapon: 'hegrenade' }),
      event(4, 'PLAYER_HURT', 1230, a1!, a2!, { rawHealthDamage: 10, healthAfter: 90, weapon: 'inferno' }),
      event(5, 'ECONOMY_SNAPSHOT', 1100, a1!, null, { equipmentValue: 4200, money: null, inventory: ['ak47'] })
    ];
    const analytics = computeMatchAnalytics(match, '2026-10-16T00:00:00.000Z'); const player = analytics.players.find((item) => item.playerId === a1)!;
    expect(player.assists).toBe(1);
    expect(player.facts.filter((fact) => fact.kind === 'FLASH_ASSIST')).toHaveLength(1);
    expect(player.grenades.enemyBlindSeconds).toBe(2.5); expect(player.grenades.teamBlindSeconds).toBe(1.25);
    expect(player.grenades.heEnemyDamage).toBe(30); expect(player.grenades.infernoTeamDamage).toBe(10);
    expect(player.economy.freezeEquipmentValueTotal).toBe(4200); expect(player.economy.freezeRoundsObserved).toBe(1); expect(player.economy.money).toBeNull();
  });

  it('excludes explicitly pre-freeze and post-round deaths from every live metric', () => {
    const match = syntheticValidMatch(); const a1 = match.teams[0]!.playerIds[0]!; const b1 = match.teams[1]!.playerIds[0]!;
    const before = event(0, 'PLAYER_DEATH_NONLIVE', 1050, a1, b1, { friendlyFire: false, suicide: false }); before.context = { ...before.context!, phase: 'PRE_FREEZE' };
    const after = event(1, 'PLAYER_DEATH_NONLIVE', 1950, a1, b1, { friendlyFire: false, suicide: false }); after.context = { ...after.context!, phase: 'POST_ROUND' };
    match.events = [before, after]; const analytics = computeMatchAnalytics(match, '2026-10-16T00:00:00.000Z');
    expect(analytics.players.reduce((sum, player) => sum + (player.kills ?? 0) + (player.deaths ?? 0) + (player.assists ?? 0), 0)).toBe(0);
    expect(analytics.players.reduce((sum, player) => sum + player.facts.length, 0)).toBe(0);
  });
});
