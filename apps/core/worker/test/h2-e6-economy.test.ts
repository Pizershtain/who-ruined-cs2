import { describe, expect, it } from 'vitest';
import type { MatchData, MatchEvent, MatchRound } from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import { prepareEvpMatchInput, projectParticipationRatings } from '@who-ruined/scoring';
import { syntheticValidMatch } from '@who-ruined/testkit';

import {
  H2_E6_ECONOMY_CONTRACT_VERSION,
  evaluateH2E6Economy,
  reconstructEquipmentSnapshots,
  type EquipmentSnapshotObservation,
  type H2E6ResearchProfile,
  type ItemObservation,
} from '@who-ruined/scoring/h3';

type Fixture = {
  match: MatchData;
  rounds: [MatchRound, MatchRound];
  teamA: string;
  teamB: string;
  a: string[];
  b: string[];
};

function fixture(): Fixture {
  const match = syntheticValidMatch();
  const first = match.rounds[0]!;
  const teamA = match.teams[0]!.id;
  const teamB = match.teams[1]!.id;
  const second: MatchRound = {
    ...structuredClone(first),
    id: 'round_2',
    ordinal: 2,
    startTick: 2_000,
    freezeEndTick: 2_100,
    endTick: 2_900,
    winnerTeamId: teamB,
    winnerSide: 'T',
    sideByTeamId: { [teamA]: 'CT', [teamB]: 'T' },
    scoreBefore: { [teamA]: 1, [teamB]: 0 },
    scoreAfter: { [teamA]: 1, [teamB]: 1 },
  };
  first.winnerTeamId = teamA;
  first.winnerSide = 'T';
  first.scoreAfter = { [teamA]: 1, [teamB]: 0 };
  match.rounds = [first, second];
  return {
    match,
    rounds: [first, second],
    teamA,
    teamB,
    a: [...match.teams[0]!.playerIds],
    b: [...match.teams[1]!.playerIds],
  };
}

function event(
  f: Fixture,
  input: {
    id: string;
    kind?: string;
    roundId?: string;
    tick?: number;
    actorId?: string | null | undefined;
    targetId?: string | null | undefined;
    hp?: number | null;
    armor?: number | null;
    healthAfter?: number | null;
    rowIndex?: number;
  },
): MatchEvent {
  const actorId = input.actorId === undefined ? f.a[0]! : input.actorId;
  const targetId = input.targetId === undefined ? f.b[0]! : input.targetId;
  const team = new Map(f.match.players.map((player) => [player.id, player.teamId]));
  return {
    id: input.id,
    kind: input.kind ?? 'PLAYER_HURT',
    roundId: input.roundId ?? f.rounds[0].id,
    tick: input.tick ?? 1_200,
    actorId,
    targetId,
    assisterId: null,
    attrs: {
      rawHealthDamage: input.hp === undefined ? 20 : input.hp,
      rawArmorDamage: input.armor === undefined ? 0 : input.armor,
      healthAfter: input.healthAfter === undefined ? 80 : input.healthAfter,
    },
    context: {
      phase: 'LIVE',
      actorTeamId: actorId ? team.get(actorId) ?? null : null,
      targetTeamId: targetId ? team.get(targetId) ?? null : null,
      actorSide: null,
      targetSide: null,
      aliveByTeamId: null,
      secondsFromFreezeEnd: null,
      bombState: null,
      actorEquipmentValue: null,
      actorMoney: null,
    },
    source: { eventName: (input.kind ?? 'PLAYER_HURT').toLowerCase(), rowIndex: input.rowIndex ?? 1 },
  };
}

function profile(
  f: Fixture,
  playerId: string,
  options: { anchors?: Array<{ id: string; tags?: string[] }>; countedRoundIds?: string[] } = {},
): H2E6ResearchProfile {
  const episodes = (options.anchors ?? []).map((anchor) => ({
    anchorId: anchor.id,
    chosenAxis: 'enemyHp',
    family: 'COMBAT' as const,
    base: 0.1,
    tags: anchor.tags ?? [],
  }));
  const prepared = {
    status: 'CALCULATED_RESEARCH_ONLY' as const,
    reason: null,
    familyContributions: { COMBAT: 0.01, SUPPORT: 0, DEATH_RELATED: 0, DIRECT_HARM: 0 },
    objectiveSignals: { 'objective:plants': 0, 'objective:defuses': 0 },
    episodeContributions: episodes,
  };
  return {
    profileKey: `synthetic:${playerId}`,
    playerId,
    teamId: f.match.players.find((player) => player.id === playerId)!.teamId,
    status: 'ELIGIBLE',
    reason: null,
    countedRoundIds: options.countedRoundIds ?? f.rounds.map((round) => round.id),
    prepared: {
      profileKey: `synthetic:${playerId}`,
      scenario: 'BOMB',
      p4BPlus: structuredClone(prepared),
      p4CPlus: structuredClone(prepared),
    },
  };
}

function profiles(
  f: Fixture,
  anchorPlayer = f.a[0]!,
  anchors: Array<{ id: string; tags?: string[] }> = [],
): H2E6ResearchProfile[] {
  return f.match.players.map((player) => profile(f, player.id, {
    anchors: player.id === anchorPlayer ? anchors : [],
  }));
}

function snapshot(
  f: Fixture,
  playerId: string,
  options: Partial<EquipmentSnapshotObservation> = {},
): EquipmentSnapshotObservation {
  const roundId = options.roundId ?? f.rounds[0].id;
  const round = f.match.rounds.find((candidate) => candidate.id === roundId)!;
  const teamId = f.match.players.find((player) => player.id === playerId)!.teamId;
  const phase = options.phase ?? 'FREEZE_END';
  return {
    evidenceId: options.evidenceId ?? `${roundId}:${playerId}:${phase}`,
    matchId: f.match.matchId,
    roundId,
    playerId,
    teamId,
    side: round.sideByTeamId[teamId] ?? null,
    tick: options.tick ?? (phase === 'FREEZE_END' ? round.freezeEndTick! : round.endTick),
    phase,
    equipmentValue: options.equipmentValue === undefined ? 4_000 : options.equipmentValue,
    roundStartEquipmentValue: options.roundStartEquipmentValue === undefined ? 200 : options.roundStartEquipmentValue,
    inventory: options.inventory === undefined ? ['knife', 'AK-47', 'Glock-18', 'Flashbang'] : options.inventory,
    activeWeapon: options.activeWeapon === undefined ? 'AK-47' : options.activeWeapon,
    activeWeaponEntityId: options.activeWeaponEntityId === undefined ? null : options.activeWeaponEntityId,
    armor: options.armor === undefined ? 100 : options.armor,
    hasHelmet: options.hasHelmet === undefined ? true : options.hasHelmet,
    hasDefuser: options.hasDefuser === undefined ? false : options.hasDefuser,
    balance: options.balance === undefined ? 1_000 : options.balance,
    cashSpentThisRound: options.cashSpentThisRound === undefined ? 4_000 : options.cashSpentThisRound,
    totalCashSpent: options.totalCashSpent === undefined ? 4_000 : options.totalCashSpent,
    alive: options.alive === undefined ? true : options.alive,
    provenance: options.provenance ?? 'SYNTHETIC_TEST',
  };
}

function fullSnapshots(
  f: Fixture,
  actorValue = 1_000,
  enemyValue = 5_000,
): EquipmentSnapshotObservation[] {
  return f.match.players.map((player) => snapshot(f, player.id, {
    equipmentValue: player.teamId === f.teamA ? actorValue : enemyValue,
  }));
}

function item(input: Partial<ItemObservation> & Pick<ItemObservation, 'evidenceId' | 'kind'>): ItemObservation {
  return {
    evidenceId: input.evidenceId,
    roundId: input.roundId ?? 'round_1',
    tick: input.tick ?? 1_300,
    kind: input.kind,
    playerId: input.playerId ?? null,
    item: input.item ?? 'AK-47',
    defIndex: input.defIndex ?? 7,
    entityId: input.entityId ?? null,
    previousOwnerPlayerId: input.previousOwnerPlayerId ?? null,
    availability: input.availability ?? 'AVAILABLE',
    reasons: input.reasons ?? [],
  };
}

function evaluate(
  f: Fixture,
  observations: readonly EquipmentSnapshotObservation[] = fullSnapshots(f),
  itemObservations: readonly ItemObservation[] = [],
  researchProfiles: readonly H2E6ResearchProfile[] = profiles(f, f.a[0]!, [{ id: 'hurt' }]),
) {
  return evaluateH2E6Economy(f.match, researchProfiles, observations, itemObservations);
}

describe('H2-E6 economy research (explicitly synthetic fixtures)', () => {
  it('1. reconstructs a complete snapshot with loadout, armor, helmet, kit and grenades', () => {
    const f = fixture();
    const value = reconstructEquipmentSnapshots([snapshot(f, f.a[0]!, { hasDefuser: true })]);
    expect(value.snapshots[0]).toMatchObject({
      availability: 'AVAILABLE', primaryWeapon: 'AK-47', secondaryWeapon: 'Glock-18',
      grenades: ['Flashbang'], armor: 100, hasHelmet: true, hasDefuser: true,
    });
  });

  it('2/6. keeps absent and unknown equipment unavailable instead of zero', () => {
    const f = fixture();
    f.match.events = [event(f, { id: 'hurt' })];
    const absent = evaluate(f, fullSnapshots(f).filter((row) => row.playerId !== f.a[0]));
    expect(absent.rejections.some((row) => row.reasons.includes('ACTOR_EQUIPMENT_UNAVAILABLE'))).toBe(true);
    const unknown = evaluate(f, fullSnapshots(f).map((row) => row.playerId === f.a[0]
      ? { ...row, equipmentValue: null } : row));
    expect(unknown.snapshots.find((row) => row.playerId === f.a[0])!.availability).toBe('UNAVAILABLE');
  });

  it('3. refuses conflicting same-round snapshots and deduplicates an exact evidence ID', () => {
    const f = fixture();
    const base = snapshot(f, f.a[0]!, { evidenceId: 'same' });
    const duplicated = reconstructEquipmentSnapshots([base, structuredClone(base)]);
    expect(duplicated.snapshots[0]!.duplicateEvidenceIds).toEqual(['same']);
    const conflict = reconstructEquipmentSnapshots([base, { ...base, evidenceId: 'other', equipmentValue: 5_000 }]);
    expect(conflict.snapshots[0]).toMatchObject({
      availability: 'UNAVAILABLE', equipmentValue: null,
      reasons: expect.arrayContaining(['CONFLICTING_SNAPSHOTS', 'NO_ARBITRARY_SNAPSHOT_SELECTION']),
    });
  });

  it('4. rejects repeated normalized event IDs instead of double counting them', () => {
    const f = fixture();
    f.match.events = [event(f, { id: 'duplicate' }), event(f, { id: 'duplicate', rowIndex: 2 })];
    const value = evaluate(f);
    expect(value.combatCandidates).toHaveLength(0);
    expect(value.diagnostics.rejectionReasons.DUPLICATE_EVENT_ID).toBe(2);
  });

  it('5/7. treats zero as observed and inventory absence as partial, without Infinity', () => {
    const f = fixture();
    f.match.events = [event(f, { id: 'hurt' })];
    const value = evaluate(f, fullSnapshots(f).map((row) => row.playerId === f.a[0]
      ? { ...row, equipmentValue: 0, inventory: null } : row));
    const actor = value.snapshots.find((row) => row.playerId === f.a[0])!;
    expect(actor).toMatchObject({ equipmentValue: 0, availability: 'PARTIAL' });
    expect(value.combatCandidates[0]!.relativeLoadout).toBe(0);
    expect(JSON.stringify(value)).not.toMatch(/NaN|Infinity/);
  });

  it('8/9. distinguishes a cheap loadout against a full buy from cheap versus eco', () => {
    const f = fixture();
    f.match.events = [event(f, { id: 'hurt' })];
    const fullBuy = evaluate(f);
    expect(fullBuy.diagnostics.lowEquipmentCombatActions).toBe(1);
    const eco = evaluate(f, fullSnapshots(f, 800, 1_200));
    expect(eco.diagnostics.lowEquipmentCombatActions).toBe(0);
    expect(eco.attributionLedger[0]!.proposedBReplacementDelta).toBe(0);
  });

  it('10/11. withholds unknown damage but retains a confirmed kill without damage', () => {
    const f = fixture();
    f.match.events = [
      event(f, { id: 'unknown-damage', hp: null, armor: null }),
      event(f, { id: 'kill', kind: 'PLAYER_DEATH', tick: 1_300, hp: null, armor: null, rowIndex: 2 }),
    ];
    const value = evaluate(f, fullSnapshots(f), [], profiles(f, f.a[0]!, [{ id: 'kill' }]));
    expect(value.combatCandidates.map((row) => row.kind)).toEqual(['ENEMY_KILL']);
    expect(value.rejections.some((row) => row.reasons.includes('DAMAGE_AMOUNT_UNAVAILABLE'))).toBe(true);
  });

  it('12/13/14. excludes team damage, suicide/world and unknown team relation', () => {
    const f = fixture();
    f.match.events = [
      event(f, { id: 'team', targetId: f.a[1] }),
      event(f, { id: 'suicide', kind: 'PLAYER_DEATH', targetId: f.a[0], rowIndex: 2 }),
      event(f, { id: 'world', kind: 'PLAYER_DEATH', actorId: null, rowIndex: 3 }),
      event(f, { id: 'unknown', targetId: 'not-rostered', rowIndex: 4 }),
    ];
    const value = evaluate(f);
    expect(value.combatCandidates).toHaveLength(0);
    expect(value.diagnostics.rejectionReasons).toMatchObject({
      RELATION_FRIENDLY: 1, RELATION_SELF: 1, RELATION_UNKNOWN: 2,
    });
  });

  it('15/16/17/18/19. preserves purchase/pickup/drop facts and confirms only ID-linked transfers', () => {
    const f = fixture();
    const observations = [
      item({ evidenceId: 'purchase', kind: 'PURCHASE', playerId: f.a[0]!, entityId: 10 }),
      item({ evidenceId: 'drop', kind: 'DROP', playerId: f.a[0]!, entityId: 11, tick: 1_400 }),
      item({ evidenceId: 'pickup', kind: 'PICKUP', playerId: f.a[1]!, entityId: 11, tick: 1_401 }),
      item({ evidenceId: 'orphan-pickup', kind: 'PICKUP', playerId: f.a[2]!, entityId: null, tick: 1_500, availability: 'PARTIAL' }),
      item({ evidenceId: 'orphan-drop', kind: 'DROP', playerId: f.a[3]!, entityId: null, tick: 1_600, availability: 'PARTIAL' }),
    ];
    const value = evaluate(f, fullSnapshots(f), observations);
    expect(value.transitions.map((row) => row.kind)).toEqual([
      'DROP_ONLY', 'PICKUP_ONLY', 'PURCHASE', 'CONFIRMED_TRANSFER',
    ]);
    expect(value.transitions.find((row) => row.kind === 'CONFIRMED_TRANSFER')).toMatchObject({
      fromPlayerId: f.a[0], toPlayerId: f.a[1], entityId: 11, availability: 'AVAILABLE',
    });
    expect(value.transitions.find((row) => row.transitionId === 'pickup:orphan-pickup')!.reasons)
      .toContain('DONOR_NOT_CONFIRMED');
  });

  it('20/21. separates same weapon type from confirmed entity carryover', () => {
    const f = fixture();
    const base = fullSnapshots(f);
    const end = snapshot(f, f.a[0]!, { phase: 'ROUND_END', activeWeapon: 'AK-47', activeWeaponEntityId: null });
    const next = snapshot(f, f.a[0]!, { roundId: 'round_2', activeWeapon: 'AK-47', activeWeaponEntityId: null });
    const sameType = evaluate(f, [...base, end, next]);
    expect(sameType.transitions.find((row) => row.kind === 'SAME_TYPE_ONLY')!.availability).toBe('PARTIAL');
    const confirmed = evaluate(f, [
      ...base,
      { ...end, activeWeaponEntityId: 77 },
      { ...next, activeWeaponEntityId: 77 },
    ]);
    expect(confirmed.transitions.find((row) => row.kind === 'CONFIRMED_CARRYOVER')).toMatchObject({
      entityId: 77, fromPlayerId: f.a[0], toPlayerId: f.a[0], availability: 'AVAILABLE',
    });
  });

  it('22/23/24. does not infer saving from survival and records carryover in a lost round without scoring it', () => {
    const f = fixture();
    f.rounds[0].winnerTeamId = f.teamB;
    const base = fullSnapshots(f);
    const deadEnd = snapshot(f, f.a[0]!, { phase: 'ROUND_END', alive: false, activeWeaponEntityId: 50 });
    const noWeapon = snapshot(f, f.a[1]!, { phase: 'ROUND_END', alive: true, activeWeapon: null, activeWeaponEntityId: null });
    const nextA = snapshot(f, f.a[0]!, { roundId: 'round_2', activeWeaponEntityId: 50 });
    const nextB = snapshot(f, f.a[1]!, { roundId: 'round_2', activeWeapon: null, activeWeaponEntityId: null });
    const savedEnd = snapshot(f, f.a[2]!, { phase: 'ROUND_END', alive: true, activeWeaponEntityId: 80 });
    const savedNext = snapshot(f, f.a[2]!, { roundId: 'round_2', activeWeaponEntityId: 80 });
    const value = evaluate(f, [...base, deadEnd, noWeapon, nextA, nextB, savedEnd, savedNext]);
    expect(value.transitions.filter((row) => row.kind === 'CONFIRMED_CARRYOVER')).toHaveLength(1);
    expect(value.models.find((row) => row.modelId === 'E6_D_CONFIRMED_EQUIPMENT_CARRYOVER')!
      .projections.every((row) => row.contribution === 0)).toBe(true);
  });

  it('25. keeps roster team identity stable while round side changes', () => {
    const f = fixture();
    const first = snapshot(f, f.a[0]!);
    const second = snapshot(f, f.a[0]!, { roundId: 'round_2' });
    const value = reconstructEquipmentSnapshots([first, second]);
    expect(value.snapshots.map((row) => [row.teamId, row.side])).toEqual([
      [f.teamA, 'T'], [f.teamA, 'CT'],
    ]);
  });

  it('26/27. withholds excluded rounds and incomplete comparison rosters', () => {
    const f = fixture();
    f.match.events = [event(f, { id: 'hurt' })];
    const excludedProfiles = profiles(f).map((row) => row.playerId === f.a[0]
      ? { ...row, countedRoundIds: ['round_2'] } : row);
    expect(evaluate(f, fullSnapshots(f), [], excludedProfiles).diagnostics.rejectionReasons)
      .toHaveProperty('ROUND_NOT_COUNTED_FOR_ACTOR');
    const incompleteProfiles = profiles(f).filter((row) => row.teamId === f.teamA || row.playerId === f.b[0]);
    expect(evaluate(f, fullSnapshots(f), [], incompleteProfiles).diagnostics.rejectionReasons)
      .toHaveProperty('OPPONENT_TEAM_COMPARISON_INCOMPLETE');
  });

  it('28. applies event, round and match caps to repeated eligible combat', () => {
    const f = fixture();
    f.match.events = Array.from({ length: 20 }, (_, index) => event(f, {
      id: `hurt-${index}`,
      targetId: f.b[index % f.b.length],
      tick: 1_200 + index,
      rowIndex: index,
      hp: 100,
    }));
    const p = profiles(f, f.a[0]!, f.match.events.map((row) => ({ id: row.id })));
    const value = evaluate(f, fullSnapshots(f, 0, 6_000), [], p);
    const c = value.models.find((row) => row.modelId === 'E6_C_BOUNDED_COMBAT_EFFICIENCY')!
      .projections.find((row) => row.playerId === f.a[0])!;
    expect(c.capped).toBe(true);
    expect(c.contribution).toBeLessThanOrEqual(0.03);
  });

  it('29. makes model B replace existing LOW_EQUIP_COMBAT rather than stacking it', () => {
    const f = fixture();
    f.match.events = [event(f, { id: 'hurt' })];
    const value = evaluate(f, fullSnapshots(f), [], profiles(f, f.a[0]!, [{
      id: 'hurt', tags: ['LOW_EQUIP_COMBAT'],
    }]));
    const row = value.attributionLedger[0]!;
    expect(row.overlap).toBe('EXISTING_LOW_EQUIP_CONTEXT');
    expect(row.proposedBReplacementDelta).toBeLessThan(0.1 * 0.05);
    expect(row.reason).toContain('REPLACES_EXISTING_LOW_EQUIP_CONTEXT');
  });

  it('30/31. leaves active H2, M2 and EVP calculations unchanged', () => {
    const f = fixture();
    f.match.events = [event(f, { id: 'hurt' })];
    const p = profiles(f, f.a[0]!, [{ id: 'hurt' }]);
    const beforeH2 = projectParticipationRatings(p.map((row) => ({
      profileKey: row.profileKey,
      playerId: row.playerId,
      teamId: row.teamId,
      status: row.status,
      reason: row.reason,
      prepared: row.prepared,
    })));
    const beforeM2 = computeMatchAnalytics(f.match, '2026-11-22T00:00:00.000Z');
    const artifact = { schemaVersion: 'm2-artifact-1' as const, match: f.match, analytics: beforeM2 };
    const participation = f.match.players.map((player) => ({
      playerId: player.id,
      eligible: true,
      verifiedRounds: 2,
      unknownRounds: 0,
      reasonCodes: [],
    }));
    const evpSource = { artifact, participation, mvpPlayerId: null, scenario: 'BOMB' as const };
    const beforeEvp = prepareEvpMatchInput(evpSource);
    const value = evaluate(f, fullSnapshots(f), [], p);
    expect(value.baseline).toEqual(beforeH2);
    expect(computeMatchAnalytics(f.match, '2026-11-22T00:00:00.000Z')).toEqual(beforeM2);
    expect(prepareEvpMatchInput(evpSource)).toEqual(beforeEvp);
  });

  it('32. is deterministic under permutation of snapshots, item rows and match events', () => {
    const f = fixture();
    f.match.events = [event(f, { id: 'hurt' }), event(f, { id: 'kill', kind: 'PLAYER_DEATH', tick: 1_300, rowIndex: 2 })];
    const snapshots = fullSnapshots(f);
    const items = [item({ evidenceId: 'pickup', kind: 'PICKUP', playerId: f.a[0]! })];
    const p = profiles(f, f.a[0]!, [{ id: 'hurt' }, { id: 'kill' }]);
    const first = evaluate(f, snapshots, items, p);
    f.match.events.reverse();
    const second = evaluate(f, [...snapshots].reverse(), [...items].reverse(), p);
    expect(second).toEqual(first);
  });

  it('33/34. emits finite exactly reconstructable model results and the versioned contract', () => {
    const f = fixture();
    f.match.events = [event(f, { id: 'hurt' })];
    const value = evaluate(f);
    expect(value.schemaVersion).toBe(H2_E6_ECONOMY_CONTRACT_VERSION);
    expect(JSON.stringify(value)).not.toMatch(/NaN|Infinity/);
    for (const model of value.models) {
      for (const row of model.projections) {
        if (row.experimentalRating === null) continue;
        expect(row.experimentalRating).toBeCloseTo(row.baselineRating! + row.contribution!, 12);
        expect(row.reconstructionError).toBe(0);
      }
    }
  });
});
