import type { MatchData } from './matches.js';

export interface MatchRelationIssue {
  code: string;
  path: string;
  message: string;
}

export class MatchRelationError extends Error {
  constructor(public readonly issues: readonly MatchRelationIssue[]) {
    super('MATCH_RELATIONSHIP_INVALID');
    this.name = 'MatchRelationError';
  }
}

function duplicateValues(values: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return duplicates;
}

/**
 * Rejects contradictory entity relationships while leaving missing evidence to
 * the existing quality/PARTIAL policy.
 */
export function assertMatchRelations(match: MatchData): void {
  const issues: MatchRelationIssue[] = [];
  const add = (code: string, path: string, message: string): void => {
    issues.push({ code, path, message });
  };

  const duplicateTeamIds = duplicateValues(match.teams.map((team) => team.id));
  for (const teamId of duplicateTeamIds) {
    add('DUPLICATE_TEAM_ID', 'teams', `Team id ${teamId} is duplicated.`);
  }
  const teamIds = new Set(match.teams.map((team) => team.id));

  const duplicatePlayerIds = duplicateValues(match.players.map((player) => player.id));
  for (const playerId of duplicatePlayerIds) {
    add('DUPLICATE_PLAYER_ID', 'players', `Player id ${playerId} is duplicated.`);
  }
  const duplicateSteamIds = duplicateValues(match.players.flatMap((player) => (
    player.steamId === null ? [] : [player.steamId]
  )));
  for (const steamId of duplicateSteamIds) {
    add(
      'DUPLICATE_PLAYER_STEAM_ID',
      'players',
      `SteamID ${steamId} belongs to multiple players.`,
    );
  }
  const knownPlayers = new Map(match.players.map((player) => [player.id, player]));
  const rosterTeamsByPlayer = new Map<string, Set<string>>();
  for (const [teamIndex, team] of match.teams.entries()) {
    for (const playerId of duplicateValues(team.playerIds)) {
      add(
        'DUPLICATE_ROSTER_PLAYER',
        `teams.${teamIndex}.playerIds`,
        `Player ${playerId} occurs more than once in team ${team.id}.`,
      );
    }
    for (const playerId of team.playerIds) {
      if (!knownPlayers.has(playerId)) {
        add(
          'ROSTER_PLAYER_NOT_FOUND',
          `teams.${teamIndex}.playerIds`,
          `Team ${team.id} references unknown player ${playerId}.`,
        );
      }
      const memberships = rosterTeamsByPlayer.get(playerId) ?? new Set<string>();
      memberships.add(team.id);
      rosterTeamsByPlayer.set(playerId, memberships);
    }
  }

  for (const [playerId, memberships] of rosterTeamsByPlayer) {
    if (memberships.size > 1) {
      add(
        'PLAYER_IN_MULTIPLE_TEAMS',
        'teams',
        `Player ${playerId} occurs in multiple team rosters.`,
      );
    }
  }
  for (const [playerIndex, player] of match.players.entries()) {
    if (!teamIds.has(player.teamId)) {
      add(
        'PLAYER_TEAM_NOT_FOUND',
        `players.${playerIndex}.teamId`,
        `Player ${player.id} references unknown team ${player.teamId}.`,
      );
      continue;
    }
    const memberships = rosterTeamsByPlayer.get(player.id);
    if (!memberships?.has(player.teamId)) {
      add(
        'PLAYER_ROSTER_MISMATCH',
        `players.${playerIndex}.teamId`,
        `Player ${player.id} is not present in team ${player.teamId}'s roster.`,
      );
    }
  }

  for (const roundId of duplicateValues(match.rounds.map((round) => round.id))) {
    add('DUPLICATE_ROUND_ID', 'rounds', `Round id ${roundId} is duplicated.`);
  }
  const roundIds = new Set(match.rounds.map((round) => round.id));
  for (const [roundIndex, round] of match.rounds.entries()) {
    if (round.winnerTeamId !== null && !teamIds.has(round.winnerTeamId)) {
      add(
        'ROUND_WINNER_TEAM_NOT_FOUND',
        `rounds.${roundIndex}.winnerTeamId`,
        `Round ${round.id} references unknown winner team ${round.winnerTeamId}.`,
      );
    }
    for (const [field, record] of [
      ['sideByTeamId', round.sideByTeamId],
      ['scoreBefore', round.scoreBefore],
      ['scoreAfter', round.scoreAfter],
    ] as const) {
      for (const teamId of Object.keys(record)) {
        if (!teamIds.has(teamId)) {
          add(
            'ROUND_TEAM_NOT_FOUND',
            `rounds.${roundIndex}.${field}.${teamId}`,
            `Round ${round.id} ${field} references unknown team ${teamId}.`,
          );
        }
      }
    }
  }

  for (const eventId of duplicateValues(match.events.map((event) => event.id))) {
    add('DUPLICATE_EVENT_ID', 'events', `Event id ${eventId} is duplicated.`);
  }
  for (const [eventIndex, event] of match.events.entries()) {
    const eventPath = `events.${eventIndex}`;
    if (!roundIds.has(event.roundId)) {
      add(
        'EVENT_ROUND_NOT_FOUND',
        `${eventPath}.roundId`,
        `Event ${event.id} references unknown round ${event.roundId}.`,
      );
    }
    for (const [field, playerId] of [
      ['actorId', event.actorId],
      ['targetId', event.targetId],
      ['assisterId', event.assisterId],
    ] as const) {
      if (playerId !== null && !knownPlayers.has(playerId)) {
        add(
          'EVENT_PLAYER_NOT_FOUND',
          `${eventPath}.${field}`,
          `Event ${event.id} ${field} references unknown player ${playerId}.`,
        );
      }
    }

    const context = event.context;
    if (!context) continue;
    for (const [field, teamId] of [
      ['actorTeamId', context.actorTeamId],
      ['targetTeamId', context.targetTeamId],
    ] as const) {
      if (teamId !== null && !teamIds.has(teamId)) {
        add(
          'EVENT_CONTEXT_TEAM_NOT_FOUND',
          `${eventPath}.context.${field}`,
          `Event ${event.id} ${field} references unknown team ${teamId}.`,
        );
      }
    }
    for (const teamId of Object.keys(context.aliveByTeamId ?? {})) {
      if (!teamIds.has(teamId)) {
        add(
          'EVENT_CONTEXT_ALIVE_TEAM_NOT_FOUND',
          `${eventPath}.context.aliveByTeamId.${teamId}`,
          `Event ${event.id} alive context references unknown team ${teamId}.`,
        );
      }
    }
    const actor = event.actorId === null ? undefined : knownPlayers.get(event.actorId);
    if (
      actor
      && context.actorTeamId !== null
      && context.actorTeamId !== actor.teamId
    ) {
      add(
        'EVENT_CONTEXT_ACTOR_TEAM_MISMATCH',
        `${eventPath}.context.actorTeamId`,
        `Event ${event.id} actor team contradicts player ${actor.id}.`,
      );
    }
    const target = event.targetId === null ? undefined : knownPlayers.get(event.targetId);
    if (
      target
      && context.targetTeamId !== null
      && context.targetTeamId !== target.teamId
    ) {
      add(
        'EVENT_CONTEXT_TARGET_TEAM_MISMATCH',
        `${eventPath}.context.targetTeamId`,
        `Event ${event.id} target team contradicts player ${target.id}.`,
      );
    }
  }

  if (issues.length > 0) throw new MatchRelationError(issues);
}
