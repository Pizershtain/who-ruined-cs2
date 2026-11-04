import { createHash } from 'node:crypto';
import type { MatchData, MatchEvent, MatchRound, Quality, Side } from '@who-ruined/contracts';
import type {
  NormalizationEventInput,
  NormalizationInput,
  NormalizationTickInput,
} from './normalization-input.js';

export {
  assertMatchRelations,
  MatchRelationError,
  type MatchRelationIssue,
} from '@who-ruined/contracts';

export type {
  NormalizationEventInput,
  NormalizationInput,
  NormalizationPlayerInput,
  NormalizationTickInput,
  NormalizeInput,
} from './normalization-input.js';

export type MatchId = string & { readonly __matchId: unique symbol };
export type TeamId = string & { readonly __teamId: unique symbol };
export type PlayerId = string & { readonly __playerId: unique symbol };
export type RoundId = string & { readonly __roundId: unique symbol };
export type EventId = string & { readonly __eventId: unique symbol };

export function stableTeamId(playerIds: readonly string[]): TeamId {
  const roster = [...playerIds].sort().join('\n');
  return `team_${createHash('sha256').update(roster).digest('hex').slice(0, 16)}` as TeamId;
}

export function eventId(roundOrdinal: number, eventName: string, parserRowIndex: number): EventId {
  return `${roundOrdinal}:${eventName}:${parserRowIndex}` as EventId;
}

export interface ValidationResult { quality: Quality; issues: Array<{ code: string; message: string; roundOrdinal?: number }>; validRoundCount: number }

export function validateMatch(match: MatchData): ValidationResult {
  const issues: ValidationResult['issues'] = [];
  if (match.teams.length !== 2) issues.push({ code: 'TEAM_COUNT', message: 'Требуются ровно две стабильные команды.' });
  const playerIds = new Set(match.players.map((player) => player.id));
  if (playerIds.size !== match.players.length) issues.push({ code: 'DUPLICATE_PLAYER', message: 'Идентификаторы игроков не уникальны.' });
  for (const team of match.teams) {
    if (team.playerIds.length !== 5 || new Set(team.playerIds).size !== 5) issues.push({ code: 'ROSTER_NOT_5V5', message: `Состав ${team.id} не содержит пять уникальных игроков.` });
  }
  let priorEnd = -1;
  let expectedOrdinal = 1;
  for (const round of [...match.rounds].sort((a, b) => a.ordinal - b.ordinal)) {
    validateRound(round, priorEnd, expectedOrdinal, issues);
    priorEnd = Math.max(priorEnd, round.endTick);
    expectedOrdinal += 1;
  }
  const deathsByRoundPlayer = new Set<string>();
  for (const event of match.events.filter((item) => item.kind === 'PLAYER_DEATH')) {
    if (!event.targetId) {
      issues.push({ code: 'DEATH_VICTIM_MISSING', message: 'Событие смерти не привязано к игроку.' });
      continue;
    }
    const key = `${event.roundId}:${event.targetId}`;
    if (deathsByRoundPlayer.has(key)) issues.push({ code: 'DUPLICATE_ROUND_DEATH', message: 'Игрок умер более одного раза в раунде без поддержки respawn.' });
    deathsByRoundPlayer.add(key);
  }
  const validRoundCount = match.rounds.filter((round) => round.isValid && !issues.some((issue) => issue.roundOrdinal === round.ordinal)).length;
  const ratio = match.rounds.length === 0 ? 0 : validRoundCount / match.rounds.length;
  const quality: Quality = issues.length === 0 && validRoundCount >= 8 && ratio >= 0.9 ? 'VALID' : 'PARTIAL';
  return { quality, issues, validRoundCount };
}

function validateRound(round: MatchRound, priorEnd: number, expectedOrdinal: number, issues: ValidationResult['issues']): void {
  const add = (code: string, message: string): void => { issues.push({ code, message, roundOrdinal: round.ordinal }); };
  if (round.ordinal !== expectedOrdinal) add('ROUND_ORDINAL', 'Нарушена непрерывная нумерация раундов.');
  if (round.startTick <= priorEnd) add('ROUND_OVERLAP', 'Интервалы раундов пересекаются.');
  if (round.startTick > round.endTick) add('ROUND_INTERVAL', 'Начало раунда позже конца.');
  if (round.freezeEndTick !== null && (round.freezeEndTick < round.startTick || round.freezeEndTick > round.endTick)) add('FREEZE_INTERVAL', 'Некорректная граница freeze time.');
  if (!round.winnerTeamId || !round.winnerSide) add('ROUND_WINNER_MISSING', 'Победитель раунда не подтверждён.');
  if (round.winnerTeamId) {
    const teams = Object.keys(round.scoreBefore).sort();
    if (teams.length !== 2 || Object.keys(round.scoreAfter).sort().join('|') !== teams.join('|')) add('SCORE_TEAMS', 'Счёт не привязан к двум стабильным командам.');
    for (const teamId of teams) {
      const delta = (round.scoreAfter[teamId] ?? -1) - (round.scoreBefore[teamId] ?? -1);
      if (delta !== (teamId === round.winnerTeamId ? 1 : 0)) add('SCORE_MISMATCH', 'Переход счёта не соответствует победителю раунда.');
    }
    if (round.sideByTeamId[round.winnerTeamId] !== round.winnerSide) add('SIDE_WINNER_MISMATCH', 'Сторона победителя не соответствует стабильной команде.');
  }
}

function uniqueTicks(events: NormalizationEventInput[]): number[] {
  return [...new Set(events.map((event) => event.tick).filter((tick): tick is number => tick !== null))].sort((a, b) => a - b);
}

interface TeamTickState { sideByTeamId: Record<string, Side>; scoreByTeamId: Record<string, number>; issues: string[] }

function readTeamTickState(tick: number, tickRows: NormalizationTickInput[], teams: MatchData['teams'], playerToTeam: Map<string, string>): TeamTickState {
  const rows = tickRows.filter((row) => row.tick === tick);
  const sideValues = new Map<string, Set<Side>>();
  const scoreValues = new Map<string, Set<number>>();
  const members = new Map<string, Set<string>>();
  for (const row of rows) {
    const playerId = row.playerId;
    const teamId = playerId ? playerToTeam.get(playerId) : undefined;
    if (!teamId || !playerId) continue;
    const sideNumber = row.sideNumber;
    const score = row.teamScore;
    const side = sideNumber === 2 ? 'T' : sideNumber === 3 ? 'CT' : null;
    if (side) { const values = sideValues.get(teamId) ?? new Set<Side>(); values.add(side); sideValues.set(teamId, values); }
    if (score !== null) { const values = scoreValues.get(teamId) ?? new Set<number>(); values.add(score); scoreValues.set(teamId, values); }
    const playerIds = members.get(teamId) ?? new Set<string>(); playerIds.add(playerId); members.set(teamId, playerIds);
  }
  const issues: string[] = [];
  const sideByTeamId: Record<string, Side> = {};
  const scoreByTeamId: Record<string, number> = {};
  for (const team of teams) {
    const teamSides = sideValues.get(team.id) ?? new Set<Side>();
    const teamScores = scoreValues.get(team.id) ?? new Set<number>();
    if ((members.get(team.id)?.size ?? 0) !== 5) issues.push('TICK_ROSTER_NOT_5');
    if (teamSides.size !== 1) issues.push('SIDE_MAPPING_MISSING'); else sideByTeamId[team.id] = [...teamSides][0] as Side;
    if (teamScores.size !== 1) issues.push('TEAM_SCORE_MISSING'); else scoreByTeamId[team.id] = [...teamScores][0] as number;
  }
  if (new Set(Object.values(sideByTeamId)).size !== 2) issues.push('SIDES_NOT_OPPOSED');
  return { sideByTeamId, scoreByTeamId, issues: [...new Set(issues)] };
}

export function isSteamId64(value: string | null): value is string {
  return value !== null && /^7656119\d{10}$/.test(value);
}

export function deriveTickRate(tickRows: NormalizationTickInput[]): number | null {
  const samples = [...new Map(tickRows.flatMap((row) => {
    return row.tick !== null && row.gameTime !== null ? [[row.tick, row.gameTime] as const] : [];
  })).entries()].sort(([a], [b]) => a - b);
  const first = samples[0]; const last = samples.at(-1);
  if (!first || !last || first[0] === last[0] || first[1] === last[1]) return null;
  const rate = (last[0] - first[0]) / (last[1] - first[1]);
  const rounded = Math.round(rate);
  return Number.isFinite(rate) && rounded > 0 && Math.abs(rate - rounded) < 0.001 ? rounded : null;
}

export function isCreditedAssist(assisterId: string | null, targetId: string | null, playerToTeam: ReadonlyMap<string, string>): boolean {
  return assisterId !== null && targetId !== null && playerToTeam.get(assisterId) !== undefined && playerToTeam.get(assisterId) !== playerToTeam.get(targetId);
}

export function normalizeSnapshot(input: NormalizationInput): MatchData {
  const issues: MatchData['qualityIssues'] = [];
  const playerCandidates = input.players.map((player, index) => {
    const candidateSteamId = player.candidateSteamId;
    const steamId = isSteamId64(candidateSteamId) ? candidateSteamId : null;
    return { id: steamId ?? `anon_${index + 1}`, steamId, displayName: player.displayName ?? `Игрок ${index + 1}`, sideNumber: player.initialSideNumber };
  });
  const parsedPlayers = [...new Map(playerCandidates.map((player) => [player.id, player])).values()];
  const groups = new Map<number, typeof parsedPlayers>();
  for (const player of parsedPlayers) {
    if (player.sideNumber === null) continue;
    const group = groups.get(player.sideNumber) ?? [];
    group.push(player); groups.set(player.sideNumber, group);
  }
  const rosterGroups = [...groups.entries()].filter(([, players]) => players.length === 5).sort(([a], [b]) => a - b);
  if (rosterGroups.length !== 2 || parsedPlayers.length !== 10) issues.push({ code: 'ROSTER_UNVERIFIED', message: 'Парсер не подтвердил два стабильных состава 5×5.' });
  const teams = rosterGroups.map(([, roster], index) => ({ id: stableTeamId(roster.map((p) => p.id)), playerIds: roster.map((p) => p.id).sort(), label: `Команда ${index + 1}` }));
  const playerToTeam = new Map(teams.flatMap((team) => team.playerIds.map((playerId) => [playerId, team.id] as const)));
  if (parsedPlayers.some((player) => player.steamId === null)) issues.push({ code: 'PLAYER_IDENTITY_UNVERIFIED', message: 'Не для всех игроков подтверждён SteamID64.' });
  const scoreboardByPlayer = new Map(parsedPlayers.map((player) => [player.id, { kills: 0, deaths: 0, assists: 0, teamKills: 0, source: 'PARSED_DEATH_EVENTS_SCOREBOARD_PHASES' as const }]));
  const adjustScoreboard = (event: NormalizationEventInput, delta: 1 | -1): void => {
    const actorId = event.attackerPlayerId; const targetId = event.subjectPlayerId; const assisterId = event.assisterPlayerId;
    const actor = actorId ? scoreboardByPlayer.get(actorId) : undefined; const target = targetId ? scoreboardByPlayer.get(targetId) : undefined; const assister = assisterId ? scoreboardByPlayer.get(assisterId) : undefined;
    if (target) target.deaths += delta;
    if (actor && targetId && actorId !== targetId) {
      if (playerToTeam.get(actorId ?? '') === playerToTeam.get(targetId)) actor.teamKills += delta; else actor.kills += delta;
    }
    if (assister && isCreditedAssist(assisterId, targetId, playerToTeam)) assister.assists += delta;
  };
  for (const event of input.events) {
    if (event.name !== 'player_death') continue;
    adjustScoreboard(event, 1);
  }
  const players = parsedPlayers.filter((player) => playerToTeam.has(player.id)).map((player) => ({
    id: player.id, steamId: player.steamId, displayName: player.displayName, teamId: playerToTeam.get(player.id) ?? '',
    scoreboard: scoreboardByPlayer.get(player.id) ?? { kills: 0, deaths: 0, assists: 0, teamKills: 0, source: 'PARSED_DEATH_EVENTS_SCOREBOARD_PHASES' as const }
  }));
  const byKind = (name: string): NormalizationEventInput[] => input.events.filter((event) => event.name === name);
  const explicitStarts = uniqueTicks([...byKind('round_prestart'), ...byKind('round_start')]);
  const freezes = uniqueTicks(byKind('round_freeze_end'));
  const legacyEnds = uniqueTicks(byKind('round_end'));
  const officialEnds = uniqueTicks(byKind('round_officially_ended'));
  const matchEnds = uniqueTicks(byKind('cs_win_panel_match'));
  const ends = officialEnds.length > 0 ? [...officialEnds] : [...legacyEnds];
  const lastFreeze = freezes.at(-1);
  const finalMatchEnd = matchEnds.find((tick) => lastFreeze !== undefined && tick > lastFreeze);
  if (finalMatchEnd !== undefined && !ends.some((tick) => tick >= finalMatchEnd) && ends.length < freezes.length) ends.push(finalMatchEnd);
  ends.sort((a, b) => a - b);
  const rounds: MatchRound[] = [];
  const priorScore = Object.fromEntries(teams.map((team) => [team.id, 0]));
  for (let index = 0; index < freezes.length; index += 1) {
    const freezeTick = freezes[index]; if (freezeTick === undefined) continue;
    const nextFreeze = freezes[index + 1] ?? Number.POSITIVE_INFINITY;
    const endTick = ends.find((tick) => tick >= freezeTick && tick < nextFreeze);
    if (endTick === undefined) {
      issues.push({ code: 'ROUND_END_MISSING', message: 'Для live-раунда не найден подтверждённый конец.', roundOrdinal: index + 1 });
      continue;
    }
    const ordinal = index + 1;
    const priorEnd = rounds.at(-1)?.endTick ?? -1;
    const phaseStart = [...explicitStarts].reverse().find((tick) => tick <= freezeTick && tick >= priorEnd);
    const startTick = Math.max(phaseStart ?? freezeTick, priorEnd + 1);
    const beforeState = readTeamTickState(freezeTick, input.ticks, teams, playerToTeam);
    const afterState = readTeamTickState(endTick, input.ticks, teams, playerToTeam);
    const scoreAfter = { ...afterState.scoreByTeamId };
    const winners = teams.filter((team) => (scoreAfter[team.id] ?? -1) - (priorScore[team.id] ?? -1) === 1 && teams.every((other) => other.id === team.id || (scoreAfter[other.id] ?? -1) === (priorScore[other.id] ?? -1)));
    const winnerTeamId = winners.length === 1 ? winners[0]?.id ?? null : null;
    const winnerSide = winnerTeamId ? beforeState.sideByTeamId[winnerTeamId] ?? null : null;
    const roundIssues: string[] = [];
    if (phaseStart === undefined) roundIssues.push('ROUND_START_MISSING');
    roundIssues.push(...beforeState.issues, ...afterState.issues);
    if (teams.some((team) => beforeState.scoreByTeamId[team.id] !== priorScore[team.id])) roundIssues.push('SCORE_BEFORE_MISMATCH');
    const sidesStay = teams.every((team) => beforeState.sideByTeamId[team.id] === afterState.sideByTeamId[team.id]);
    const sidesSwapAtBoundary = teams.every((team) => beforeState.sideByTeamId[team.id] !== afterState.sideByTeamId[team.id]);
    if (!sidesStay && !sidesSwapAtBoundary) roundIssues.push('SIDE_MAPPING_INCONSISTENT_AT_BOUNDARY');
    if (!winnerTeamId) roundIssues.push('WINNER_TEAM_MISSING');
    const scoreChanged = teams.length === 2 && teams.every((team) => (scoreAfter[team.id] ?? 0) - (priorScore[team.id] ?? 0) === (team.id === winnerTeamId ? 1 : 0));
    if (!scoreChanged) roundIssues.push('SCORE_TRANSITION_UNVERIFIED');
    const uniqueRoundIssues = [...new Set(roundIssues)];
    rounds.push({ id: `round_${ordinal}`, ordinal, startTick, freezeEndTick: freezeTick, endTick, winnerTeamId, winnerSide, sideByTeamId: beforeState.sideByTeamId, scoreBefore: { ...priorScore }, scoreAfter: { ...scoreAfter }, isOvertime: Object.values(priorScore).reduce((sum, score) => sum + score, 0) >= 24, isValid: uniqueRoundIssues.length === 0, issues: uniqueRoundIssues });
    for (const team of teams) priorScore[team.id] = scoreAfter[team.id] ?? priorScore[team.id] ?? 0;
  }
  if (rounds.length === 0) issues.push({ code: 'ROUNDS_MISSING', message: 'Не удалось восстановить игровые раунды.' });
  if (rounds.length !== freezes.length) issues.push({ code: 'ROUND_COVERAGE', message: `Восстановлено ${rounds.length} из ${freezes.length} live-раундов.` });
  const normalizedEvents: MatchEvent[] = [];
  let unassignedDeaths = 0;
  const tickRate = deriveTickRate(input.ticks);
  const factualKinds: Record<string, string> = {
    player_death: 'PLAYER_DEATH', player_hurt: 'PLAYER_HURT', player_blind: 'PLAYER_BLIND',
    bomb_beginplant: 'BOMB_BEGIN_PLANT', bomb_begindefuse: 'BOMB_BEGIN_DEFUSE', bomb_planted: 'BOMB_PLANTED', bomb_defused: 'BOMB_DEFUSED', bomb_exploded: 'BOMB_EXPLODED',
    flashbang_detonate: 'FLASH_DETONATE', hegrenade_detonate: 'HE_DETONATE', smokegrenade_detonate: 'SMOKE_DETONATE', inferno_startburn: 'INFERNO_START', inferno_expire: 'INFERNO_EXPIRE'
  };
  const orderedEvents = [...input.events].sort((left, right) =>
    (left.tick ?? Number.MAX_SAFE_INTEGER) - (right.tick ?? Number.MAX_SAFE_INTEGER)
    || left.sourceRowIndex - right.sourceRowIndex
  );
  const terminalByRound = new Map<string, { tick: number; rowIndex: number; type: 'OBJECTIVE' | 'ELIMINATION' }>();
  for (const round of rounds) {
    const freezeTick = round.freezeEndTick ?? round.startTick;
    const objectiveCandidates = orderedEvents.filter((event) =>
      event.tick !== null
      && event.tick >= freezeTick
      && event.tick <= round.endTick
      && (event.name === 'bomb_defused' || event.name === 'bomb_exploded')
    ).map((event) => ({ event, terminalType: 'OBJECTIVE' as const }));
    const candidates: Array<{ event: NormalizationEventInput; terminalType: 'OBJECTIVE' | 'ELIMINATION' }> = [...objectiveCandidates];
    const alive = new Map(teams.map((team) => [team.id, new Set(team.playerIds)]));
    for (const event of orderedEvents) {
      const tick = event.tick;
      if (tick === null || tick < freezeTick || tick > round.endTick || event.name !== 'player_death') continue;
      const targetId = event.subjectPlayerId; const teamId = targetId ? playerToTeam.get(targetId) : undefined;
      if (targetId && teamId) alive.get(teamId)?.delete(targetId);
      if ([...alive.values()].some((playersAlive) => playersAlive.size === 0)) {
        if (objectiveCandidates.length === 0) candidates.push({ event, terminalType: 'ELIMINATION' });
        break;
      }
    }
    candidates.sort((left, right) =>
      (left.event.tick ?? 0) - (right.event.tick ?? 0)
      || left.event.sourceRowIndex - right.event.sourceRowIndex
    );
    const terminal = candidates[0]; const terminalTick = terminal?.event.tick ?? null;
    if (terminal && terminalTick !== null) terminalByRound.set(round.id, { tick: terminalTick, rowIndex: terminal.event.sourceRowIndex, type: terminal.terminalType });
  }
  const bombStateByRound = new Map<string, 'NOT_PLANTED'|'PLANTED'|'DEFUSED'|'EXPLODED'>();
  const seenLiveDeathKeys = new Set<string>();
  for (const event of orderedEvents) {
    const parserRowIndex = event.sourceRowIndex;
    const eventName = event.name;
    if (!eventName || !factualKinds[eventName]) continue;
    const tick = event.tick;
    if (tick === null) { if (eventName === 'player_death') unassignedDeaths += 1; continue; }
    const candidateLiveRound = rounds.find((candidate) => tick >= (candidate.freezeEndTick ?? candidate.startTick) && tick <= candidate.endTick);
    const terminal = candidateLiveRound ? terminalByRound.get(candidateLiveRound.id) : undefined;
    const afterTerminalPosition = terminal ? tick > terminal.tick || tick === terminal.tick && parserRowIndex > terminal.rowIndex : false;
    const rawActorForPhase = event.attackerPlayerId; const rawTargetForPhase = event.subjectPlayerId;
    const afterEliminationSuicide = eventName === 'player_death' && (rawActorForPhase === rawTargetForPhase || rawActorForPhase === null);
    const deathKey = candidateLiveRound && rawTargetForPhase ? `${candidateLiveRound.id}:${rawTargetForPhase}` : null;
    const duplicateRoundDeath = deathKey !== null && seenLiveDeathKeys.has(deathKey);
    const deathWeapon = event.weapon;
    const sameTickObjectiveSuicide = terminal?.type === 'OBJECTIVE' && tick === terminal.tick && afterEliminationSuicide && deathWeapon === 'planted_c4';
    const postEliminationWorldDeath = terminal?.type === 'ELIMINATION' && afterTerminalPosition && afterEliminationSuicide && deathWeapon === 'world';
    const afterTerminal = terminal !== undefined && afterTerminalPosition && afterEliminationSuicide && (duplicateRoundDeath || sameTickObjectiveSuicide || postEliminationWorldDeath);
    const liveRound = afterTerminal ? undefined : candidateLiveRound;
    if (eventName === 'player_death' && liveRound && deathKey) seenLiveDeathKeys.add(deathKey);
    const intervalRound = rounds.find((candidate) => tick >= candidate.startTick && tick <= candidate.endTick);
    const priorRound = [...rounds].reverse().find((candidate) => candidate.endTick < tick);
    const nextRound = priorRound ? rounds.find((candidate) => candidate.ordinal === priorRound.ordinal + 1) : undefined;
    const postRound = priorRound && (!nextRound || tick < nextRound.startTick) ? priorRound : undefined;
    const phaseRound = liveRound ?? intervalRound ?? postRound;
    if (!phaseRound) { if (eventName === 'player_death') unassignedDeaths += 1; continue; }
    const rawActor = event.actorPlayerId;
    const rawTarget = event.targetPlayerId;
    const rawAssister = event.assisterPlayerId;
    const actorId = rawActor && playerToTeam.has(rawActor) ? rawActor : null;
    const targetId = eventName.startsWith('player_') && rawTarget && playerToTeam.has(rawTarget) ? rawTarget : null;
    const candidateAssisterId = rawAssister && playerToTeam.has(rawAssister) ? rawAssister : null;
    const assisterId = isCreditedAssist(candidateAssisterId, targetId, playerToTeam) ? candidateAssisterId : null;
    const actorTeamId = actorId ? playerToTeam.get(actorId) ?? null : null;
    const targetTeamId = targetId ? playerToTeam.get(targetId) ?? null : null;
    const friendlyFire = actorId !== null && targetId !== null && actorId !== targetId && actorTeamId === targetTeamId;
    const tickRows = input.ticks.filter((item) => item.tick === tick);
    const aliveByTeamId = tickRows.length > 0 ? Object.fromEntries(teams.map((team) => [team.id, tickRows.filter((item) => {
      const idAtTick = item.playerId;
      return idAtTick && playerToTeam.get(idAtTick) === team.id && item.isAlive === true;
    }).length])) : null;
    const actorTick = actorId ? tickRows.find((item) => item.playerId === actorId) : undefined;
    let bombState = bombStateByRound.get(phaseRound.id) ?? 'NOT_PLANTED';
    if (eventName === 'bomb_planted') bombState = 'PLANTED';
    if (eventName === 'bomb_defused') bombState = 'DEFUSED';
    if (eventName === 'bomb_exploded') bombState = 'EXPLODED';
    bombStateByRound.set(phaseRound.id, bombState);
    const kind = eventName === 'player_death' && !liveRound ? 'PLAYER_DEATH_NONLIVE' : factualKinds[eventName] ?? eventName.toUpperCase();
    normalizedEvents.push({
      id: eventId(phaseRound.ordinal, eventName, parserRowIndex), kind, roundId: phaseRound.id, tick, actorId, targetId, assisterId,
      attrs: {
        friendlyFire, suicide: eventName === 'player_death' ? actorId !== null && actorId === targetId : null,
        headshot: event.headshot, assistedFlash: event.assistedFlash, weapon: event.weapon,
        healthAfter: event.healthAfter, armorAfter: event.armorAfter, rawHealthDamage: event.rawHealthDamage, rawArmorDamage: event.rawArmorDamage,
        hitgroup: event.hitgroup, blindDuration: event.blindDuration, entityId: event.entityId,
        site: event.site, hasKit: event.hasKit, x: event.x, y: event.y, z: event.z,
        excludedFromLiveFeatures: liveRound === undefined
      },
      context: {
        phase: liveRound ? 'LIVE' : tick < (phaseRound.freezeEndTick ?? phaseRound.startTick) ? 'PRE_FREEZE' : 'POST_ROUND',
        actorTeamId, targetTeamId, actorSide: actorTeamId ? phaseRound.sideByTeamId[actorTeamId] ?? null : null, targetSide: targetTeamId ? phaseRound.sideByTeamId[targetTeamId] ?? null : null,
        aliveByTeamId, secondsFromFreezeEnd: phaseRound.freezeEndTick !== null && tickRate !== null ? (tick - phaseRound.freezeEndTick) / tickRate : null,
        bombState, actorEquipmentValue: actorTick?.equipmentValue ?? null, actorMoney: actorTick?.cash ?? null
      },
      source: { eventName, rowIndex: parserRowIndex }
    });
    if (eventName === 'player_death' && !liveRound && tick >= (phaseRound.freezeEndTick ?? phaseRound.startTick)) adjustScoreboard(event, -1);
  }
  for (const round of rounds) {
    if (round.freezeEndTick === null) continue;
    const freezeTick = round.freezeEndTick;
    input.ticks.forEach((tickInput) => {
      if (tickInput.tick !== freezeTick) return;
      const playerId = tickInput.playerId;
      if (!playerId || !playerToTeam.has(playerId)) return;
      normalizedEvents.push({
        id: eventId(round.ordinal, 'economy_snapshot', tickInput.sourceRowIndex), kind: 'ECONOMY_SNAPSHOT', roundId: round.id, tick: freezeTick,
        actorId: playerId, targetId: null, assisterId: null,
        attrs: { equipmentValue: tickInput.equipmentValue, armor: tickInput.armorValue, hasHelmet: tickInput.hasHelmet, hasDefuser: tickInput.hasDefuser, money: tickInput.cash, inventory: tickInput.inventory },
        context: { phase: 'LIVE', actorTeamId: playerToTeam.get(playerId) ?? null, targetTeamId: null, actorSide: round.sideByTeamId[playerToTeam.get(playerId) ?? ''] ?? null, targetSide: null, aliveByTeamId: null, secondsFromFreezeEnd: 0, bombState: 'NOT_PLANTED', actorEquipmentValue: tickInput.equipmentValue, actorMoney: tickInput.cash },
        source: { eventName: 'parseTicks:economy', rowIndex: tickInput.sourceRowIndex }
      });
    });
  }
  if (unassignedDeaths > 0) issues.push({ code: 'UNASSIGNED_DEATH_EVENTS', message: `${unassignedDeaths} событий смерти не удалось однозначно привязать к live-раунду.` });
  const match: MatchData = {
    schemaVersion: '1', matchId: input.matchId, fileSha256: input.fileSha256,
    map: input.map, tickRate, teams, players, rounds, events: normalizedEvents, quality: 'PARTIAL', qualityIssues: issues,
    provenance: { parser: input.provenance.parser, parserVersion: input.provenance.parserVersion, normalizedAt: input.normalizedAt ?? new Date().toISOString() }
  };
  const validation = validateMatch(match);
  return { ...match, quality: validation.quality, qualityIssues: [...issues, ...validation.issues] };
}
