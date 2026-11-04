import type { MatchAnalytics, MatchData, MatchEvent, PlayerAnalytics } from '@who-ruined/contracts';

export const FEATURE_VERSION = 'm2-0.1.0' as const;
export const TRADE_WINDOW_SECONDS = 5 as const;

type Fact = PlayerAnalytics['facts'][number];
type MutableMetrics = Omit<PlayerAnalytics, 'facts'> & { facts: Fact[] };
type TeamRelation = 'ENEMY' | 'FRIENDLY' | 'UNKNOWN';

function teamRelation(
  teamByPlayer: ReadonlyMap<string, string>,
  actorId: string,
  targetId: string,
): TeamRelation {
  const actorTeam = teamByPlayer.get(actorId);
  const targetTeam = teamByPlayer.get(targetId);
  if (actorTeam === undefined || targetTeam === undefined) return 'UNKNOWN';
  return actorTeam === targetTeam ? 'FRIENDLY' : 'ENEMY';
}

function numberAttr(event: MatchEvent, key: string): number | null {
  const value = event.attrs[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function boolAttr(event: MatchEvent, key: string): boolean | null {
  const value = event.attrs[key];
  return typeof value === 'boolean' ? value : null;
}

function weapon(event: MatchEvent): string | null {
  const value = event.attrs.weapon;
  return typeof value === 'string' ? value : null;
}

function addFact(metrics: MutableMetrics, category: Fact['category'], kind: string, event: MatchEvent, value: number | null = null): void {
  metrics.facts.push({ category, kind, roundId: event.roundId, eventId: event.id, value });
}

function nullableIncrement(value: number | null, amount = 1): number | null {
  return value === null ? null : value + amount;
}

export function computeMatchAnalytics(match: MatchData, generatedAt = new Date().toISOString()): MatchAnalytics {
  const teamByPlayer = new Map(match.players.map((player) => [player.id, player.teamId]));
  const liveEvents = match.events.filter((event) => event.context?.phase === 'LIVE' && event.kind !== 'PLAYER_DEATH_NONLIVE');
  const deaths = liveEvents.filter((event) => event.kind === 'PLAYER_DEATH').sort((a, b) => a.tick - b.tick || a.source.rowIndex - b.source.rowIndex);
  const hurts = liveEvents.filter((event) => event.kind === 'PLAYER_HURT').sort((a, b) => a.tick - b.tick || a.source.rowIndex - b.source.rowIndex);
  const blinds = liveEvents.filter((event) => event.kind === 'PLAYER_BLIND');
  const economyEvents = match.events.filter((event) => event.kind === 'ECONOMY_SNAPSHOT');
  const damageAvailability = hurts.length === 0 ? 'UNAVAILABLE' : hurts.every((event) => numberAttr(event, 'rawHealthDamage') !== null) ? 'AVAILABLE' : 'PARTIAL';
  const flashAvailability = blinds.length === 0 ? 'UNAVAILABLE' : blinds.every((event) => numberAttr(event, 'blindDuration') !== null) ? 'AVAILABLE' : 'PARTIAL';
  const economyAvailability = economyEvents.length === 0 ? 'UNAVAILABLE' : economyEvents.every((event) => numberAttr(event, 'equipmentValue') !== null) ? 'AVAILABLE' : 'PARTIAL';
  const aliveAvailability = deaths.length === 0 ? 'UNAVAILABLE' : deaths.every((event) => event.context?.aliveByTeamId !== null && event.context?.aliveByTeamId !== undefined) ? 'AVAILABLE' : 'PARTIAL';
  const damageKnown = damageAvailability !== 'UNAVAILABLE';
  const flashKnown = flashAvailability !== 'UNAVAILABLE';

  const metrics = new Map<string, MutableMetrics>(match.players.map((player) => [player.id, {
    playerId: player.id, teamId: player.teamId, roundsPlayed: match.rounds.length,
    kills: 0, deaths: 0, assists: 0, kdaRatio: null,
    enemyDamage: damageKnown ? 0 : null, teamDamage: damageKnown ? 0 : null, adr: null,
    kastRounds: 0, kastPercent: null, survivedRounds: 0,
    openingKills: 0, openingDeaths: 0, tradeKills: 0, deathsTraded: 0, untradedDeaths: 0, tradeParticipation: 0,
    multiKills: { two: 0, three: 0, four: 0, five: 0 }, clutches: {}, killsWithAdvantage: aliveAvailability === 'UNAVAILABLE' ? null : 0, killsAtDisadvantage: aliveAvailability === 'UNAVAILABLE' ? null : 0,
    teamKills: 0, suicides: 0, bomb: { plants: 0, defuses: 0, explosions: 0 },
    grenades: {
      flashesThrown: 0, enemiesFlashed: flashKnown ? 0 : null, teammatesFlashed: flashKnown ? 0 : null, enemyBlindSeconds: flashKnown ? 0 : null, teamBlindSeconds: flashKnown ? 0 : null,
      heThrown: 0, heEnemyDamage: damageKnown ? 0 : null, heTeamDamage: damageKnown ? 0 : null,
      infernosStarted: 0, infernoEnemyDamage: damageKnown ? 0 : null, infernoTeamDamage: damageKnown ? 0 : null,
      smokesThrown: 0, smokeEffectiveness: null
    },
    economy: { availability: economyAvailability, freezeEquipmentValueTotal: economyAvailability === 'UNAVAILABLE' ? null : 0, freezeRoundsObserved: economyAvailability === 'UNAVAILABLE' ? null : 0, money: null },
    facts: []
  }]));

  const enemyDeath = (event: MatchEvent): boolean => event.actorId !== null
    && event.targetId !== null
    && event.actorId !== event.targetId
    && teamRelation(teamByPlayer, event.actorId, event.targetId) === 'ENEMY';
  const usedTradeKills = new Set<string>();
  const tradedDeaths = new Set<string>();
  const tickRate = match.tickRate;
  if (tickRate !== null) {
    for (const original of deaths.filter(enemyDeath)) {
      const revenge = deaths.find((candidate) => candidate.roundId === original.roundId
        && !usedTradeKills.has(candidate.id)
        && enemyDeath(candidate)
        && (candidate.tick > original.tick || candidate.tick === original.tick && candidate.source.rowIndex > original.source.rowIndex)
        && (candidate.tick - original.tick) / tickRate <= TRADE_WINDOW_SECONDS
        && candidate.actorId !== null
        && candidate.targetId === original.actorId
        && original.targetId !== null
        && teamRelation(teamByPlayer, candidate.actorId, original.targetId) === 'FRIENDLY');
      if (!revenge) continue;
      usedTradeKills.add(revenge.id); tradedDeaths.add(original.id);
    }
  }

  const killsByRoundPlayer = new Map<string, number>();
  const kastByRoundPlayer = new Set<string>();
  const deadByRoundPlayer = new Set<string>();
  for (const event of deaths) {
    const actor = event.actorId ? metrics.get(event.actorId) : undefined;
    const target = event.targetId ? metrics.get(event.targetId) : undefined;
    if (target) { target.deaths = nullableIncrement(target.deaths); deadByRoundPlayer.add(`${event.roundId}:${target.playerId}`); addFact(target, 'NEUTRAL', 'DEATH', event); }
    if (boolAttr(event, 'suicide') === true && actor) { actor.suicides = nullableIncrement(actor.suicides); addFact(actor, 'ERROR', 'SUICIDE', event); }
    else if (boolAttr(event, 'friendlyFire') === true && actor) { actor.teamKills = nullableIncrement(actor.teamKills); addFact(actor, 'ERROR', 'TEAM_KILL', event); }
    else if (enemyDeath(event) && actor) {
      actor.kills = nullableIncrement(actor.kills); kastByRoundPlayer.add(`${event.roundId}:${actor.playerId}`); addFact(actor, 'POSITIVE_CONTRIBUTION', 'KILL', event);
      const key = `${event.roundId}:${actor.playerId}`; killsByRoundPlayer.set(key, (killsByRoundPlayer.get(key) ?? 0) + 1);
      const ownAlive = event.context?.aliveByTeamId?.[actor.teamId];
      const enemyTeam = match.teams.find((team) => team.id !== actor.teamId)?.id;
      const enemyAlive = enemyTeam ? event.context?.aliveByTeamId?.[enemyTeam] : undefined;
      if (ownAlive !== undefined && enemyAlive !== undefined) {
        if (ownAlive > enemyAlive) actor.killsWithAdvantage = nullableIncrement(actor.killsWithAdvantage);
        if (ownAlive < enemyAlive) actor.killsAtDisadvantage = nullableIncrement(actor.killsAtDisadvantage);
      }
    }
    if (event.assisterId) {
      const assister = metrics.get(event.assisterId);
      if (assister) { assister.assists = nullableIncrement(assister.assists); kastByRoundPlayer.add(`${event.roundId}:${assister.playerId}`); addFact(assister, 'POSITIVE_CONTRIBUTION', boolAttr(event, 'assistedFlash') ? 'FLASH_ASSIST' : 'ASSIST', event); }
    }
    if (usedTradeKills.has(event.id) && actor) { actor.tradeKills = nullableIncrement(actor.tradeKills); addFact(actor, 'POSITIVE_CONTRIBUTION', 'TRADE_KILL', event); }
    if (tradedDeaths.has(event.id) && target) { target.deathsTraded = nullableIncrement(target.deathsTraded); kastByRoundPlayer.add(`${event.roundId}:${target.playerId}`); }
  }

  for (const round of match.rounds) {
    const opening = deaths.find((event) => event.roundId === round.id && enemyDeath(event));
    if (opening?.actorId) metrics.get(opening.actorId)!.openingKills = nullableIncrement(metrics.get(opening.actorId)!.openingKills);
    if (opening?.targetId) metrics.get(opening.targetId)!.openingDeaths = nullableIncrement(metrics.get(opening.targetId)!.openingDeaths);
    for (const player of match.players) {
      if (!deadByRoundPlayer.has(`${round.id}:${player.id}`)) {
        const current = metrics.get(player.id)!; current.survivedRounds = nullableIncrement(current.survivedRounds); kastByRoundPlayer.add(`${round.id}:${player.id}`);
      }
    }
    const alive = new Map(match.teams.map((team) => [team.id, new Set(team.playerIds)]));
    const clutchCandidate = new Map<string, number>();
    for (const death of deaths.filter((event) => event.roundId === round.id)) {
      if (death.targetId) alive.get(teamByPlayer.get(death.targetId) ?? '')?.delete(death.targetId);
      for (const team of match.teams) {
        const survivors = alive.get(team.id);
        const enemy = match.teams.find((candidate) => candidate.id !== team.id);
        const enemyCount = enemy ? alive.get(enemy.id)?.size ?? 0 : 0;
        if (survivors?.size === 1 && enemyCount > 0) clutchCandidate.set([...survivors][0]!, Math.max(clutchCandidate.get([...survivors][0]!) ?? 0, enemyCount));
      }
    }
    for (const [playerId, opponents] of clutchCandidate) {
      if (round.winnerTeamId === teamByPlayer.get(playerId) && alive.get(teamByPlayer.get(playerId) ?? '')?.has(playerId)) {
        const current = metrics.get(playerId)!; const key = `1v${opponents}`; current.clutches[key] = (current.clutches[key] ?? 0) + 1;
      }
    }
  }

  const hpByRoundPlayer = new Map<string, number>();
  for (const event of hurts) {
    if (!event.targetId) continue;
    const raw = numberAttr(event, 'rawHealthDamage');
    if (raw === null) continue;
    const hpKey = `${event.roundId}:${event.targetId}`;
    const previousHp = hpByRoundPlayer.get(hpKey) ?? 100;
    const actual = Math.max(0, Math.min(raw, previousHp));
    const after = numberAttr(event, 'healthAfter'); hpByRoundPlayer.set(hpKey, after === null ? previousHp - actual : Math.max(0, after));
    if (!event.actorId || event.actorId === event.targetId) continue;
    const current = metrics.get(event.actorId); if (!current) continue;
    const relation = teamRelation(teamByPlayer, event.actorId, event.targetId);
    if (relation === 'FRIENDLY') { current.teamDamage = current.teamDamage === null ? null : current.teamDamage + actual; addFact(current, 'ERROR', 'TEAM_DAMAGE', event, actual); }
    if (relation === 'ENEMY') { current.enemyDamage = current.enemyDamage === null ? null : current.enemyDamage + actual; }
    if (weapon(event) === 'hegrenade') {
      if (relation === 'FRIENDLY') current.grenades.heTeamDamage = current.grenades.heTeamDamage === null ? null : current.grenades.heTeamDamage + actual;
      if (relation === 'ENEMY') current.grenades.heEnemyDamage = current.grenades.heEnemyDamage === null ? null : current.grenades.heEnemyDamage + actual;
    }
    if (weapon(event) === 'inferno') {
      if (relation === 'FRIENDLY') current.grenades.infernoTeamDamage = current.grenades.infernoTeamDamage === null ? null : current.grenades.infernoTeamDamage + actual;
      if (relation === 'ENEMY') current.grenades.infernoEnemyDamage = current.grenades.infernoEnemyDamage === null ? null : current.grenades.infernoEnemyDamage + actual;
    }
  }

  for (const event of liveEvents) {
    const current = event.actorId ? metrics.get(event.actorId) : undefined;
    if (!current) continue;
    if (event.kind === 'FLASH_DETONATE') current.grenades.flashesThrown = nullableIncrement(current.grenades.flashesThrown);
    if (event.kind === 'HE_DETONATE') current.grenades.heThrown = nullableIncrement(current.grenades.heThrown);
    if (event.kind === 'INFERNO_START') current.grenades.infernosStarted = nullableIncrement(current.grenades.infernosStarted);
    if (event.kind === 'SMOKE_DETONATE') current.grenades.smokesThrown = nullableIncrement(current.grenades.smokesThrown);
    if (event.kind === 'BOMB_PLANTED') { current.bomb.plants = nullableIncrement(current.bomb.plants); addFact(current, 'POSITIVE_CONTRIBUTION', 'BOMB_PLANT', event); }
    if (event.kind === 'BOMB_DEFUSED') { current.bomb.defuses = nullableIncrement(current.bomb.defuses); addFact(current, 'POSITIVE_CONTRIBUTION', 'BOMB_DEFUSE', event); }
    if (event.kind === 'BOMB_EXPLODED') current.bomb.explosions = nullableIncrement(current.bomb.explosions);
  }
  for (const event of blinds) {
    if (!event.actorId || !event.targetId || event.actorId === event.targetId) continue;
    const current = metrics.get(event.actorId); if (!current) continue;
    const duration = numberAttr(event, 'blindDuration');
    const relation = teamRelation(teamByPlayer, event.actorId, event.targetId);
    if (relation === 'FRIENDLY') {
      current.grenades.teammatesFlashed = nullableIncrement(current.grenades.teammatesFlashed);
      if (duration !== null && current.grenades.teamBlindSeconds !== null) current.grenades.teamBlindSeconds += duration;
      addFact(current, 'ERROR', 'TEAM_FLASH', event, duration);
    } else if (relation === 'ENEMY') {
      current.grenades.enemiesFlashed = nullableIncrement(current.grenades.enemiesFlashed);
      if (duration !== null && current.grenades.enemyBlindSeconds !== null) current.grenades.enemyBlindSeconds += duration;
    }
  }
  const economyRounds = new Map<string, Set<string>>();
  for (const event of economyEvents) {
    if (!event.actorId) continue;
    const current = metrics.get(event.actorId); const value = numberAttr(event, 'equipmentValue');
    if (!current || value === null || current.economy.freezeEquipmentValueTotal === null) continue;
    current.economy.freezeEquipmentValueTotal += value;
    const seen = economyRounds.get(event.actorId) ?? new Set<string>(); seen.add(event.roundId); economyRounds.set(event.actorId, seen);
  }

  for (const current of metrics.values()) {
    current.untradedDeaths = current.deaths === null || current.deathsTraded === null ? null : current.deaths - current.deathsTraded;
    current.tradeParticipation = current.tradeKills === null || current.deathsTraded === null ? null : current.tradeKills + current.deathsTraded;
    current.kastRounds = [...kastByRoundPlayer].filter((key) => key.endsWith(`:${current.playerId}`)).length;
    current.kastPercent = current.roundsPlayed > 0 ? current.kastRounds / current.roundsPlayed * 100 : null;
    current.adr = current.enemyDamage === null || current.roundsPlayed === 0 ? null : current.enemyDamage / current.roundsPlayed;
    current.kdaRatio = current.deaths && current.kills !== null && current.assists !== null ? (current.kills + current.assists) / current.deaths : null;
    current.economy.freezeRoundsObserved = current.economy.freezeRoundsObserved === null ? null : economyRounds.get(current.playerId)?.size ?? 0;
    for (const round of match.rounds) {
      const count = killsByRoundPlayer.get(`${round.id}:${current.playerId}`) ?? 0;
      if (count === 2) current.multiKills.two += 1; else if (count === 3) current.multiKills.three += 1; else if (count === 4) current.multiKills.four += 1; else if (count >= 5) current.multiKills.five += 1;
    }
  }

  return {
    schemaVersion: 'm2-1', featureVersion: FEATURE_VERSION, matchId: match.matchId, generatedAt, tradeWindowSeconds: TRADE_WINDOW_SECONDS,
    availability: { damage: damageAvailability, flashes: flashAvailability, economy: economyAvailability, aliveContext: aliveAvailability },
    players: [...metrics.values()],
    limitations: [
      'Обычная смерть является фактом, но не тактической ошибкой.',
      'Cash недоступен в demoparser2 0.42.0; money остаётся null.',
      'Molotov и Incendiary объединены как inferno: надёжного различения нет.',
      'Эффективность smoke без пространственной модели недоступна.',
      'Trade — детерминированное one-to-one событие в окне 5 секунд, не вывод о намерении.'
    ]
  };
}
