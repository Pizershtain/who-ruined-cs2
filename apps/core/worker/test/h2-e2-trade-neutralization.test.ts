import { describe, expect, it } from 'vitest';
import type { MatchData, MatchEvent, MatchRound } from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import type {
  ParsedDemoSnapshot,
  ParsedParticipationSupplement,
} from '@who-ruined/parser-adapter';
import { PARTICIPATION_FAMILY_POLICY, projectParticipationRatings, toParticipationRatingPreparedProfiles } from '@who-ruined/scoring';
import { syntheticValidMatch } from '@who-ruined/testkit';

import { buildPreparedParticipationInput } from '../src/prepared-participation-input.js';
import {
  buildCanonicalTradeLinks,
  evaluateH2E2Experiment,
  type H2E2ResearchProfile,
} from '@who-ruined/scoring/h3';

type DeathInput = {
  id: string;
  tick: number;
  actorId: string | null;
  targetId: string | null;
  rowIndex: number;
  roundId?: string | undefined;
  phase?: NonNullable<MatchEvent['context']>['phase'];
  friendlyFire?: boolean;
  suicide?: boolean;
};

type SyntheticFixture = {
  match: MatchData;
  snapshot: ParsedDemoSnapshot;
  supplement: ParsedParticipationSupplement;
  round: MatchRound;
  players: {
    a1: string;
    a2: string;
    a3: string;
    a4: string;
    b1: string;
    b2: string;
    b3: string;
    b4: string;
  };
};

function makeFixture(
  inputs: readonly DeathInput[],
  options: { tickRate?: number | null } = {},
): SyntheticFixture {
  const match = syntheticValidMatch();
  const round = match.rounds[0]!;
  const [a1, a2, a3, a4] = match.teams[0]!.playerIds;
  const [b1, b2, b3, b4] = match.teams[1]!.playerIds;
  const teamByPlayer = new Map(match.players.map((player) => [player.id, player.teamId]));
  const roundById = new Map(match.rounds.map((candidate) => [candidate.id, candidate]));
  match.tickRate = options.tickRate === undefined ? 64 : options.tickRate;
  match.events = inputs.map((input): MatchEvent => {
    const eventRound = roundById.get(input.roundId ?? round.id) ?? round;
    const actorTeamId = input.actorId ? teamByPlayer.get(input.actorId) ?? null : null;
    const targetTeamId = input.targetId ? teamByPlayer.get(input.targetId) ?? null : null;
    return {
      id: input.id,
      kind: 'PLAYER_DEATH',
      roundId: eventRound.id,
      tick: input.tick,
      actorId: input.actorId,
      targetId: input.targetId,
      assisterId: null,
      attrs: {
        friendlyFire: input.friendlyFire ?? false,
        suicide: input.suicide ?? false,
      },
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

  const boundaryRows = match.rounds.flatMap((candidate) => [
    { event_name: 'round_freeze_end', tick: candidate.freezeEndTick },
    { event_name: 'round_end', tick: candidate.endTick },
    { event_name: 'round_officially_ended', tick: candidate.endTick },
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
    events: boundaryRows,
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
    players: {
      a1: a1!,
      a2: a2!,
      a3: a3!,
      a4: a4!,
      b1: b1!,
      b2: b2!,
      b3: b3!,
      b4: b4!,
    },
  };
}

function preparedProfiles(fixture: SyntheticFixture): H2E2ResearchProfile[] {
  const prepared = buildPreparedParticipationInput(
    fixture.snapshot,
    fixture.match,
    fixture.supplement,
    { allowIncompleteRoster: true },
  );
  const countedRoundIds = fixture.match.rounds.filter((round) => round.isValid).map((round) => round.id);
  const profiles = toParticipationRatingPreparedProfiles(prepared.preparedProfiles.map((profile) => ({
    profileKey: profile.profileKey,
    playerId: profile.playerId,
    teamId: profile.teamId,
    status: 'ELIGIBLE',
    reason: null,
    prepared: profile,
  })));
  return profiles.map((profile) => ({ ...profile, countedRoundIds }));
}

function basePlayers(): SyntheticFixture['players'] {
  return makeFixture([]).players;
}

function tradePair(
  options: { roundId?: string; originalId?: string; revengeId?: string; start?: number } = {},
): DeathInput[] {
  const players = basePlayers();
  const start = options.start ?? 1_200;
  return [
    {
      id: options.originalId ?? 'original',
      tick: start,
      actorId: players.a1,
      targetId: players.b1,
      rowIndex: 10,
      roundId: options.roundId,
    },
    {
      id: options.revengeId ?? 'revenge',
      tick: start + 32,
      actorId: players.b2,
      targetId: players.a1,
      rowIndex: 11,
      roundId: options.roundId,
    },
  ];
}

function projectionFor(
  rows: ReturnType<typeof projectParticipationRatings>,
  playerId: string,
) {
  return rows.find((row) => row.playerId === playerId);
}

describe('H2-E2 canonical trade contract (synthetic)', () => {
  it('does not create a trade for an untraded death', () => {
    const players = basePlayers();
    const fixture = makeFixture([{
      id: 'death', tick: 1_200, actorId: players.a1, targetId: players.b1, rowIndex: 1,
    }]);
    expect(buildCanonicalTradeLinks(fixture.match).links).toEqual([]);
  });

  it('confirms a traded opening death', () => {
    const fixture = makeFixture(tradePair());
    expect(buildCanonicalTradeLinks(fixture.match).links).toMatchObject([{
      originalDeathEventId: 'original',
      revengeDeathEventId: 'revenge',
      victimPlayerId: fixture.players.b1,
      traderPlayerId: fixture.players.b2,
    }]);
  });

  it('confirms a traded non-opening death', () => {
    const players = basePlayers();
    const fixture = makeFixture([
      { id: 'earlier', tick: 1_150, actorId: players.a3, targetId: players.b3, rowIndex: 1 },
      ...tradePair(),
    ]);
    expect(buildCanonicalTradeLinks(fixture.match).links.map((link) => link.originalDeathEventId))
      .toContain('original');
  });

  it('includes exactly five seconds', () => {
    const pair = tradePair();
    pair[1] = { ...pair[1]!, tick: pair[0]!.tick + 320 };
    expect(buildCanonicalTradeLinks(makeFixture(pair).match).links).toHaveLength(1);
  });

  it('excludes more than five seconds', () => {
    const pair = tradePair();
    pair[1] = { ...pair[1]!, tick: pair[0]!.tick + 321 };
    expect(buildCanonicalTradeLinks(makeFixture(pair).match).links).toHaveLength(0);
  });

  it('marks an unknown tick rate unavailable instead of assuming one', () => {
    const result = buildCanonicalTradeLinks(makeFixture(tradePair(), { tickRate: null }).match);
    expect(result).toMatchObject({
      availability: { status: 'UNAVAILABLE', reason: 'TICK_RATE_UNAVAILABLE' },
      links: [],
    });
  });

  it('rejects same-tick by default and exposes the row-order research option', () => {
    const pair = tradePair();
    pair[1] = { ...pair[1]!, tick: pair[0]!.tick, rowIndex: pair[0]!.rowIndex + 1 };
    const fixture = makeFixture(pair);
    expect(buildCanonicalTradeLinks(fixture.match).links).toEqual([]);
    expect(buildCanonicalTradeLinks(fixture.match, { sameTickPolicy: 'ROW_INDEX_ORDERED' }).links)
      .toMatchObject([{ delayTicks: 0, delaySeconds: 0, confirmationState: 'CONFIRMED_ROW_INDEX_ORDER' }]);
  });

  it('uses one revenge for at most one of two original deaths', () => {
    const players = basePlayers();
    const fixture = makeFixture([
      { id: 'original-1', tick: 1_180, actorId: players.a1, targetId: players.b1, rowIndex: 1 },
      { id: 'original-2', tick: 1_190, actorId: players.a1, targetId: players.b3, rowIndex: 2 },
      { id: 'revenge', tick: 1_200, actorId: players.b2, targetId: players.a1, rowIndex: 3 },
    ]);
    const result = buildCanonicalTradeLinks(fixture.match);
    expect(result.links).toHaveLength(1);
    expect(result.links[0]!.originalDeathEventId).toBe('original-2');
  });

  it('maximizes cardinality before delay with competing revenge events', () => {
    const players = basePlayers();
    const fixture = makeFixture([
      { id: 'original-1', tick: 1_000, actorId: players.a1, targetId: players.b1, rowIndex: 1 },
      { id: 'original-2', tick: 1_100, actorId: players.a1, targetId: players.b3, rowIndex: 2 },
      { id: 'original-3', tick: 1_200, actorId: players.a1, targetId: players.b4, rowIndex: 3 },
      { id: 'revenge-1', tick: 1_250, actorId: players.b2, targetId: players.a1, rowIndex: 4 },
      { id: 'revenge-2', tick: 1_260, actorId: players.b3, targetId: players.a1, rowIndex: 5 },
    ]);
    const links = buildCanonicalTradeLinks(fixture.match).links;
    expect(links).toHaveLength(2);
    expect(links.map((link) => link.originalDeathEventId).sort()).toEqual(['original-2', 'original-3']);
  });

  it('allows one kill to finish a trade and start a later trade', () => {
    const players = basePlayers();
    const fixture = makeFixture([
      { id: 'first', tick: 1_200, actorId: players.a1, targetId: players.b1, rowIndex: 1 },
      { id: 'second', tick: 1_220, actorId: players.b2, targetId: players.a1, rowIndex: 2 },
      { id: 'third', tick: 1_240, actorId: players.a2, targetId: players.b2, rowIndex: 3 },
    ]);
    expect(buildCanonicalTradeLinks(fixture.match).links.map((link) => [
      link.originalDeathEventId,
      link.revengeDeathEventId,
    ])).toEqual([['first', 'second'], ['second', 'third']]);
  });

  it('rejects every occurrence of a duplicate event ID', () => {
    const fixture = makeFixture([
      ...tradePair(),
      { ...tradePair()[1]!, rowIndex: 12 },
    ]);
    const result = buildCanonicalTradeLinks(fixture.match);
    expect(result.links).toEqual([]);
    expect(result.diagnostics.rejectedDuplicateEventIds).toEqual(['revenge']);
  });

  it('rejects unknown teams', () => {
    const fixture = makeFixture([
      ...tradePair().slice(0, 1),
      { ...tradePair()[1]!, actorId: 'unknown-player' },
    ]);
    expect(buildCanonicalTradeLinks(fixture.match).links).toEqual([]);
  });

  it('rejects non-live deaths', () => {
    const pair = tradePair();
    pair[1] = { ...pair[1]!, phase: 'POST_ROUND' };
    expect(buildCanonicalTradeLinks(makeFixture(pair).match).links).toEqual([]);
  });

  it('does not treat suicide or team death as enemy-kill evidence', () => {
    const players = basePlayers();
    const fixture = makeFixture([
      { id: 'suicide', tick: 1_100, actorId: players.a1, targetId: players.a1, rowIndex: 1, suicide: true },
      { id: 'team-death', tick: 1_120, actorId: players.a2, targetId: players.a1, rowIndex: 2, friendlyFire: true },
      { id: 'response', tick: 1_140, actorId: players.b1, targetId: players.a2, rowIndex: 3 },
    ]);
    expect(buildCanonicalTradeLinks(fixture.match).links).toEqual([]);
  });

  it('is invariant to input array order when event chronology metadata is unchanged', () => {
    const events = tradePair();
    const forward = buildCanonicalTradeLinks(makeFixture(events).match);
    const reversed = buildCanonicalTradeLinks(makeFixture([...events].reverse()).match);
    expect(reversed.links).toEqual(forward.links);
  });

  it('never emits non-finite timing values', () => {
    const result = buildCanonicalTradeLinks(makeFixture(tradePair()).match);
    expect(result.links.every((link) => (
      Number.isFinite(link.delayTicks) && Number.isFinite(link.delaySeconds)
    ))).toBe(true);
  });
});

describe('H2-E2 traded-death neutralization (synthetic)', () => {
  it('neutralizes only the linked opening-death anchor', () => {
    const fixture = makeFixture(tradePair());
    const experiment = evaluateH2E2Experiment(fixture.match, preparedProfiles(fixture));
    expect(experiment.neutralizedAnchorsByPlayer[fixture.players.b1]).toEqual(['original']);
    const baseline = projectionFor(experiment.baseline.projections, fixture.players.b1);
    const candidate = projectionFor(experiment.tradedDeathNeutralized!.projections, fixture.players.b1);
    expect(candidate?.rawFamilyInputs?.DEATH_RELATED).toBeGreaterThan(
      baseline?.rawFamilyInputs?.DEATH_RELATED ?? Number.POSITIVE_INFINITY,
    );
  });

  it('neutralizes a non-opening traded death without requiring an opening tag', () => {
    const players = basePlayers();
    const fixture = makeFixture([
      { id: 'opening', tick: 1_150, actorId: players.a3, targetId: players.b3, rowIndex: 1 },
      ...tradePair(),
    ]);
    expect(evaluateH2E2Experiment(fixture.match, preparedProfiles(fixture))
      .neutralizedAnchorsByPlayer[fixture.players.b1]).toEqual(['original']);
  });

  it('keeps factual trade evidence but does not apply it to an H2-excluded victim round', () => {
    const fixture = makeFixture(tradePair());
    const profiles = preparedProfiles(fixture);
    const victim = profiles.find((profile) => profile.playerId === fixture.players.b1)!;
    victim.countedRoundIds = victim.countedRoundIds.filter((roundId) => roundId !== fixture.round.id);
    const experiment = evaluateH2E2Experiment(fixture.match, profiles);
    expect(experiment.trades.links).toHaveLength(1);
    expect(experiment.neutralizedAnchorsByPlayer[fixture.players.b1]).toBeUndefined();
  });

  it('does not apply a trade to a player with unreliable participation', () => {
    const fixture = makeFixture(tradePair());
    const profiles = preparedProfiles(fixture);
    const victim = profiles.find((profile) => profile.playerId === fixture.players.b1)!;
    victim.status = 'PARTICIPATION_EVIDENCE_UNKNOWN';
    victim.reason = 'SYNTHETIC_UNRELIABLE_PARTICIPATION';
    const experiment = evaluateH2E2Experiment(fixture.match, profiles);
    expect(experiment.neutralizedAnchorsByPlayer[fixture.players.b1]).toBeUndefined();
  });

  it('neutralizes a death even when no lethal PLAYER_HURT link exists', () => {
    const fixture = makeFixture(tradePair());
    expect(fixture.match.events.some((event) => event.kind === 'PLAYER_HURT')).toBe(false);
    const experiment = evaluateH2E2Experiment(fixture.match, preparedProfiles(fixture));
    expect(experiment.neutralizedAnchorsByPlayer[fixture.players.b1]).toEqual(['original']);
    expect(experiment.contextAnchorByRevengeEventId.revenge).toBeUndefined();
    expect(experiment.unavailableContextEventIds).toContain('revenge');
  });

  it('neutralizes two separate traded deaths of one player in different rounds', () => {
    const base = makeFixture([]);
    const second = base.match.rounds[1]!;
    const firstPair = tradePair({ originalId: 'original-1', revengeId: 'revenge-1' });
    const secondPair = tradePair({
      originalId: 'original-2',
      revengeId: 'revenge-2',
      roundId: second.id,
      start: second.freezeEndTick! + 100,
    });
    const fixture = makeFixture([...firstPair, ...secondPair]);
    expect(evaluateH2E2Experiment(fixture.match, preparedProfiles(fixture))
      .neutralizedAnchorsByPlayer[fixture.players.b1]).toEqual(['original-1', 'original-2']);
  });

  it('keeps an untraded death while removing the traded death of the same player', () => {
    const players = basePlayers();
    const secondRound = makeFixture([]).match.rounds[1]!;
    const fixture = makeFixture([
      ...tradePair(),
      {
        id: 'untraded',
        tick: secondRound.freezeEndTick! + 100,
        actorId: players.a3,
        targetId: players.b1,
        rowIndex: 20,
        roundId: secondRound.id,
      },
    ]);
    const profiles = preparedProfiles(fixture);
    const before = profiles.find((profile) => profile.playerId === fixture.players.b1)!
      .prepared.p4BPlus.episodeContributions!
      .filter((episode) => episode.chosenAxis === 'ownDeaths');
    const experiment = evaluateH2E2Experiment(fixture.match, profiles);
    expect(before.map((episode) => episode.anchorId).sort()).toEqual(['original', 'untraded']);
    expect(experiment.neutralizedAnchorsByPlayer[fixture.players.b1]).toEqual(['original']);
    const baseline = projectionFor(experiment.baseline.projections, fixture.players.b1)!;
    const candidate = projectionFor(experiment.tradedDeathNeutralized!.projections, fixture.players.b1)!;
    expect(candidate.rawFamilyInputs!.DEATH_RELATED).toBeGreaterThan(baseline.rawFamilyInputs!.DEATH_RELATED);
    const tradedBase = before.find((episode) => episode.anchorId === 'original')!.base;
    expect(candidate.rawFamilyInputs!.DEATH_RELATED - baseline.rawFamilyInputs!.DEATH_RELATED)
      .toBeCloseTo(-tradedBase * PARTICIPATION_FAMILY_POLICY.scoreScale, 15);
  });

  it('leaves a player without deaths unchanged', () => {
    const fixture = makeFixture(tradePair());
    const experiment = evaluateH2E2Experiment(fixture.match, preparedProfiles(fixture));
    const baseline = projectionFor(experiment.baseline.projections, fixture.players.a4);
    const candidate = projectionFor(experiment.tradedDeathNeutralized!.projections, fixture.players.a4);
    expect(candidate).toEqual(baseline);
  });

  it('keeps all variants equal when there are no trade events', () => {
    const fixture = makeFixture([]);
    const experiment = evaluateH2E2Experiment(fixture.match, preparedProfiles(fixture));
    expect(experiment.canonicalOnly!.projections).toEqual(experiment.baseline.projections);
    expect(experiment.tradedDeathNeutralized!.projections).toEqual(experiment.baseline.projections);
  });

  it('keeps candidates unavailable when the tick rate is unknown', () => {
    const fixture = makeFixture(tradePair(), { tickRate: null });
    const experiment = evaluateH2E2Experiment(fixture.match, preparedProfiles(fixture));
    expect(experiment.canonicalOnly).toBeNull();
    expect(experiment.tradedDeathNeutralized).toBeNull();
  });

  it('reconstructs every calculated rating from six final attributions', () => {
    const fixture = makeFixture(tradePair());
    const experiment = evaluateH2E2Experiment(fixture.match, preparedProfiles(fixture));
    for (const variant of [experiment.baseline, experiment.canonicalOnly!, experiment.tradedDeathNeutralized!]) {
      for (const row of variant.projections) {
        if (row.status !== 'CALCULATED_RESEARCH_ONLY') continue;
        const reconstructed = 1 + Object.values(row.finalAttribution)
          .reduce((sum, value) => sum + value, 0);
        expect(reconstructed).toBeCloseTo(row.rating, 12);
      }
    }
  });

  it('does not mutate production inputs, K/D/A facts, M2 analytics or baseline H2', () => {
    const fixture = makeFixture(tradePair());
    const profiles = preparedProfiles(fixture);
    const matchBefore = structuredClone(fixture.match);
    const profilesBefore = structuredClone(profiles);
    const analyticsBefore = computeMatchAnalytics(fixture.match, '2026-11-17T00:00:00.000Z');
    const baselineBefore = projectParticipationRatings(profiles.map((profile) => ({
      profileKey: profile.profileKey,
      playerId: profile.playerId,
      teamId: profile.teamId,
      status: profile.status,
      reason: profile.reason,
      prepared: profile.prepared,
    })));
    evaluateH2E2Experiment(fixture.match, profiles);
    expect(fixture.match).toEqual(matchBefore);
    expect(profiles).toEqual(profilesBefore);
    expect(computeMatchAnalytics(fixture.match, '2026-11-17T00:00:00.000Z')).toEqual(analyticsBefore);
    expect(projectParticipationRatings(profiles.map((profile) => ({
      profileKey: profile.profileKey,
      playerId: profile.playerId,
      teamId: profile.teamId,
      status: profile.status,
      reason: profile.reason,
      prepared: profile.prepared,
    })))).toEqual(baselineBefore);
  });

  it('changes only the exact normalized death base before the existing kernel', () => {
    const fixture = makeFixture(tradePair());
    const profiles = preparedProfiles(fixture);
    const victim = profiles.find((profile) => profile.playerId === fixture.players.b1)!;
    const death = victim.prepared.p4BPlus.episodeContributions!
      .find((episode) => episode.anchorId === 'original' && episode.chosenAxis === 'ownDeaths')!;
    const experiment = evaluateH2E2Experiment(fixture.match, profiles);
    const baseline = projectionFor(experiment.baseline.projections, fixture.players.b1)!;
    const candidate = projectionFor(experiment.tradedDeathNeutralized!.projections, fixture.players.b1)!;
    expect(candidate.rawFamilyInputs!.DEATH_RELATED - baseline.rawFamilyInputs!.DEATH_RELATED)
      .toBeCloseTo(-death.base * PARTICIPATION_FAMILY_POLICY.scoreScale, 15);
    for (const family of ['COMBAT', 'SUPPORT', 'DIRECT_HARM', 'OBJECTIVES'] as const) {
      expect(candidate.rawFamilyInputs![family]).toBe(baseline.rawFamilyInputs![family]);
    }
  });
});
