import { describe, expect, it } from 'vitest';
import type { MatchData, MatchEvent } from '@who-ruined/contracts';
import { syntheticValidMatch } from '@who-ruined/testkit';
import {
  assertMatchRelations,
  MatchRelationError,
} from '../src/index.js';

function syntheticEvent(match: MatchData): MatchEvent {
  const actor = match.players[0]!;
  const target = match.players[5]!;
  return {
    id: 'synthetic-event',
    kind: 'PLAYER_DEATH',
    roundId: match.rounds[0]!.id,
    tick: 1_200,
    actorId: actor.id,
    targetId: target.id,
    assisterId: null,
    attrs: {},
    context: {
      phase: 'LIVE',
      actorTeamId: actor.teamId,
      targetTeamId: target.teamId,
      actorSide: 'T',
      targetSide: 'CT',
      aliveByTeamId: { [actor.teamId]: 5, [target.teamId]: 5 },
      secondsFromFreezeEnd: 100 / 64,
      bombState: 'NOT_PLANTED',
      actorEquipmentValue: null,
      actorMoney: null,
    },
    source: { eventName: 'synthetic-test-event', rowIndex: 0 },
  };
}

function issueCodes(match: MatchData): string[] {
  try {
    assertMatchRelations(match);
  } catch (error) {
    expect(error).toBeInstanceOf(MatchRelationError);
    return (error as MatchRelationError).issues.map((issue) => issue.code);
  }
  throw new Error('Synthetic fixture unexpectedly passed relationship validation.');
}

describe('fatal Match relationship validation', () => {
  it.each([
    ['duplicate team ids', (match: MatchData) => { match.teams[1]!.id = match.teams[0]!.id; }, 'DUPLICATE_TEAM_ID'],
    ['duplicate player ids', (match: MatchData) => { match.players[1]!.id = match.players[0]!.id; }, 'DUPLICATE_PLAYER_ID'],
    ['duplicate non-null SteamIDs', (match: MatchData) => { match.players[1]!.steamId = match.players[0]!.steamId; }, 'DUPLICATE_PLAYER_STEAM_ID'],
    ['duplicate player in one roster', (match: MatchData) => { match.teams[0]!.playerIds[1] = match.teams[0]!.playerIds[0]!; }, 'DUPLICATE_ROSTER_PLAYER'],
    ['player in two rosters', (match: MatchData) => { match.teams[1]!.playerIds[0] = match.teams[0]!.playerIds[0]!; }, 'PLAYER_IN_MULTIPLE_TEAMS'],
    ['roster references unknown player', (match: MatchData) => { match.teams[0]!.playerIds[0] = 'unknown-player'; }, 'ROSTER_PLAYER_NOT_FOUND'],
    ['player is absent from its declared roster', (match: MatchData) => { match.teams[0]!.playerIds = match.teams[0]!.playerIds.slice(1); }, 'PLAYER_ROSTER_MISMATCH'],
    ['player references unknown team', (match: MatchData) => { match.players[0]!.teamId = 'unknown-team'; }, 'PLAYER_TEAM_NOT_FOUND'],
    ['duplicate round ids', (match: MatchData) => { match.rounds[1]!.id = match.rounds[0]!.id; }, 'DUPLICATE_ROUND_ID'],
    ['round winner references unknown team', (match: MatchData) => { match.rounds[0]!.winnerTeamId = 'unknown-team'; }, 'ROUND_WINNER_TEAM_NOT_FOUND'],
    ['round side map references unknown team', (match: MatchData) => { match.rounds[0]!.sideByTeamId['unknown-team'] = 'T'; }, 'ROUND_TEAM_NOT_FOUND'],
    ['round score-before references unknown team', (match: MatchData) => { match.rounds[0]!.scoreBefore['unknown-team'] = 0; }, 'ROUND_TEAM_NOT_FOUND'],
    ['round score-after references unknown team', (match: MatchData) => { match.rounds[0]!.scoreAfter['unknown-team'] = 0; }, 'ROUND_TEAM_NOT_FOUND'],
  ] as const)('rejects %s', (_name, mutate, expectedCode) => {
    const match = syntheticValidMatch();
    mutate(match);
    expect(issueCodes(match)).toContain(expectedCode);
  });

  it.each([
    ['roundId', (event: MatchEvent) => { event.roundId = 'unknown-round'; }, 'EVENT_ROUND_NOT_FOUND'],
    ['actorId', (event: MatchEvent) => { event.actorId = 'unknown-player'; }, 'EVENT_PLAYER_NOT_FOUND'],
    ['targetId', (event: MatchEvent) => { event.targetId = 'unknown-player'; }, 'EVENT_PLAYER_NOT_FOUND'],
    ['assisterId', (event: MatchEvent) => { event.assisterId = 'unknown-player'; }, 'EVENT_PLAYER_NOT_FOUND'],
  ] as const)('rejects an event with an unknown %s', (_field, mutate, expectedCode) => {
    const match = syntheticValidMatch();
    const event = syntheticEvent(match);
    mutate(event);
    match.events = [event];
    expect(issueCodes(match)).toContain(expectedCode);
  });

  it('rejects duplicate event ids and foreign or contradictory context teams', () => {
    const match = syntheticValidMatch();
    const first = syntheticEvent(match);
    const second = { ...syntheticEvent(match), source: { eventName: 'synthetic-test-event', rowIndex: 1 } };
    second.context = {
      ...second.context!,
      actorTeamId: match.players[5]!.teamId,
      targetTeamId: 'unknown-team',
      aliveByTeamId: { unknownTeam: 1 },
    };
    match.events = [first, second];

    expect(issueCodes(match)).toEqual(expect.arrayContaining([
      'DUPLICATE_EVENT_ID',
      'EVENT_CONTEXT_TEAM_NOT_FOUND',
      'EVENT_CONTEXT_ALIVE_TEAM_NOT_FOUND',
      'EVENT_CONTEXT_ACTOR_TEAM_MISMATCH',
      'EVENT_CONTEXT_TARGET_TEAM_MISMATCH',
    ]));
  });

  it('accepts explicit null event identities and a relationship-consistent PARTIAL match', () => {
    const match = syntheticValidMatch();
    const event = syntheticEvent(match);
    event.actorId = null;
    event.targetId = null;
    event.assisterId = null;
    event.context = {
      ...event.context!,
      phase: 'POST_ROUND',
      actorTeamId: null,
      targetTeamId: null,
      actorSide: null,
      targetSide: null,
      aliveByTeamId: null,
    };
    event.tick = match.rounds[0]!.endTick + 50;
    match.events = [event];
    match.quality = 'PARTIAL';
    match.rounds[0]!.winnerTeamId = null;
    match.rounds[0]!.winnerSide = null;

    expect(() => assertMatchRelations(match)).not.toThrow();
  });

  it('accepts an empty but non-contradictory PARTIAL match', () => {
    const match = syntheticValidMatch();
    match.teams = [];
    match.players = [];
    match.rounds = [];
    match.events = [];
    match.quality = 'PARTIAL';

    expect(() => assertMatchRelations(match)).not.toThrow();
  });
});
