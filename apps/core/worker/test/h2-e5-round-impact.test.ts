import { describe, expect, it } from 'vitest';
import type { MatchData, MatchEvent, MatchRound } from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import { prepareEvpMatchInput, projectParticipationRatings } from '@who-ruined/scoring';
import { syntheticValidMatch } from '@who-ruined/testkit';

import { buildCanonicalTradeLinks } from '@who-ruined/scoring/h3';
import { extractUtilityEvidence } from '@who-ruined/scoring/h3';
import {
  H2_E4_TIMELINE_CONTRACT_VERSION,
  reconstructRoundTimelines,
  type RoundStartEvidence,
} from '@who-ruined/scoring/h3';
import {
  H2_E5_ROUND_IMPACT_CONTRACT_VERSION,
  evaluateH2E5Experiment,
  type H2E5ResearchProfile,
  type ImpactModelId,
  type RoundImpactResearchContract,
} from '@who-ruined/scoring/h3';

type SyntheticEvent = {
  id: string;
  kind?: string;
  tick?: number;
  rowIndex?: number;
  actorId?: string | null | undefined;
  targetId?: string | null | undefined;
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

function makeEvent(f: Fixture, input: SyntheticEvent): MatchEvent {
  const teamByPlayer = new Map(f.match.players.map((player) => [player.id, player.teamId]));
  const actorId = input.actorId === undefined ? f.a[0]! : input.actorId;
  const targetId = input.targetId === undefined ? f.b[0]! : input.targetId;
  const actorTeamId = actorId ? teamByPlayer.get(actorId) ?? null : null;
  const targetTeamId = targetId ? teamByPlayer.get(targetId) ?? null : null;
  return {
    id: input.id,
    kind: input.kind ?? 'PLAYER_DEATH',
    roundId: f.round.id,
    tick: input.tick ?? (f.round.freezeEndTick ?? f.round.startTick) + 100,
    actorId,
    targetId,
    assisterId: null,
    attrs: {},
    context: {
      phase: 'LIVE', actorTeamId, targetTeamId,
      actorSide: actorTeamId ? f.round.sideByTeamId[actorTeamId] ?? null : null,
      targetSide: targetTeamId ? f.round.sideByTeamId[targetTeamId] ?? null : null,
      aliveByTeamId: null, secondsFromFreezeEnd: null, bombState: null,
      actorEquipmentValue: null, actorMoney: null,
    },
    source: { eventName: (input.kind ?? 'PLAYER_DEATH').toLowerCase(), rowIndex: input.rowIndex ?? 1 },
  };
}

function fixture(
  inputs: readonly SyntheticEvent[] = [],
  options: { aAlive?: number; bAlive?: number; scenario?: 'BOMB' | 'HOSTAGE'; winner?: 'A' | 'B' | null } = {},
): Fixture {
  const match = syntheticValidMatch();
  const round = match.rounds[0]!;
  const teamA = match.teams[0]!.id;
  const teamB = match.teams[1]!.id;
  const a = [...match.teams[0]!.playerIds];
  const b = [...match.teams[1]!.playerIds];
  const f = { match, round, teamA, teamB, a, b } as Fixture;
  round.winnerTeamId = options.winner === null ? null : options.winner === 'B' ? teamB : teamA;
  match.events = inputs.map((input) => makeEvent(f, input));
  const alive = new Set([
    ...a.slice(0, options.aAlive ?? 5),
    ...b.slice(0, options.bAlive ?? 5),
  ]);
  f.evidence = {
    roundId: round.id,
    liveStart: round.freezeEndTick ?? round.startTick,
    liveEnd: round.endTick,
    boundaryComplete: true,
    boundaryReasons: [],
    scenario: options.scenario ?? 'BOMB',
    players: match.players.map((player) => ({
      playerId: player.id,
      classification: 'PRESENT_VERIFIED',
      counted: true,
      startObserved: true,
      startAlive: alive.has(player.id),
    })),
    supplementalEvents: [],
  };
  return f;
}

function setEvents(f: Fixture, inputs: readonly SyntheticEvent[]): void {
  f.match.events = inputs.map((input) => makeEvent(f, input));
}

function profile(
  f: Fixture,
  options: {
    playerId?: string;
    anchorId?: string | undefined;
    tags?: string[];
    scenario?: 'BOMB' | 'HOSTAGE';
    objectiveSignals?: Record<string, number>;
  } = {},
): H2E5ResearchProfile {
  const playerId = options.playerId ?? f.a[0]!;
  const row = {
    status: 'CALCULATED_RESEARCH_ONLY' as const,
    reason: null,
    familyContributions: { COMBAT: 0.01, SUPPORT: 0, DEATH_RELATED: 0, DIRECT_HARM: 0 },
    objectiveSignals: options.objectiveSignals ?? (options.scenario === 'HOSTAGE'
      ? { 'objective:hostageRescues': 0, 'objective:hostageHurts': 0 }
      : { 'objective:plants': 0, 'objective:defuses': 0 }),
    episodeContributions: options.anchorId ? [{
      anchorId: options.anchorId,
      chosenAxis: 'enemyHp',
      family: 'COMBAT' as const,
      base: 0.1,
      tags: options.tags ?? [],
    }] : [],
  };
  return {
    profileKey: `synthetic:${playerId}`,
    playerId,
    teamId: f.match.players.find((player) => player.id === playerId)!.teamId,
    status: 'ELIGIBLE',
    reason: null,
    countedRoundIds: [f.round.id],
    prepared: {
      profileKey: `synthetic:${playerId}`,
      scenario: options.scenario ?? 'BOMB',
      p4BPlus: structuredClone(row),
      p4CPlus: structuredClone(row),
    },
  };
}

function experiment(f: Fixture, profiles: H2E5ResearchProfile[] = [profile(f, { anchorId: 'kill' })]) {
  const timeline = reconstructRoundTimelines(f.match, [f.evidence]);
  return evaluateH2E5Experiment(f.match, timeline, profiles);
}

function model(value: RoundImpactResearchContract, id: ImpactModelId) {
  return value.models.find((row) => row.modelId === id)!;
}

function r1(value: RoundImpactResearchContract, playerId: string): number | null {
  return model(value, 'E5_R1_STATE_CONTEXT').projections
    .find((row) => row.playerId === playerId)!.impactContribution;
}

describe('H2-E5 round impact research (explicitly synthetic fixtures)', () => {
  it('1. classifies 5v5 to 5v4 as one anchored advantage creation', () => {
    const f = fixture([{ id: 'kill' }]);
    const value = experiment(f);
    expect(value.candidates).toMatchObject([{
      sourceEventId: 'kill', primaryCategory: 'ADVANTAGE_CREATION',
      confirmedEvidenceReferences: ['kill'],
    }]);
    expect(r1(value, f.a[0]!)).toBeCloseTo(0.012, 12);
  });

  it('2. treats 5v2 to 5v1 as lower-value consolidation', () => {
    const f = fixture([{ id: 'kill' }], { bAlive: 2 });
    const value = experiment(f);
    expect(value.candidates[0]!.primaryCategory).toBe('ADVANTAGE_CONSOLIDATION');
    expect(r1(value, f.a[0]!)).toBeCloseTo(0.005, 12);
  });

  it('3. classifies 2v4 to 2v3 as disadvantage recovery', () => {
    const f = fixture([{ id: 'kill' }], { aAlive: 2, bAlive: 4 });
    const value = experiment(f);
    expect(value.candidates[0]!.primaryCategory).toBe('ADVANTAGE_RECOVERY');
    expect(r1(value, f.a[0]!)).toBeCloseTo(0.012, 12);
  });

  it('4. classifies 2v3 to 2v2 as equality restoration', () => {
    const f = fixture([{ id: 'kill' }], { aAlive: 2, bAlive: 3 });
    const value = experiment(f);
    expect(value.candidates[0]!.primaryCategory).toBe('EQUALITY_RESTORATION');
    expect(r1(value, f.a[0]!)).toBeCloseTo(0.016, 12);
  });

  it('5. classifies 2v2 to 2v1 as advantage creation', () => {
    const f = fixture([{ id: 'kill' }], { aAlive: 2, bAlive: 2 });
    expect(experiment(f).candidates[0]!.primaryCategory).toBe('ADVANTAGE_CREATION');
  });

  it('6. preserves two confirmed improvements in a lost 1v3 sequence', () => {
    const f = fixture([], { aAlive: 1, bAlive: 3, winner: 'B' });
    setEvents(f, [
      { id: 'kill', actorId: f.a[0], targetId: f.b[0], tick: 1_100, rowIndex: 1 },
      { id: 'kill-2', actorId: f.a[0], targetId: f.b[1], tick: 1_200, rowIndex: 2 },
      { id: 'death', actorId: f.b[2], targetId: f.a[0], tick: 1_300, rowIndex: 3 },
    ]);
    const value = experiment(f);
    expect(value.candidates.filter((row) => row.playerId === f.a[0]).map((row) => row.roundOutcome))
      .toEqual(['LOSS', 'LOSS']);
    expect(value.diagnostics.lostRoundCandidateCount).toBeGreaterThanOrEqual(2);
  });

  it('7. labels a won 1v2 without duplicating its kill candidates', () => {
    const f = fixture([], { aAlive: 1, bAlive: 2, winner: 'A' });
    setEvents(f, [
      { id: 'kill', actorId: f.a[0], targetId: f.b[0], tick: 1_100, rowIndex: 1 },
      { id: 'kill-2', actorId: f.a[0], targetId: f.b[1], tick: 1_200, rowIndex: 2 },
    ]);
    const value = experiment(f);
    expect(value.candidates).toHaveLength(2);
    expect(value.candidates.some((row) => row.categories.includes('CLUTCH_PROGRESSION'))).toBe(true);
    expect(value.candidates.some((row) => row.categories.includes('SURVIVAL_CONTEXT'))).toBe(true);
  });

  it('8. recognizes a confirmed won 1v4 progression', () => {
    const f = fixture([], { aAlive: 1, bAlive: 4, winner: 'A' });
    setEvents(f, f.b.slice(0, 4).map((targetId, index) => ({
      id: index === 0 ? 'kill' : `kill-${index + 1}`,
      actorId: f.a[0], targetId, tick: 1_100 + index * 100, rowIndex: index + 1,
    })));
    const value = experiment(f);
    expect(value.candidates.filter((row) => row.categories.includes('CLUTCH_PROGRESSION'))).toHaveLength(4);
  });

  it('9. does not invent a clutch outcome when the normalized winner is unknown', () => {
    const f = fixture([{ id: 'kill' }], { aAlive: 1, bAlive: 2, winner: null });
    const timeline = reconstructRoundTimelines(f.match, [f.evidence]);
    expect(timeline.rounds[0]!.clutchOpportunities[0]!.outcome).toBe('CLUTCH_OUTCOME_UNAVAILABLE');
    expect(evaluateH2E5Experiment(f.match, timeline, [profile(f, { anchorId: 'kill' })])
      .candidates[0]!.roundOutcome).toBe('UNKNOWN');
  });

  it('10. gives ordinary survival without actions no impact candidate', () => {
    const f = fixture([]);
    expect(experiment(f).candidates).toEqual([]);
  });

  it('11. attaches survival context only to a confirmed postplant action', () => {
    const f = fixture([{ id: 'plant', kind: 'BOMB_PLANTED', targetId: null }]);
    const value = experiment(f, [profile(f, { anchorId: undefined })]);
    expect(value.candidates[0]).toMatchObject({ actionType: 'BOMB_PLANTED' });
    expect(value.candidates[0]!.categories).toContain('SURVIVAL_CONTEXT');
  });

  it('12. rejects impact from a partial round', () => {
    const f = fixture([{ id: 'kill' }]);
    f.evidence.players[0]!.startAlive = null;
    expect(experiment(f).candidates).toEqual([]);
    expect(experiment(f).diagnostics.rejectedByReason).toHaveProperty('ROUND_PARTIAL');
  });

  it('13. rejects impact from an excluded round', () => {
    const f = fixture([{ id: 'kill' }]);
    f.evidence.boundaryComplete = false;
    expect(experiment(f).diagnostics.rejectedByReason).toHaveProperty('ROUND_EXCLUDED');
  });

  it('14. rejects impact when an alive pre-state is unknown', () => {
    const f = fixture([{ id: 'kill' }]);
    f.evidence.players = f.evidence.players.filter((row) => row.playerId !== f.b[4]);
    expect(experiment(f).diagnostics.rejectedByReason).toHaveProperty('PRE_STATE_NOT_CONFIRMED');
  });

  it('15. closes the E4 actor-already-dead confidence gap', () => {
    const f = fixture([]);
    setEvents(f, [
      { id: 'actor-death', actorId: f.b[0], targetId: f.a[0], tick: 1_100, rowIndex: 1 },
      { id: 'kill', actorId: f.a[0], targetId: f.b[0], tick: 1_200, rowIndex: 2 },
    ]);
    const timeline = reconstructRoundTimelines(f.match, [f.evidence]);
    const suspect = timeline.rounds[0]!.timeline.at(-1)!;
    expect(suspect.attributionConfidence).toBe('PARTIAL');
    expect(suspect.advantage).toBeNull();
    expect(evaluateH2E5Experiment(f.match, timeline, [profile(f, { anchorId: 'kill' })])
      .candidates.some((row) => row.sourceEventId === 'kill')).toBe(false);
  });

  it('16. rejects unknown target/team attribution', () => {
    const f = fixture([{ id: 'kill', targetId: 'unknown-player' }]);
    expect(experiment(f).diagnostics.rejectedByReason).toHaveProperty('ACTION_ATTRIBUTION_NOT_CONFIRMED');
  });

  it('17. rejects an atomic same-tick transition as non-attributable', () => {
    const f = fixture([]);
    setEvents(f, [
      { id: 'kill', actorId: f.a[0], targetId: f.b[0], tick: 1_100, rowIndex: 1 },
      { id: 'other', actorId: f.b[1], targetId: f.a[1], tick: 1_100, rowIndex: 1 },
    ]);
    expect(experiment(f).diagnostics.rejectedByReason).toHaveProperty('EVENT_ORDER_NOT_ATTRIBUTABLE');
  });

  it('18. accepts uniquely ordered same-tick transitions independently', () => {
    const f = fixture([]);
    setEvents(f, [
      { id: 'kill', actorId: f.a[0], targetId: f.b[0], tick: 1_100, rowIndex: 1 },
      { id: 'kill-2', actorId: f.a[0], targetId: f.b[1], tick: 1_100, rowIndex: 2 },
    ]);
    expect(experiment(f).candidates.map((row) => row.sourceEventId)).toEqual(['kill', 'kill-2']);
  });

  it('19. rejects every occurrence of a duplicated event ID', () => {
    const f = fixture([]);
    setEvents(f, [
      { id: 'kill', targetId: f.b[0], tick: 1_100, rowIndex: 1 },
      { id: 'kill', targetId: f.b[1], tick: 1_200, rowIndex: 2 },
    ]);
    const value = experiment(f);
    expect(value.candidates).toEqual([]);
    expect(value.diagnostics.rejectedByReason.DUPLICATE_EVENT_ID).toBe(1);
  });

  it('20. stores multiple labels on one kill but only one proposed attribution', () => {
    const f = fixture([{ id: 'kill' }], { aAlive: 1, bAlive: 2, winner: 'A' });
    const value = experiment(f);
    expect(value.candidates).toHaveLength(1);
    expect(value.candidates[0]!.categories).toEqual(expect.arrayContaining([
      'EQUALITY_RESTORATION', 'CLUTCH_PROGRESSION', 'SURVIVAL_CONTEXT',
    ]));
    expect(value.attributionLedger).toHaveLength(1);
  });

  it('21. records trade overlap without creating a second impact event', () => {
    const f = fixture([{ id: 'kill' }]);
    const value = experiment(f, [profile(f, { anchorId: 'kill', tags: ['TRADE'] })]);
    expect(value.candidates).toHaveLength(1);
    expect(value.attributionLedger[0]!.originalContextTags).toContain('TRADE');
  });

  it('22. records opening overlap on the same evidence anchor', () => {
    const f = fixture([{ id: 'kill' }]);
    const value = experiment(f, [profile(f, { anchorId: 'kill', tags: ['OPENING'] })]);
    expect(value.attributionLedger[0]).toMatchObject({ sourceEventId: 'kill', semanticOverlap: 'PARTIAL' });
  });

  it('23. records multikill overlap without multiplying candidate count', () => {
    const f = fixture([{ id: 'kill' }]);
    const value = experiment(f, [profile(f, { anchorId: 'kill', tags: ['MULTI_KILL'] })]);
    expect(value.candidates).toHaveLength(1);
    expect(value.attributionLedger[0]!.originalContextTags).toContain('MULTI_KILL');
  });

  it('24. represents bomb plant/postplant as one objective state change', () => {
    const f = fixture([{ id: 'plant', kind: 'BOMB_PLANTED', targetId: null }]);
    const value = experiment(f, [profile(f)]);
    expect(value.candidates).toMatchObject([{
      sourceEventId: 'plant', actionType: 'BOMB_PLANTED', objectivePhase: 'POSTPLANT',
    }]);
  });

  it('25. accepts a confirmed hostage rescue from prepared supplemental evidence', () => {
    const f = fixture([], { scenario: 'HOSTAGE' });
    f.evidence.supplementalEvents = [{
      id: 'hostage-rescue', roundId: f.round.id, tick: 1_100,
      kind: 'HOSTAGE_RESCUED', actorId: f.a[0]!,
    }];
    const value = experiment(f, [profile(f, { scenario: 'HOSTAGE' })]);
    expect(value.candidates[0]).toMatchObject({
      sourceEventId: 'hostage-rescue', actionType: 'HOSTAGE_RESCUED',
    });
  });

  it('26. gives zero R2 increment when H2 already fully accounts for alive-lead creation', () => {
    const f = fixture([{ id: 'kill' }]);
    const value = experiment(f, [profile(f, { anchorId: 'kill', tags: ['ALIVE_LEAD_TAKEN'] })]);
    expect(value.attributionLedger[0]).toMatchObject({
      semanticOverlap: 'FULL', incrementalAttribution: 0,
      inclusion: 'EXCLUDED_FULLY_ACCOUNTED',
    });
    expect(model(value, 'E5_R2_MARGINAL_H2').projections[0]!.impactContribution).toBe(0);
  });

  it('27. applies a deterministic per-round cap after diminishing returns', () => {
    const f = fixture([]);
    const start = f.evidence.liveStart;
    setEvents(f, Array.from({ length: 12 }, (_, index) => ({
      id: `${index % 2 === 0 ? 'plant' : 'defuse'}-${index + 1}`,
      kind: index % 2 === 0 ? 'BOMB_PLANTED' : 'BOMB_DEFUSED',
      targetId: null,
      tick: start + (index + 1) * 10,
      rowIndex: index + 1,
    })));
    const value = experiment(f, [profile(f)]);
    const round = model(value, 'E5_R1_STATE_CONTEXT').projections[0]!.rounds[0]!;
    expect(round.capped).toBe(true);
    expect(round.contribution).toBeLessThanOrEqual(0.05);
  });

  it('28. returns an empty evidence set when no reliable impact facts exist', () => {
    const f = fixture([]);
    const value = experiment(f);
    expect(value.candidates).toEqual([]);
    expect(r1(value, f.a[0]!)).toBe(0);
  });

  it('29. is invariant to permutation of the normalized event array', () => {
    const f = fixture([]);
    setEvents(f, [
      { id: 'kill', targetId: f.b[0], tick: 1_100, rowIndex: 1 },
      { id: 'kill-2', targetId: f.b[1], tick: 1_200, rowIndex: 2 },
    ]);
    const left = experiment(f);
    f.match.events.reverse();
    const right = experiment(f);
    expect(right).toEqual(left);
  });

  it('30. leaves current H2, M2 and EVP inputs and outputs unchanged', () => {
    const f = fixture([{ id: 'kill' }]);
    const p = profile(f, { anchorId: 'kill' });
    const generatedAt = '2026-11-22T00:00:00.000Z';
    const artifact = { schemaVersion: 'm2-artifact-1' as const, match: f.match, analytics: computeMatchAnalytics(f.match, generatedAt) };
    const participation = f.match.players.map((player) => ({
      playerId: player.id, eligible: true, verifiedRounds: 1, unknownRounds: 0, reasonCodes: [],
    }));
    const before = {
      match: structuredClone(f.match),
      profile: structuredClone(p),
      h2: projectParticipationRatings([p]),
      m2: computeMatchAnalytics(f.match, generatedAt),
      evp: prepareEvpMatchInput({ artifact, participation, mvpPlayerId: null, scenario: 'BOMB' }),
    };
    experiment(f, [p]);
    expect(f.match).toEqual(before.match);
    expect(p).toEqual(before.profile);
    expect(projectParticipationRatings([p])).toEqual(before.h2);
    expect(computeMatchAnalytics(f.match, generatedAt)).toEqual(before.m2);
    expect(prepareEvpMatchInput({ artifact, participation, mvpPlayerId: null, scenario: 'BOMB' })).toEqual(before.evp);
  });

  it('31. reconstructs every experimental rating exactly from baseline plus attribution', () => {
    const f = fixture([{ id: 'kill' }]);
    for (const row of experiment(f).models.flatMap((entry) => entry.projections)) {
      expect(row.reconstructionError).toBe(0);
      if (row.experimentalRating !== null) {
        expect(row.experimentalRating).toBeCloseTo(row.baselineRating! + row.impactContribution!, 12);
      }
    }
  });

  it('32. never emits NaN or Infinity across all three projections', () => {
    const f = fixture([{ id: 'kill' }], { aAlive: 1, bAlive: 5 });
    const serialized = JSON.stringify(experiment(f));
    expect(serialized).not.toMatch(/NaN|Infinity/);
  });

  it('33. composes with the unchanged E1-E4 research contracts', () => {
    const f = fixture([{ id: 'kill' }]);
    const timeline = reconstructRoundTimelines(f.match, [f.evidence]);
    const trades = buildCanonicalTradeLinks(f.match);
    const utility = extractUtilityEvidence(f.match);
    const value = evaluateH2E5Experiment(f.match, timeline, [profile(f, { anchorId: 'kill' })]);
    expect(timeline.schemaVersion).toBe(H2_E4_TIMELINE_CONTRACT_VERSION);
    expect(trades.schemaVersion).toBe('h2-e2-canonical-trade@1-research');
    expect(utility.schemaVersion).toBe('h2-e3-utility-contribution@1-research');
    expect(value.schemaVersion).toBe(H2_E5_ROUND_IMPACT_CONTRACT_VERSION);
  });
});
