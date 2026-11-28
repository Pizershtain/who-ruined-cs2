import { describe, expect, it } from 'vitest';
import type { MatchData, MatchEvent, MatchRound } from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import {
  prepareEvpMatchInput,
  projectParticipationRatings,
  type ParticipationRatingPreparedProfile,
} from '@who-ruined/scoring';
import { syntheticValidMatch } from '@who-ruined/testkit';

import {
  reconstructRoundTimelines,
  type RoundStartEvidence,
} from '@who-ruined/scoring/h3';

type SyntheticEvent = {
  id: string;
  kind?: string;
  tick?: number;
  rowIndex?: number;
  actorId?: string | null | undefined;
  targetId?: string | null | undefined;
  phase?: NonNullable<MatchEvent['context']>['phase'];
  aliveByTeamId?: Record<string, number> | null;
};

type Fixture = {
  match: MatchData;
  round: MatchRound;
  evidence: RoundStartEvidence;
  teamA: string;
  teamB: string;
  a: string[];
  b: string[];
};

function makeEvent(match: MatchData, round: MatchRound, input: SyntheticEvent): MatchEvent {
  const teamByPlayer = new Map(match.players.map((player) => [player.id, player.teamId]));
  const actorId = input.actorId === undefined ? match.teams[0]!.playerIds[0]! : input.actorId;
  const targetId = input.targetId === undefined ? match.teams[1]!.playerIds[0]! : input.targetId;
  const actorTeamId = actorId ? teamByPlayer.get(actorId) ?? null : null;
  const targetTeamId = targetId ? teamByPlayer.get(targetId) ?? null : null;
  return {
    id: input.id,
    kind: input.kind ?? 'PLAYER_DEATH',
    roundId: round.id,
    tick: input.tick ?? (round.freezeEndTick ?? round.startTick) + 100,
    actorId,
    targetId,
    assisterId: null,
    attrs: {},
    context: {
      phase: input.phase ?? 'LIVE',
      actorTeamId,
      targetTeamId,
      actorSide: actorTeamId ? round.sideByTeamId[actorTeamId] ?? null : null,
      targetSide: targetTeamId ? round.sideByTeamId[targetTeamId] ?? null : null,
      aliveByTeamId: input.aliveByTeamId ?? null,
      secondsFromFreezeEnd: null,
      bombState: null,
      actorEquipmentValue: null,
      actorMoney: null,
    },
    source: { eventName: (input.kind ?? 'PLAYER_DEATH').toLowerCase(), rowIndex: input.rowIndex ?? 1 },
  };
}

function fixture(inputs: readonly SyntheticEvent[] = [], scenario: 'BOMB' | 'HOSTAGE' = 'BOMB'): Fixture {
  const match = syntheticValidMatch();
  const round = match.rounds[0]!;
  const teamA = match.teams[0]!.id;
  const teamB = match.teams[1]!.id;
  const a = [...match.teams[0]!.playerIds];
  const b = [...match.teams[1]!.playerIds];
  match.events = inputs.map((input) => makeEvent(match, round, input));
  const evidence: RoundStartEvidence = {
    roundId: round.id,
    liveStart: round.freezeEndTick ?? round.startTick,
    liveEnd: round.endTick,
    boundaryComplete: true,
    boundaryReasons: [],
    scenario,
    players: match.players.map((player) => ({
      playerId: player.id,
      classification: 'PRESENT_VERIFIED',
      counted: true,
      startObserved: true,
      startAlive: true,
    })),
    supplementalEvents: [],
  };
  return { match, round, evidence, teamA, teamB, a, b };
}

function timeline(value: Fixture) {
  return reconstructRoundTimelines(value.match, [value.evidence]).rounds[0]!;
}

function deathsAt(f: Fixture, rows: Array<[string, string, string, number, number]>): void {
  f.match.events = rows.map(([id, actorId, targetId, tick, rowIndex]) => makeEvent(
    f.match,
    f.round,
    { id, actorId, targetId, tick, rowIndex },
  ));
}

function zeroPreparedProfile(f: Fixture): ParticipationRatingPreparedProfile {
  const playerId = f.a[0]!;
  const row = {
    status: 'CALCULATED_RESEARCH_ONLY' as const,
    reason: null,
    familyContributions: { COMBAT: 0, SUPPORT: 0, DEATH_RELATED: 0, DIRECT_HARM: 0 },
    objectiveSignals: { 'objective:plants': 0, 'objective:defuses': 0 },
    episodeContributions: [],
  };
  return {
    profileKey: `synthetic:${playerId}`,
    playerId,
    teamId: f.teamA,
    status: 'ELIGIBLE',
    reason: null,
    prepared: { profileKey: `synthetic:${playerId}`, scenario: 'BOMB', p4BPlus: row, p4CPlus: structuredClone(row) },
  };
}

describe('H2-E4 round timeline research (explicitly synthetic fixtures)', () => {
  it('1. reconstructs a standard 5v5 to 5v4 transition', () => {
    const f = fixture();
    deathsAt(f, [['kill', f.a[0]!, f.b[0]!, 1_200, 1]]);
    const entry = timeline(f).timeline.at(-1)!;
    expect(entry.before.exactAliveCountByTeamId).toEqual({ [f.teamA]: 5, [f.teamB]: 5 });
    expect(entry.after.exactAliveCountByTeamId).toEqual({ [f.teamA]: 5, [f.teamB]: 4 });
  });

  it('2. preserves sequential reductions of a numerical disadvantage', () => {
    const f = fixture();
    deathsAt(f, [
      ['a-death-1', f.b[0]!, f.a[1]!, 1_100, 1],
      ['a-death-2', f.b[1]!, f.a[2]!, 1_110, 2],
      ['recovery-1', f.a[0]!, f.b[0]!, 1_120, 3],
      ['recovery-2', f.a[0]!, f.b[1]!, 1_130, 4],
    ]);
    const advantages = timeline(f).timeline.flatMap((entry) => entry.advantage ? [entry.advantage] : []);
    expect(advantages.slice(-2).map((row) => [row.beforeDifference, row.afterDifference]))
      .toEqual([[-2, -1], [-1, 0]]);
  });

  it('3. identifies creation of numerical advantage from equality', () => {
    const f = fixture([{ id: 'opening', actorId: undefined, targetId: undefined }]);
    expect(timeline(f).timeline.at(-1)!.advantage).toMatchObject({
      actedAt: 'EQUALITY', beforeDifference: 0, afterDifference: 1, createdAdvantage: true,
    });
  });

  it('4. identifies an enemy kill made while disadvantaged', () => {
    const f = fixture();
    deathsAt(f, [
      ['a-death', f.b[0]!, f.a[1]!, 1_100, 1],
      ['response', f.a[0]!, f.b[0]!, 1_200, 2],
    ]);
    expect(timeline(f).timeline.at(-1)!.advantage).toMatchObject({ actedAt: 'DISADVANTAGE' });
  });

  it('5. keeps multiple deaths on one tick sequential when rowIndex is unique', () => {
    const f = fixture();
    deathsAt(f, [
      ['first', f.a[0]!, f.b[0]!, 1_200, 10],
      ['second', f.b[1]!, f.a[0]!, 1_200, 11],
    ]);
    const entries = timeline(f).timeline.slice(1);
    expect(entries.map((entry) => entry.ordering)).toEqual(['ROW_INDEX_ORDERED', 'ROW_INDEX_ORDERED']);
    expect(entries.map((entry) => entry.sameTick)).toEqual([
      { eventCount: 2, orderedIntermediateStatesExposed: true, atomicFinalStateEquivalent: true },
      { eventCount: 2, orderedIntermediateStatesExposed: true, atomicFinalStateEquivalent: true },
    ]);
    expect(entries.map((entry) => entry.after.exactAliveCountByTeamId))
      .toEqual([{ [f.teamA]: 5, [f.teamB]: 4 }, { [f.teamA]: 4, [f.teamB]: 4 }]);
  });

  it('6. uses the actual rowIndex order rather than the input array order', () => {
    const f = fixture();
    deathsAt(f, [
      ['later-row', f.b[1]!, f.a[0]!, 1_200, 11],
      ['earlier-row', f.a[0]!, f.b[0]!, 1_200, 10],
    ]);
    expect(timeline(f).timeline.slice(1).map((entry) => entry.eventIds[0]))
      .toEqual(['earlier-row', 'later-row']);
  });

  it('7. groups same-tick events atomically when their row order is not unique', () => {
    const f = fixture();
    deathsAt(f, [
      ['one', f.a[0]!, f.b[0]!, 1_200, 10],
      ['two', f.b[1]!, f.a[0]!, 1_200, 10],
    ]);
    expect(timeline(f).timeline.slice(1)).toMatchObject([{
      ordering: 'ATOMIC_SAME_TICK',
      eventIds: ['one', 'two'],
      uncertaintyReasons: expect.arrayContaining(['SAME_TICK_ORDER_UNAVAILABLE']),
    }]);
  });

  it('8. rejects every occurrence of a duplicate death event ID', () => {
    const f = fixture();
    deathsAt(f, [
      ['duplicate', f.a[0]!, f.b[0]!, 1_200, 1],
      ['duplicate', f.a[0]!, f.b[0]!, 1_201, 2],
    ]);
    const result = reconstructRoundTimelines(f.match, [f.evidence]);
    expect(result.diagnostics.rejectedDuplicateEventIds).toEqual(['duplicate']);
    expect(result.rounds[0]!.terminalState.state!.exactAliveCountByTeamId[f.teamB]).toBe(5);
  });

  it('9. reports a missing death when an alive snapshot contradicts the event ledger', () => {
    const f = fixture([{ id: 'fact', kind: 'PLAYER_HURT', aliveByTeamId: {} }]);
    f.match.events[0]!.context!.aliveByTeamId = { [f.teamA]: 5, [f.teamB]: 4 };
    expect(timeline(f).diagnostics).toContain('ALIVE_SNAPSHOT_MISMATCH');
  });

  it('10. preserves unknown players for an incomplete initial roster', () => {
    const f = fixture();
    f.evidence.players = f.evidence.players.filter((row) => row.playerId !== f.b[4]);
    const first = timeline(f).timeline[0]!.after;
    expect(first.exactAliveCountByTeamId[f.teamB]).toBeNull();
    expect(first.unknownPlayerIdsByTeamId[f.teamB]).toEqual([f.b[4]]);
  });

  it('11. does not alter state for a death with unknown target/team relation', () => {
    const f = fixture([{ id: 'unknown', targetId: 'unknown-player' }]);
    const last = timeline(f).timeline.at(-1)!;
    expect(last.confidence).toBe('UNAVAILABLE');
    expect(last.after.exactAliveCountByTeamId).toEqual({ [f.teamA]: 5, [f.teamB]: 5 });
  });

  it('12. applies friendly-fire death as a death fact without enemy advantage credit', () => {
    const f = fixture([{ id: 'friendly', actorId: undefined, targetId: undefined }]);
    f.match.events = [makeEvent(f.match, f.round, { id: 'friendly', actorId: f.a[0], targetId: f.a[1] })];
    const last = timeline(f).timeline.at(-1)!;
    expect(last.after.exactAliveCountByTeamId[f.teamA]).toBe(4);
    expect(last.advantage).toBeNull();
  });

  it('13. records suicide and world death without inventing an enemy kill', () => {
    const f = fixture();
    deathsAt(f, [
      ['suicide', f.a[0]!, f.a[0]!, 1_100, 1],
      ['world', '', f.b[0]!, 1_200, 2],
    ]);
    f.match.events[1]!.actorId = null;
    f.match.events[1]!.context!.actorTeamId = null;
    const entries = timeline(f).timeline.slice(1);
    expect(entries.at(-1)!.after.exactAliveCountByTeamId).toEqual({ [f.teamA]: 4, [f.teamB]: 4 });
    expect(entries.every((entry) => entry.advantage === null)).toBe(true);
  });

  it('14. marks a globally excluded round as excluded', () => {
    const f = fixture();
    f.evidence.boundaryComplete = false;
    f.evidence.boundaryReasons = ['ROUND_GLOBAL_EVIDENCE_MISSING'];
    expect(timeline(f).coverageStatus).toBe('EXCLUDED');
  });

  it('15. never upgrades an incomplete round boundary to complete', () => {
    const f = fixture([{ id: 'kill' }]);
    f.evidence.boundaryComplete = false;
    expect(timeline(f)).toMatchObject({
      boundaryEvidence: { complete: false }, coverageStatus: 'EXCLUDED',
    });
  });

  it('16. retains roster team identity when T/CT sides are swapped', () => {
    const f = fixture([{ id: 'kill' }]);
    f.round.sideByTeamId = { [f.teamA]: 'CT', [f.teamB]: 'T' };
    const result = timeline(f);
    expect(result.teamIds).toEqual([f.teamA, f.teamB].sort());
    expect(result.sideByTeamId).toEqual({ [f.teamA]: 'CT', [f.teamB]: 'T' });
  });

  it('17. transitions to POSTPLANT only on confirmed bomb plant', () => {
    const f = fixture([{ id: 'plant', kind: 'BOMB_PLANTED', targetId: null }]);
    expect(timeline(f).timeline.at(-1)!.after.phase).toBe('POSTPLANT');
  });

  it('18. distinguishes bomb defuse from explosion terminal evidence', () => {
    const defuse = fixture([
      { id: 'plant', kind: 'BOMB_PLANTED', rowIndex: 1, targetId: null },
      { id: 'defuse', kind: 'BOMB_DEFUSED', rowIndex: 2, targetId: null },
    ]);
    const explosion = fixture([
      { id: 'plant', kind: 'BOMB_PLANTED', rowIndex: 1, targetId: null },
      { id: 'explode', kind: 'BOMB_EXPLODED', rowIndex: 2, targetId: null },
    ]);
    expect(timeline(defuse).timeline.at(-1)!.after.phase).toBe('DEFUSED');
    expect(timeline(explosion).timeline.at(-1)!.after.phase).toBe('EXPLODED');
  });

  it('19. accepts hostage evidence without applying bomb semantics', () => {
    const f = fixture([], 'HOSTAGE');
    f.evidence.supplementalEvents = [{
      id: 'hostage', roundId: f.round.id, tick: 1_200,
      kind: 'HOSTAGE_RESCUED', actorId: f.a[0]!,
    }];
    const last = timeline(f).timeline.at(-1)!;
    expect(last.actionTypes).toEqual(['HOSTAGE_RESCUED']);
    expect(last.after.phase).toBe('HOSTAGE_ACTION');
  });

  it('20. confirms a won 1v2 clutch only when the lone player survives', () => {
    const f = fixture();
    const t = f.evidence.liveStart;
    f.round.winnerTeamId = f.teamA;
    deathsAt(f, [
      ['a2', f.b[0]!, f.a[1]!, t + 10, 1], ['a3', f.b[0]!, f.a[2]!, t + 20, 2],
      ['a4', f.b[0]!, f.a[3]!, t + 30, 3], ['a5', f.b[0]!, f.a[4]!, t + 40, 4],
      ['b1', f.a[0]!, f.b[0]!, t + 50, 5], ['b2', f.a[0]!, f.b[1]!, t + 60, 6],
      ['b3', f.a[0]!, f.b[2]!, t + 70, 7], ['b4', f.a[0]!, f.b[3]!, t + 80, 8],
      ['b5', f.a[0]!, f.b[4]!, t + 90, 9],
    ]);
    expect(timeline(f).clutchOpportunities.find((row) => row.playerId === f.a[0]))
      .toMatchObject({ opponentsAtStart: 5, outcome: 'CLUTCH_WON', survived: true });
  });

  it('21. preserves two useful kills in a lost 1v3 round', () => {
    const f = fixture();
    const t = f.evidence.liveStart;
    f.round.winnerTeamId = f.teamB;
    deathsAt(f, [
      ['b4', f.a[1]!, f.b[3]!, t + 5, 1], ['b5', f.a[2]!, f.b[4]!, t + 6, 2],
      ['a2', f.b[0]!, f.a[1]!, t + 10, 3], ['a3', f.b[0]!, f.a[2]!, t + 20, 4],
      ['a4', f.b[0]!, f.a[3]!, t + 30, 5], ['a5', f.b[0]!, f.a[4]!, t + 40, 6],
      ['b1', f.a[0]!, f.b[0]!, t + 50, 7], ['b2', f.a[0]!, f.b[1]!, t + 60, 8],
      ['a1', f.b[2]!, f.a[0]!, t + 70, 9],
    ]);
    const result = timeline(f);
    expect(result.clutchOpportunities.find((row) => row.playerId === f.a[0]))
      .toMatchObject({ opponentsAtStart: 3, outcome: 'CLUTCH_LOST', survived: false });
    expect(result.usefulLostRoundActions.filter((row) => row.playerId === f.a[0])).toHaveLength(2);
  });

  it('22. keeps clutch outcome unavailable when the normalized winner is unknown', () => {
    const f = fixture();
    const t = f.evidence.liveStart;
    f.round.winnerTeamId = null;
    deathsAt(f, [
      ['a2', f.b[0]!, f.a[1]!, t + 10, 1], ['a3', f.b[0]!, f.a[2]!, t + 20, 2],
      ['a4', f.b[0]!, f.a[3]!, t + 30, 3], ['a5', f.b[0]!, f.a[4]!, t + 40, 4],
    ]);
    expect(timeline(f).clutchOpportunities.find((row) => row.playerId === f.a[0])?.outcome)
      .toBe('CLUTCH_OUTCOME_UNAVAILABLE');
  });

  it('23. records confirmed survival in a lost round without calling it useful', () => {
    const f = fixture();
    f.round.winnerTeamId = f.teamB;
    const survivor = timeline(f).survival.find((row) => row.playerId === f.a[0]);
    expect(survivor).toMatchObject({ state: 'ALIVE_CONFIRMED', roundResult: 'LOSS' });
  });

  it('24. downgrades coverage on divergence from a confirmed alive snapshot', () => {
    const f = fixture([{ id: 'kill', aliveByTeamId: {} }]);
    f.match.events[0]!.context!.aliveByTeamId = { [f.teamA]: 5, [f.teamB]: 5 };
    expect(timeline(f)).toMatchObject({ coverageStatus: 'PARTIAL' });
  });

  it('25. does not need or invent a tick rate for ordinal state reconstruction', () => {
    const f = fixture([{ id: 'kill' }]);
    f.match.tickRate = null;
    const result = timeline(f);
    expect(result.timeline.at(-1)!.after.exactAliveCountByTeamId[f.teamB]).toBe(4);
    expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/);
  });

  it('26. excludes an event after the verified LIVE boundary', () => {
    const f = fixture([{ id: 'late', tick: 999_999 }]);
    const result = reconstructRoundTimelines(f.match, [f.evidence]);
    expect(result.diagnostics.excludedOutsideBoundaryEventIds).toEqual(['late']);
    expect(result.rounds[0]!.terminalState.state!.exactAliveCountByTeamId[f.teamB]).toBe(5);
  });

  it('27. never applies two different death events to the same already-dead player', () => {
    const f = fixture();
    deathsAt(f, [
      ['first', f.a[0]!, f.b[0]!, 1_100, 1],
      ['second', f.a[1]!, f.b[0]!, 1_200, 2],
    ]);
    const result = timeline(f);
    expect(result.terminalState.state!.exactAliveCountByTeamId[f.teamB]).toBe(4);
    expect(result.diagnostics).toContain('UNKNOWN_OR_ALREADY_DEAD_VICTIM');
  });

  it('28. is invariant to permutation of the normalized event array', () => {
    const f = fixture();
    deathsAt(f, [
      ['one', f.a[0]!, f.b[0]!, 1_100, 1],
      ['two', f.b[1]!, f.a[0]!, 1_200, 2],
    ]);
    const reversed = structuredClone(f.match);
    reversed.events.reverse();
    expect(reconstructRoundTimelines(reversed, [f.evidence]))
      .toEqual(reconstructRoundTimelines(f.match, [f.evidence]));
  });

  it('29. emits only evidence references present in normalized or supplemental input', () => {
    const f = fixture([{ id: 'kill' }, { id: 'plant', kind: 'BOMB_PLANTED', rowIndex: 2 }]);
    const known = new Set(f.match.events.map((event) => event.id));
    const references = timeline(f).timeline.flatMap((entry) => entry.eventIds);
    expect(references.every((id) => known.has(id))).toBe(true);
  });

  it('30. leaves production H2, M2 and EVP inputs unchanged', () => {
    const f = fixture([{ id: 'kill' }]);
    const generatedAt = '2026-11-18T00:00:00.000Z';
    const profile = zeroPreparedProfile(f);
    const artifact = {
      schemaVersion: 'm2-artifact-1' as const,
      match: f.match,
      analytics: computeMatchAnalytics(f.match, generatedAt),
    };
    const participation = f.match.players.map((player) => ({
      playerId: player.id, eligible: true, verifiedRounds: 1, unknownRounds: 0, reasonCodes: [],
    }));
    const beforeMatch = structuredClone(f.match);
    const h2 = projectParticipationRatings([profile]);
    const m2 = structuredClone(artifact.analytics);
    const evp = prepareEvpMatchInput({ artifact, participation, mvpPlayerId: null, scenario: 'BOMB' });
    reconstructRoundTimelines(f.match, [f.evidence]);
    expect(f.match).toEqual(beforeMatch);
    expect(projectParticipationRatings([profile])).toEqual(h2);
    expect(computeMatchAnalytics(f.match, generatedAt)).toEqual(m2);
    expect(prepareEvpMatchInput({ artifact, participation, mvpPlayerId: null, scenario: 'BOMB' })).toEqual(evp);
  });

  it('31. withholds attributed advantage and lost-round credit when the actor is already dead', () => {
    const f = fixture();
    f.round.winnerTeamId = f.teamB;
    deathsAt(f, [
      ['actor-dies', f.b[0]!, f.a[0]!, 1_100, 1],
      ['dead-actor-row', f.a[0]!, f.b[0]!, 1_200, 2],
    ]);
    const result = timeline(f);
    const suspect = result.timeline.at(-1)!;
    expect(suspect.stateChangeConfidence).toBe('PARTIAL');
    expect(suspect.attributionConfidence).toBe('PARTIAL');
    expect(suspect.uncertaintyReasons).toContain('ACTOR_ALREADY_DEAD');
    expect(suspect.advantage).toBeNull();
    expect(result.usefulLostRoundActions.some((row) => row.eventId === 'dead-actor-row')).toBe(false);
  });
});
