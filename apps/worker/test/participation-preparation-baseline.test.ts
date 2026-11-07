import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  matchArtifactSchema,
  matchDataSchema,
  type MatchData,
  type MatchEvent,
  type MatchRound,
} from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import type {
  ParsedDemoSnapshot,
  ParsedParticipationSupplement,
} from '@who-ruined/parser-adapter';
import {
  buildActiveParticipationRating,
  buildCanonicalMatchResult,
} from '@who-ruined/scoring';

import { buildPreparedParticipationInput } from '../src/prepared-participation-input.js';
import { buildParticipationSidecar } from '../src/participation-sidecar.js';

const GENERATED_AT = '2026-11-03T09:00:00.000Z';
const TEAM_A = 'team-synthetic-a';
const TEAM_B = 'team-synthetic-b';
const TEAM_A_PLAYERS = Array.from(
  { length: 5 },
  (_, index) => `7656119800000000${index}`,
);
const TEAM_B_PLAYERS = Array.from(
  { length: 5 },
  (_, index) => `7656119800000001${index}`,
);

type SyntheticFixture = {
  match: MatchData;
  snapshot: ParsedDemoSnapshot;
  evidence: {
    lifecycleEventNames: string[];
    lifecycle: Array<{
      steamId: string | null;
      tick: number | null;
      kind: string | null;
      sourceRowIndex: number;
    }>;
    ticks: Array<{
      tick: number | null;
      steamId: string | null;
      isAlive: boolean | null;
      sideNumber: number | null;
    }>;
  };
};

function context(
  round: MatchRound,
  actorId: string | null,
  targetId: string | null,
): NonNullable<MatchEvent['context']> {
  const teamByPlayer = new Map([
    ...TEAM_A_PLAYERS.map((playerId) => [playerId, TEAM_A] as const),
    ...TEAM_B_PLAYERS.map((playerId) => [playerId, TEAM_B] as const),
  ]);
  const actorTeamId = actorId ? teamByPlayer.get(actorId) ?? null : null;
  const targetTeamId = targetId ? teamByPlayer.get(targetId) ?? null : null;
  return {
    phase: 'LIVE',
    actorTeamId,
    targetTeamId,
    actorSide: actorTeamId ? round.sideByTeamId[actorTeamId] ?? null : null,
    targetSide: targetTeamId ? round.sideByTeamId[targetTeamId] ?? null : null,
    aliveByTeamId: null,
    secondsFromFreezeEnd: null,
    bombState: null,
    actorEquipmentValue: null,
    actorMoney: null,
  };
}

function makeRounds(count: number): MatchRound[] {
  const scores = { [TEAM_A]: 0, [TEAM_B]: 0 };
  return Array.from({ length: count }, (_, index) => {
    const ordinal = index + 1;
    const startTick = index * 1_100;
    const sideByTeamId = ordinal % 2 === 1
      ? { [TEAM_A]: 'T' as const, [TEAM_B]: 'CT' as const }
      : { [TEAM_A]: 'CT' as const, [TEAM_B]: 'T' as const };
    const scoreBefore = { ...scores };
    scores[TEAM_A] += 1;
    return {
      id: `round-${ordinal}`,
      ordinal,
      startTick,
      freezeEndTick: startTick + 100,
      endTick: startTick + 1_000,
      winnerTeamId: TEAM_A,
      winnerSide: sideByTeamId[TEAM_A],
      sideByTeamId,
      scoreBefore,
      scoreAfter: { ...scores },
      isValid: true,
      issues: [],
    };
  });
}

function makeFixture(options: {
  rounds?: number;
  complexEvents?: boolean;
  map?: string | null;
  tickRate?: number | null;
} = {}): SyntheticFixture {
  const rounds = makeRounds(options.rounds ?? 2);
  const rawEvents: Array<Record<string, unknown>> = [];
  const events: MatchEvent[] = [];

  const addRaw = (
    eventName: string,
    tick: number,
    values: Record<string, unknown> = {},
  ): number => {
    rawEvents.push({ event_name: eventName, tick, ...values });
    return rawEvents.length - 1;
  };
  const addEvent = (input: {
    id: string;
    kind: string;
    eventName: string;
    round: MatchRound;
    tick: number;
    actorId?: string | null;
    targetId?: string | null;
    assisterId?: string | null;
    attrs?: MatchEvent['attrs'];
  }): void => {
    const actorId = input.actorId ?? null;
    const targetId = input.targetId ?? null;
    const rowIndex = addRaw(input.eventName, input.tick);
    events.push({
      id: input.id,
      kind: input.kind,
      roundId: input.round.id,
      tick: input.tick,
      actorId,
      targetId,
      assisterId: input.assisterId ?? null,
      attrs: input.attrs ?? {},
      context: context(input.round, actorId, targetId),
      source: { eventName: input.eventName, rowIndex },
    });
  };

  for (const round of rounds) {
    addRaw('round_freeze_end', round.freezeEndTick!);
    addRaw('round_end', round.endTick);
    addRaw('round_officially_ended', round.endTick);
  }

  if (options.complexEvents) {
    const [roundOne, roundTwo] = rounds;
    if (!roundOne || !roundTwo) throw new Error('complex fixture requires two rounds');
    const [a1, a2, a3, a4, a5] = TEAM_A_PLAYERS;
    const [b1, b2, b3, b4, b5] = TEAM_B_PLAYERS;

    addEvent({ id: 'r1-hurt-b1', kind: 'PLAYER_HURT', eventName: 'player_hurt', round: roundOne, tick: 200, actorId: a1, targetId: b1, attrs: { rawHealthDamage: 100, healthAfter: 0, rawArmorDamage: 12 } });
    addEvent({ id: 'r1-death-b1', kind: 'PLAYER_DEATH', eventName: 'player_death', round: roundOne, tick: 201, actorId: a1, targetId: b1, assisterId: a3 });
    addEvent({ id: 'r1-hurt-a1', kind: 'PLAYER_HURT', eventName: 'player_hurt', round: roundOne, tick: 239, actorId: b2, targetId: a1, attrs: { rawHealthDamage: 100, healthAfter: 0 } });
    addEvent({ id: 'r1-death-a1', kind: 'PLAYER_DEATH', eventName: 'player_death', round: roundOne, tick: 240, actorId: b2, targetId: a1 });
    addEvent({ id: 'r1-hurt-b3', kind: 'PLAYER_HURT', eventName: 'player_hurt', round: roundOne, tick: 300, actorId: a2, targetId: b3, attrs: { rawHealthDamage: 100, healthAfter: 0 } });
    addEvent({ id: 'r1-death-b3', kind: 'PLAYER_DEATH', eventName: 'player_death', round: roundOne, tick: 300, actorId: a2, targetId: b3 });
    addEvent({ id: 'r1-hurt-b4', kind: 'PLAYER_HURT', eventName: 'player_hurt', round: roundOne, tick: 300, actorId: a2, targetId: b4, attrs: { rawHealthDamage: 100, healthAfter: 0 } });
    addEvent({ id: 'r1-death-b4', kind: 'PLAYER_DEATH', eventName: 'player_death', round: roundOne, tick: 300, actorId: a2, targetId: b4 });
    addEvent({ id: 'r1-friendly-hurt', kind: 'PLAYER_HURT', eventName: 'player_hurt', round: roundOne, tick: 350, actorId: a3, targetId: a4, attrs: { rawHealthDamage: 20, healthAfter: 80, rawArmorDamage: 5 } });
    addEvent({ id: 'r1-plant', kind: 'BOMB_PLANTED', eventName: 'bomb_planted', round: roundOne, tick: 400, actorId: a5 });
    addEvent({ id: 'r1-postplant-hurt', kind: 'PLAYER_HURT', eventName: 'player_hurt', round: roundOne, tick: 450, actorId: a5, targetId: b5, attrs: { rawHealthDamage: 30, healthAfter: 70 } });
    addEvent({ id: 'r1-blind', kind: 'PLAYER_BLIND', eventName: 'player_blind', round: roundOne, tick: 500, actorId: a4, targetId: b2, attrs: { blindDuration: 1.5 } });
    addEvent({ id: 'r1-defuse', kind: 'BOMB_DEFUSED', eventName: 'bomb_defused', round: roundOne, tick: 900, actorId: b5 });

    addEvent({ id: 'r2-enemy-hurt', kind: 'PLAYER_HURT', eventName: 'player_hurt', round: roundTwo, tick: 1_300, actorId: b1, targetId: a5, attrs: { rawHealthDamage: 50, healthAfter: 50 } });
    addEvent({ id: 'r2-friendly-hurt', kind: 'PLAYER_HURT', eventName: 'player_hurt', round: roundTwo, tick: 1_350, actorId: b2, targetId: b3, attrs: { rawHealthDamage: 10, healthAfter: 90 } });
    addEvent({ id: 'r2-plant', kind: 'BOMB_PLANTED', eventName: 'bomb_planted', round: roundTwo, tick: 1_500, actorId: b4 });
    addEvent({ id: 'r2-defuse', kind: 'BOMB_DEFUSED', eventName: 'bomb_defused', round: roundTwo, tick: 2_000, actorId: a1 });
  }

  const players = [
    ...TEAM_A_PLAYERS.map((id, index) => ({ id, steamId: id, displayName: `Synthetic A${index + 1}`, teamId: TEAM_A })),
    ...TEAM_B_PLAYERS.map((id, index) => ({ id, steamId: id, displayName: `Synthetic B${index + 1}`, teamId: TEAM_B })),
  ];
  const ticks = rounds.flatMap((round) => players.map((player) => {
    const side = round.sideByTeamId[player.teamId];
    return {
      tick: round.freezeEndTick,
      steamid: player.steamId,
      is_alive: true,
      team_num: side === 'T' ? 2 : 3,
    };
  }));
  const match = matchDataSchema.parse({
    schemaVersion: '1',
    matchId: `synthetic-participation-${rounds.length}-${options.complexEvents ? 'complex' : 'empty'}`,
    fileSha256: 'b'.repeat(64),
    map: options.map === undefined ? 'de_synthetic' : options.map,
    tickRate: options.tickRate === undefined ? 64 : options.tickRate,
    teams: [
      { id: TEAM_A, playerIds: TEAM_A_PLAYERS, label: 'Synthetic A' },
      { id: TEAM_B, playerIds: TEAM_B_PLAYERS, label: 'Synthetic B' },
    ],
    players,
    rounds,
    events,
    quality: 'VALID',
    qualityIssues: [],
    provenance: {
      parser: 'synthetic-stage-3-baseline',
      parserVersion: 'synthetic',
      normalizedAt: GENERATED_AT,
    },
  });
  const snapshot: ParsedDemoSnapshot = {
    header: { map_name: match.map },
    players: [],
    eventNames: [...new Set(rawEvents.map((row) => String(row.event_name)))],
    events: rawEvents,
    ticks,
  };
  return {
    match,
    snapshot,
    evidence: {
      lifecycleEventNames: [],
      lifecycle: [],
      ticks: ticks.map((row) => ({
        tick: row.tick,
        steamId: row.steamid,
        isAlive: row.is_alive,
        sideNumber: row.team_num,
      })),
    },
  };
}

function removeSteamIdentity(
  fixture: SyntheticFixture,
  playerIds: readonly string[],
): void {
  const anonymousPlayerIds = new Set(playerIds);
  fixture.match.players = fixture.match.players.map((player) => (
    anonymousPlayerIds.has(player.id) ? { ...player, steamId: null } : player
  ));
  fixture.evidence.ticks = fixture.evidence.ticks.filter((row) => (
    row.steamId === null || !anonymousPlayerIds.has(row.steamId)
  ));
}

function observe(fixture: SyntheticFixture) {
  fixture.snapshot.eventNames = [
    ...new Set([
      ...fixture.snapshot.eventNames,
      ...fixture.evidence.lifecycleEventNames,
    ]),
  ];
  const anonymousPlayerIds = new Set(
    fixture.match.players
      .filter((player) => player.steamId === null)
      .map((player) => player.id),
  );
  const anonymousPreparedTicks = fixture.snapshot.ticks.filter((row) => (
    typeof row.steamid === 'string' && anonymousPlayerIds.has(row.steamid)
  ));
  fixture.snapshot.ticks = [
    ...fixture.evidence.ticks.map((row) => ({
      tick: row.tick,
      steamid: row.steamId,
      is_alive: row.isAlive,
      team_num: row.sideNumber,
    })),
    ...anonymousPreparedTicks,
  ];
  const supplement: ParsedParticipationSupplement = {
    schemaVersion: 'parser-participation-supplement@1',
    evidence: {
      lifecycleEventNames: fixture.evidence.lifecycleEventNames,
      lifecycleRows: fixture.evidence.lifecycle.map((row) => ({
        event_name: row.kind,
        tick: row.tick,
        user_steamid: row.steamId,
      })),
    },
    prepared: { lifecycleRows: [], hostageRows: [] },
  };
  const prepared = buildPreparedParticipationInput(
    fixture.snapshot,
    fixture.match,
    supplement,
    { allowIncompleteRoster: true },
  );
  const sidecar = buildParticipationSidecar(
    fixture.snapshot,
    fixture.match,
    supplement,
  );
  const artifact = matchArtifactSchema.parse({
    schemaVersion: 'm2-artifact-1',
    match: fixture.match,
    analytics: computeMatchAnalytics(fixture.match),
  });
  const activeRating = buildActiveParticipationRating(artifact, sidecar);
  const canonical = buildCanonicalMatchResult({
    artifact,
    sidecar,
    productionReports: [],
    sourceDemoRetained: false,
    createdAt: GENERATED_AT,
  });
  return {
    prepared,
    sidecar,
    activeRating,
    canonicalIdentity: {
      selectedPolicyId: canonical.internal.selectedPolicyId,
      selectedPolicyDigest: canonical.internal.selectedPolicyDigest,
      selectedPolicySelector: canonical.internal.selectedPolicySelector,
      sourceBindingDigest: canonical.internal.sourceBindingDigest,
      recomputeSeed: canonical.internal.recomputeSeed,
    },
  };
}

function specialValueCounts(value: unknown): Record<string, number> {
  const counts = { nan: 0, positiveInfinity: 0, negativeInfinity: 0, negativeZero: 0, null: 0, undefined: 0 };
  const visit = (candidate: unknown): void => {
    if (candidate === null) { counts.null += 1; return; }
    if (candidate === undefined) { counts.undefined += 1; return; }
    if (typeof candidate === 'number') {
      if (Number.isNaN(candidate)) counts.nan += 1;
      else if (candidate === Number.POSITIVE_INFINITY) counts.positiveInfinity += 1;
      else if (candidate === Number.NEGATIVE_INFINITY) counts.negativeInfinity += 1;
      else if (Object.is(candidate, -0)) counts.negativeZero += 1;
      return;
    }
    if (Array.isArray(candidate)) { for (const item of candidate) visit(item); return; }
    if (typeof candidate === 'object') {
      for (const item of Object.values(candidate as Record<string, unknown>)) visit(item);
    }
  };
  visit(value);
  return counts;
}

describe('synthetic stage 3 participation preparation baseline', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(GENERATED_AT));
  });
  afterAll(() => vi.useRealTimers());

  it('captures the full prepared, sidecar, H2 and canonical identity output', () => {
    const observation = observe(makeFixture({ complexEvents: true }));
    expect({ observation, specialValues: specialValueCounts(observation) }).toMatchSnapshot();
  });

  it('preserves partial evidence as unavailable instead of zero-valued evidence', () => {
    const fixture = makeFixture({ complexEvents: true });
    const affectedPlayerId = TEAM_A_PLAYERS[0]!;
    fixture.evidence.ticks = fixture.evidence.ticks.filter(
      (row) => !(row.steamId === affectedPlayerId && row.tick === fixture.match.rounds[1]!.freezeEndTick),
    );
    const observation = observe(fixture);
    expect({
      prepared: observation.prepared,
      profile: observation.sidecar.profiles.find((profile) => profile.playerId === affectedPlayerId),
      rating: observation.activeRating.players.find((player) => player.playerId === affectedPlayerId),
      ordering: observation.activeRating.ordering,
      awards: observation.activeRating.awards,
      warnings: observation.activeRating.warnings,
      limitations: observation.activeRating.limitations,
      specialValues: specialValueCounts(observation),
    }).toMatchSnapshot();
  });

  it('rebuilds a participation-filtered profile from counted rounds instead of reusing the full profile', () => {
    const fixture = makeFixture({ complexEvents: true });
    const affectedPlayerId = TEAM_A_PLAYERS[0]!;
    const full = observe(fixture);
    const fullProfile = full.prepared.preparedProfiles.find(
      (profile) => profile.playerId === affectedPlayerId,
    );

    fixture.evidence.ticks = fixture.evidence.ticks.filter((row) => !(
      row.steamId === affectedPlayerId
      && row.tick === fixture.match.rounds[1]!.freezeEndTick
    ));
    const filtered = observe(fixture);
    const filteredProfile = filtered.sidecar.profiles.find(
      (profile) => profile.playerId === affectedPlayerId,
    );

    expect(fullProfile?.rounds).toBe(2);
    expect(filteredProfile?.prepared.rounds).toBe(1);
    expect(filteredProfile?.countedRoundIds).toEqual(['round-1']);
    expect(filteredProfile?.excludedRoundIds).toEqual(['round-2']);
    expect(filteredProfile?.prepared.p4CPlus.objectiveSignals)
      .not.toEqual(fullProfile?.p4CPlus.objectiveSignals);
    expect(filteredProfile?.prepared.p4CPlus.familyContributions)
      .not.toEqual(fullProfile?.p4CPlus.familyContributions);
  });

  it('keeps three verified full-round absences outside eligibility', () => {
    const fixture = makeFixture({ rounds: 3 });
    const affectedPlayerId = TEAM_A_PLAYERS[0]!;
    fixture.evidence.ticks = fixture.evidence.ticks.map((row) => row.steamId === affectedPlayerId
      ? { ...row, isAlive: false, sideNumber: 1 }
      : row);
    fixture.evidence.lifecycleEventNames = ['player_disconnect'];
    fixture.evidence.lifecycle = [{
      steamId: affectedPlayerId,
      tick: fixture.match.rounds[0]!.freezeEndTick! - 1,
      kind: 'player_disconnect',
      sourceRowIndex: 0,
    }];
    const observation = observe(fixture);
    expect({
      participation: observation.sidecar.participation.filter((row) => row.playerId === affectedPlayerId),
      profile: observation.sidecar.profiles.find((profile) => profile.playerId === affectedPlayerId),
      rating: observation.activeRating.players.find((player) => player.playerId === affectedPlayerId),
      awards: observation.activeRating.awards,
      specialValues: specialValueCounts(observation),
    }).toMatchSnapshot();
  });

  it('preserves empty events, null tick rate and unknown scenario explicitly', () => {
    const observation = observe(makeFixture({ map: null, tickRate: null }));
    expect({ observation, specialValues: specialValueCounts(observation) }).toMatchSnapshot();
  });

  it('ignores non-start ticks and keeps duplicate start observations ambiguous', () => {
    const baselineFixture = makeFixture();
    const baseline = observe(baselineFixture);
    const noisyFixture = makeFixture();
    noisyFixture.evidence.ticks.push(...Array.from({ length: 1_000 }, (_, index) => ({
      tick: 50_000 + index,
      steamId: TEAM_A_PLAYERS[0]!,
      isAlive: true,
      sideNumber: 2,
    })));
    const noisy = observe(noisyFixture);

    const liveStartTicks = new Set(
      noisyFixture.match.rounds.map((round) => round.freezeEndTick),
    );
    expect(noisyFixture.evidence.ticks).toHaveLength(1_020);
    expect(noisyFixture.evidence.ticks.filter((row) => liveStartTicks.has(row.tick))).toHaveLength(20);
    expect(noisy.sidecar).toEqual(baseline.sidecar);
    expect(noisy.activeRating).toEqual(baseline.activeRating);

    const duplicateFixture = makeFixture();
    const playerId = TEAM_A_PLAYERS[0]!;
    const liveStart = duplicateFixture.match.rounds[0]!.freezeEndTick;
    const original = duplicateFixture.evidence.ticks.find((row) => (
      row.tick === liveStart && row.steamId === playerId
    ));
    if (!original) throw new Error('synthetic start observation is missing');
    duplicateFixture.evidence.ticks.push({ ...original });
    const duplicate = observe(duplicateFixture).sidecar.participation.find((row) => (
      row.roundId === duplicateFixture.match.rounds[0]!.id && row.playerId === playerId
    ));

    expect(duplicate?.evidence.startObserved).toBe(false);
    expect(duplicate?.classification).toBe('PARTICIPATION_UNKNOWN');
    expect(duplicate?.reason).toBe('START_SNAPSHOT_MISSING');
  });

  it('does not use one unknown Steam ID observation as presence for anonymous players', () => {
    const fixture = makeFixture();
    const anonymousPlayerIds = [TEAM_A_PLAYERS[0]!, TEAM_A_PLAYERS[1]!];
    removeSteamIdentity(fixture, anonymousPlayerIds);
    fixture.evidence.ticks.push({
      tick: fixture.match.rounds[0]!.freezeEndTick,
      steamId: null,
      isAlive: true,
      sideNumber: 2,
    });
    const participation = observe(fixture).sidecar.participation.filter((row) => (
      row.roundId === fixture.match.rounds[0]!.id
      && anonymousPlayerIds.includes(row.playerId)
    ));

    expect(participation).toHaveLength(2);
    for (const row of participation) {
      expect(row.evidence.startObserved).toBe(false);
      expect(row.classification).toBe('PARTICIPATION_UNKNOWN');
      expect(row.reason).toBe('START_SNAPSHOT_MISSING');
    }
  });

  it('uses independent gameplay evidence for a player without a Steam ID', () => {
    const fixture = makeFixture({ complexEvents: true });
    const anonymousPlayerId = TEAM_A_PLAYERS[0]!;
    removeSteamIdentity(fixture, [anonymousPlayerId]);
    fixture.evidence.ticks.push({
      tick: fixture.match.rounds[0]!.freezeEndTick,
      steamId: null,
      isAlive: true,
      sideNumber: 2,
    });
    const participation = observe(fixture).sidecar.participation.find((row) => (
      row.roundId === fixture.match.rounds[0]!.id
      && row.playerId === anonymousPlayerId
    ));

    expect(participation?.evidence.startObserved).toBe(false);
    expect(participation?.evidence.gameplayEventCount).toBeGreaterThan(0);
    expect(participation?.classification).toBe('INTERRUPTED_PARTIAL_ROUND');
    expect(participation?.reason).toBe('GAMEPLAY_WITHOUT_VERIFIED_START');
  });
});
