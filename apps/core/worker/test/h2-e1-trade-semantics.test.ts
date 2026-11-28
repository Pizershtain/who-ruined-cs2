import { describe, expect, it } from 'vitest';
import type { MatchData, MatchEvent, MatchRound } from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import type {
  ParsedDemoSnapshot,
  ParsedParticipationSupplement,
} from '@who-ruined/parser-adapter';
import { syntheticValidMatch } from '@who-ruined/testkit';

import { buildPreparedParticipationInput } from '../src/prepared-participation-input.js';

type DeathInput = {
  id: string;
  tick: number;
  actorId: string;
  targetId: string;
  rowIndex: number;
  roundId?: string;
  phase?: NonNullable<MatchEvent['context']>['phase'];
};

type SyntheticTradeFixture = {
  match: MatchData;
  snapshot: ParsedDemoSnapshot;
  supplement: ParsedParticipationSupplement;
  round: MatchRound;
  players: { a1: string; a2: string; a3: string; b1: string; b2: string; b3: string };
};

function makeTradeFixture(
  deaths: readonly DeathInput[],
  options: { tickRate?: number | null; completeRound?: boolean } = {},
): SyntheticTradeFixture {
  const match = syntheticValidMatch();
  const round = match.rounds[0]!;
  const [a1, a2, a3] = match.teams[0]!.playerIds;
  const [b1, b2, b3] = match.teams[1]!.playerIds;
  const teamByPlayer = new Map(match.players.map((player) => [player.id, player.teamId]));
  const roundById = new Map(match.rounds.map((candidate) => [candidate.id, candidate]));
  const events = deaths.map((input): MatchEvent => {
    const eventRound = roundById.get(input.roundId ?? round.id) ?? round;
    const actorTeamId = teamByPlayer.get(input.actorId) ?? null;
    const targetTeamId = teamByPlayer.get(input.targetId) ?? null;
    return {
      id: input.id,
      kind: 'PLAYER_DEATH',
      roundId: eventRound.id,
      tick: input.tick,
      actorId: input.actorId,
      targetId: input.targetId,
      assisterId: null,
      attrs: { friendlyFire: false, suicide: false },
      context: {
        phase: input.phase ?? 'LIVE',
        actorTeamId,
        targetTeamId,
        actorSide: actorTeamId ? eventRound.sideByTeamId[actorTeamId] ?? null : null,
        targetSide: targetTeamId ? eventRound.sideByTeamId[targetTeamId] ?? null : null,
        aliveByTeamId: null,
        secondsFromFreezeEnd: null,
        bombState: null,
        actorEquipmentValue: null,
        actorMoney: null,
      },
      source: { eventName: 'player_death', rowIndex: input.rowIndex },
    };
  });
  match.tickRate = options.tickRate === undefined ? 64 : options.tickRate;
  match.events = events;

  const boundaryEvents: Array<Record<string, unknown>> = match.rounds.flatMap((candidate) => [
    { event_name: 'round_freeze_end', tick: candidate.freezeEndTick },
    ...(options.completeRound === false && candidate.id === round.id
      ? []
      : [
          { event_name: 'round_end', tick: candidate.endTick },
          { event_name: 'round_officially_ended', tick: candidate.endTick },
        ]),
  ]);
  const ticks = match.rounds.flatMap((candidate) => match.players.map((player) => ({
    tick: candidate.freezeEndTick,
    steamid: player.steamId,
    is_alive: true,
    team_num: candidate.sideByTeamId[player.teamId] === 'T' ? 2 : 3,
  })));
  const snapshot: ParsedDemoSnapshot = {
    header: { map_name: match.map },
    players: [],
    eventNames: ['round_freeze_end', 'round_end', 'round_officially_ended'],
    events: boundaryEvents,
    ticks,
  };
  const supplement: ParsedParticipationSupplement = {
    schemaVersion: 'parser-participation-supplement@1',
    evidence: { lifecycleEventNames: [], lifecycleRows: [] },
    prepared: { lifecycleRows: [], hostageRows: [] },
  };
  return {
    match,
    snapshot,
    supplement,
    round,
    players: { a1: a1!, a2: a2!, a3: a3!, b1: b1!, b2: b2!, b3: b3! },
  };
}

function observedTrades(fixture: SyntheticTradeFixture) {
  const analytics = computeMatchAnalytics(fixture.match, '2026-11-17T00:00:00.000Z');
  const prepared = buildPreparedParticipationInput(
    fixture.snapshot,
    fixture.match,
    fixture.supplement,
    { allowIncompleteRoster: true },
  );
  return {
    m2EventIds: analytics.players
      .flatMap((player) => player.facts)
      .filter((fact) => fact.kind === 'TRADE_KILL')
      .flatMap((fact) => fact.eventId ? [fact.eventId] : [])
      .sort(),
    h2AnchorIds: prepared.contextTags
      .filter((row) => row.tag === 'TRADE')
      .map((row) => row.anchorId)
      .sort(),
    h2FastAnchorIds: prepared.contextTags
      .filter((row) => row.tag === 'FAST_TRADE')
      .map((row) => row.anchorId)
      .sort(),
    prepared,
  };
}

describe('H2-E1 synthetic trade characterization', () => {
  it('includes the exact five-second boundary and excludes a later revenge in both models', () => {
    const base = makeTradeFixture([]);
    const exact = makeTradeFixture([
      { id: 'original', tick: 1_200, actorId: base.players.a1, targetId: base.players.b1, rowIndex: 0 },
      { id: 'revenge', tick: 1_520, actorId: base.players.b2, targetId: base.players.a1, rowIndex: 1 },
    ]);
    expect(observedTrades(exact)).toMatchObject({
      m2EventIds: ['revenge'],
      h2AnchorIds: ['revenge'],
      h2FastAnchorIds: [],
    });

    const late = makeTradeFixture([
      { id: 'original', tick: 1_200, actorId: base.players.a1, targetId: base.players.b1, rowIndex: 0 },
      { id: 'revenge', tick: 1_521, actorId: base.players.b2, targetId: base.players.a1, rowIndex: 1 },
    ]);
    expect(observedTrades(late)).toMatchObject({ m2EventIds: [], h2AnchorIds: [] });
  });

  it('documents the same-tick row-order difference between M2 and H2', () => {
    const base = makeTradeFixture([]);
    const fixture = makeTradeFixture([
      { id: 'original', tick: 1_200, actorId: base.players.a1, targetId: base.players.b1, rowIndex: 10 },
      { id: 'revenge', tick: 1_200, actorId: base.players.b2, targetId: base.players.a1, rowIndex: 11 },
    ]);
    expect(observedTrades(fixture)).toMatchObject({
      m2EventIds: ['revenge'],
      h2AnchorIds: [],
    });
  });

  it('documents unknown tick-rate behavior without treating either result as canonical', () => {
    const base = makeTradeFixture([]);
    const fixture = makeTradeFixture([
      { id: 'original', tick: 1_200, actorId: base.players.a1, targetId: base.players.b1, rowIndex: 0 },
      { id: 'revenge', tick: 1_204, actorId: base.players.b2, targetId: base.players.a1, rowIndex: 1 },
    ], { tickRate: null });
    expect(observedTrades(fixture)).toMatchObject({
      m2EventIds: [],
      h2AnchorIds: ['revenge'],
    });
  });

  it('uses one revenge at most once when two deaths share that candidate', () => {
    const base = makeTradeFixture([]);
    const fixture = makeTradeFixture([
      { id: 'original-1', tick: 1_200, actorId: base.players.a1, targetId: base.players.b1, rowIndex: 0 },
      { id: 'original-2', tick: 1_210, actorId: base.players.a1, targetId: base.players.b2, rowIndex: 1 },
      { id: 'revenge', tick: 1_220, actorId: base.players.b3, targetId: base.players.a1, rowIndex: 2 },
    ]);
    expect(observedTrades(fixture)).toMatchObject({
      m2EventIds: ['revenge'],
      h2AnchorIds: ['revenge'],
      h2FastAnchorIds: ['revenge'],
    });
  });

  it('keeps independent reciprocal links and documents different duplicate handling', () => {
    const base = makeTradeFixture([]);
    const fixture = makeTradeFixture([
      { id: 'original-a', tick: 1_200, actorId: base.players.a1, targetId: base.players.b1, rowIndex: 0 },
      { id: 'revenge-b', tick: 1_220, actorId: base.players.b2, targetId: base.players.a1, rowIndex: 1 },
      { id: 'revenge-b', tick: 1_220, actorId: base.players.b2, targetId: base.players.a1, rowIndex: 1 },
      { id: 'revenge-a', tick: 1_240, actorId: base.players.a2, targetId: base.players.b2, rowIndex: 2 },
    ]);
    expect(observedTrades(fixture)).toMatchObject({
      m2EventIds: ['revenge-a', 'revenge-b', 'revenge-b'],
      h2AnchorIds: ['revenge-a', 'revenge-b'],
    });
  });

  it('does not link across rounds, non-live events, unknown teams, or an unclean H2 round', () => {
    const base = makeTradeFixture([]);
    const secondRound = base.match.rounds[1]!;
    const acrossRounds = makeTradeFixture([
      { id: 'original', tick: 1_200, actorId: base.players.a1, targetId: base.players.b1, rowIndex: 0 },
      { id: 'revenge', tick: secondRound.freezeEndTick! + 10, actorId: base.players.b2, targetId: base.players.a1, rowIndex: 1, roundId: secondRound.id },
    ]);
    expect(observedTrades(acrossRounds)).toMatchObject({ m2EventIds: [], h2AnchorIds: [] });

    const nonLive = makeTradeFixture([
      { id: 'original', tick: 1_200, actorId: base.players.a1, targetId: base.players.b1, rowIndex: 0 },
      { id: 'revenge', tick: 1_220, actorId: base.players.b2, targetId: base.players.a1, rowIndex: 1, phase: 'POST_ROUND' },
    ]);
    expect(observedTrades(nonLive)).toMatchObject({ m2EventIds: [], h2AnchorIds: [] });

    const unknownTeam = makeTradeFixture([
      { id: 'original', tick: 1_200, actorId: base.players.a1, targetId: 'unknown-player', rowIndex: 0 },
      { id: 'revenge', tick: 1_220, actorId: base.players.b2, targetId: base.players.a1, rowIndex: 1 },
    ]);
    expect(observedTrades(unknownTeam)).toMatchObject({ m2EventIds: [], h2AnchorIds: [] });

    const unclean = makeTradeFixture([
      { id: 'original', tick: 1_200, actorId: base.players.a1, targetId: base.players.b1, rowIndex: 0 },
      { id: 'revenge', tick: 1_220, actorId: base.players.b2, targetId: base.players.a1, rowIndex: 1 },
    ], { completeRound: false });
    expect(observedTrades(unclean)).toMatchObject({
      m2EventIds: ['revenge'],
      h2AnchorIds: [],
    });
  });

  it('shows that current H2 death mass does not distinguish a traded death', () => {
    const base = makeTradeFixture([]);
    const untraded = makeTradeFixture([
      { id: 'original', tick: 1_200, actorId: base.players.a1, targetId: base.players.b1, rowIndex: 0 },
    ]);
    const traded = makeTradeFixture([
      { id: 'original', tick: 1_200, actorId: base.players.a1, targetId: base.players.b1, rowIndex: 0 },
      { id: 'revenge', tick: 1_220, actorId: base.players.b2, targetId: base.players.a1, rowIndex: 1 },
    ]);
    const deathObservation = (fixture: SyntheticTradeFixture) => {
      const profile = observedTrades(fixture).prepared.preparedProfiles
        .find((candidate) => candidate.playerId === base.players.b1);
      const episode = profile?.p4BPlus.episodeContributions
        ?.find((candidate) => candidate.chosenAxis === 'ownDeaths');
      return {
        episodeBase: episode?.base,
        family: profile?.p4BPlus.familyContributions?.DEATH_RELATED,
      };
    };

    expect(deathObservation(traded)).toEqual(deathObservation(untraded));
    expect(deathObservation(traded).episodeBase).toBeLessThan(0);
  });
});
