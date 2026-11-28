import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '@who-ruined/contracts';
import { projectParticipationFamilyInputs, projectParticipationRatings, type ParticipationRatingPreparedProfile } from '@who-ruined/scoring';
import { syntheticValidMatch } from '@who-ruined/testkit';

import type { RoundStartEvidence } from '@who-ruined/scoring/h3';
import { prepareJointEvidence, type JointEvidence } from '@who-ruined/scoring/h3';
import type { EquipmentSnapshotObservation } from '@who-ruined/scoring/h3';
import { COVERAGE, H2_FAMILY_COVERAGE, NORMALIZED_FACT_MAP } from '@who-ruined/scoring/h3';
import { H3_FAMILIES, H3_POLICY_DIGEST, H3_VERSION, projectH3 } from '@who-ruined/scoring/h3';
import { evaluateRoundImpact } from '@who-ruined/scoring/h3';

function synthetic(aAlive = 1, bAlive = 4, wins = true) {
  const match = syntheticValidMatch();
  const round = match.rounds[0]!;
  const team = match.teams[0]!;
  const enemy = match.teams[1]!;
  const playerId = team.playerIds[0]!;
  const teamFor = (id: string | null) => match.players.find((p) => p.id === id)?.teamId ?? null;
  round.winnerTeamId = wins ? team.id : enemy.id;
  round.scoreAfter = { [team.id]: wins ? 1 : 0, [enemy.id]: wins ? 0 : 1 };
  const alive = new Set([...team.playerIds.slice(0, aAlive), ...enemy.playerIds.slice(0, bAlive)]);
  const start: RoundStartEvidence = {
    roundId: round.id, liveStart: round.freezeEndTick!, liveEnd: round.endTick, boundaryComplete: true,
    boundaryReasons: [], scenario: 'BOMB', supplementalEvents: [], players: match.players.map((p) => ({
      playerId: p.id, classification: 'PRESENT_VERIFIED', counted: true, startObserved: true, startAlive: alive.has(p.id),
    })),
  };
  const event = (id: string, kind: string, actorId: string | null, targetId: string | null, offset: number,
    attrs: MatchEvent['attrs'] = {}, rowIndex = offset): MatchEvent => ({
    id, kind, actorId, targetId, assisterId: null, tick: round.freezeEndTick! + offset, roundId: round.id, attrs,
    context: { phase: 'LIVE', actorTeamId: teamFor(actorId), targetTeamId: teamFor(targetId), actorSide: null,
      targetSide: null, aliveByTeamId: null, secondsFromFreezeEnd: null, bombState: null, actorEquipmentValue: null, actorMoney: null },
    source: { eventName: kind.toLowerCase(), rowIndex },
  });
  const kill = (id: string, enemyIndex: number, offset: number, actorId = playerId, rowIndex = offset) =>
    event(id, 'PLAYER_DEATH', actorId, enemy.playerIds[enemyIndex]!, offset, {}, rowIndex);
  match.events = [];
  const profiles = (): JointEvidence['profiles'] => match.players.map((p) => {
    const physical: ParticipationRatingPreparedProfile['prepared']['p4BPlus'] = {
      status: 'CALCULATED_RESEARCH_ONLY', familyContributions: { COMBAT: 0.07, SUPPORT: -0.04, DEATH_RELATED: -0.08, DIRECT_HARM: 0 },
      objectiveSignals: { 'objective:plants': 0, 'objective:defuses': 0 },
      episodeContributions: match.events.filter((e) => e.kind === 'PLAYER_DEATH' && e.actorId === p.id).map((e) => ({
        anchorId: e.id, chosenAxis: 'enemyKills', base: 0.15, family: 'COMBAT', tags: ['DISADVANTAGE'],
      })),
    };
    return { playerId: p.id, teamId: p.teamId, profileKey: p.id, status: 'ELIGIBLE', reason: null, countedRoundIds: [round.id],
      prepared: { profileKey: p.id, scenario: 'BOMB', p4BPlus: structuredClone(physical), p4CPlus: structuredClone(physical) } };
  });
  const prepare = () => prepareJointEvidence(match, profiles(), [start], []);
  return { match, round, team, enemy, playerId, start, event, kill, prepare };
}

describe('H2-E8 H3, synthetic evidence', () => {
  it('uses the shared H2 arithmetic, signed attribution and all seven ordered families', () => {
    const f = synthetic();
    f.match.events = [f.kill('first', 0, 10), f.kill('second', 1, 50)];
    const data = f.prepare();
    const result = projectH3(data);
    expect(result.schemaVersion).toBe(H3_VERSION);
    expect(result.policyDigest).toBe(H3_POLICY_DIGEST);
    expect(result.policyDigest).toMatch(/^[a-f0-9]{64}$/);
    const row = result.players.find((p) => p.playerId === f.playerId)!;
    expect(Object.keys(row.finalAttribution!)).toEqual(H3_FAMILIES);
    expect(row.rawFamilyInputs?.ROUND_IMPACT).toBeGreaterThan(0);
    expect(row.finalAttribution?.DEATH_RELATED).toBeLessThan(0);
    expect(1 + Object.values(row.finalAttribution!).reduce<number>((sum, v) => sum + (v ?? 0), 0)).toBeCloseTo(row.rating!, 12);
    expect(projectParticipationRatings(data.profiles)).toEqual(data.baseline);
    const frozen = data.baseline.find((p) => p.playerId === f.playerId)!;
    const raw = { ...frozen.rawFamilyInputs!, ROUND_IMPACT: 0 };
    expect(projectParticipationFamilyInputs(raw, ['COMBAT', 'SUPPORT', 'DEATH_RELATED', 'CONTEXT', 'OBJECTIVES', 'ROUND_IMPACT']).rating).toBe(frozen.rating);
  });

  it('credits a verified surviving clutch conversion once even if it also qualifies as a recovery', () => {
    const f = synthetic(1, 3);
    f.match.events = [f.kill('a', 0, 10), f.kill('b', 1, 40), f.kill('c', 2, 70)];
    const row = projectH3(f.prepare()).players.find((p) => p.playerId === f.playerId)!;
    expect(row.roundImpact?.awards).toEqual([expect.objectContaining({ kind: 'CLUTCH_CONVERSION',
      transitionEventIds: ['a', 'b', 'c'], startAgainst: 3, terminalWinnerTeamId: f.team.id })]);
    expect(row.roundImpact?.pointsPerCountedRound).toBe(0.08);
    expect(row.roundImpact?.appliedMatchCap).toBe(true);
  });

  it('recognizes a genuine solo recovery in a lost round without a victory bonus', () => {
    const f = synthetic(1, 4, false);
    f.match.events = [f.kill('a', 0, 10), f.kill('b', 1, 40), f.event('lost', 'PLAYER_DEATH', f.enemy.playerIds[2]!, f.playerId, 60)];
    const round = f.prepare().timeline.rounds[0]!;
    expect(evaluateRoundImpact(round, f.playerId, f.team.id)).toMatchObject({ kind: 'DEFICIT_RECOVERY_SEQUENCE',
      transitionEventIds: ['a', 'b'], terminalWinnerTeamId: f.enemy.id, endDifference: -1 });
  });

  it('requires two attributable transitions to reinstate team parity', () => {
    const f = synthetic(2, 4, false);
    f.match.events = [f.kill('a', 0, 10), f.kill('b', 1, 35)];
    expect(evaluateRoundImpact(f.prepare().timeline.rounds[0]!, f.playerId, f.team.id)).toMatchObject({
      kind: 'DEFICIT_RECOVERY_SEQUENCE', startAllies: 2, endDifference: 0,
    });
    f.match.events[1] = f.kill('b', 1, 35, f.team.playerIds[1]!);
    expect(evaluateRoundImpact(f.prepare().timeline.rounds[0]!, f.playerId, f.team.id)).toBeNull();
  });

  it.each(['CT', 'T'] as const)('requires an owned and ordered postplant conversion on %s', (side) => {
    const f = synthetic(2, 3, true);
    const [teammate, opponent] = [f.team.playerIds[1]!, f.enemy.playerIds[1]!];
    f.round.sideByTeamId = { [f.team.id]: side, [f.enemy.id]: side === 'CT' ? 'T' : 'CT' };
    const plant = f.event('plant', 'BOMB_PLANTED', side === 'CT' ? opponent : f.playerId, null, 3);
    const terminal = f.event('terminal', side === 'CT' ? 'BOMB_DEFUSED' : 'BOMB_EXPLODED', side === 'CT' ? f.playerId : null, null, 45);
    f.match.events = [plant, f.kill('recovery', 0, 15), terminal];
    expect(evaluateRoundImpact(f.prepare().timeline.rounds[0]!, f.playerId, f.team.id)).toMatchObject({
      kind: 'POSTPLANT_CONVERSION', objectiveCompletionEventId: 'terminal', transitionEventIds: ['recovery'], entryEventIds: ['plant'],
    });
    f.match.events = [plant, terminal];
    expect(evaluateRoundImpact(f.prepare().timeline.rounds[0]!, f.playerId, f.team.id)).toBeNull();
    f.match.events = [side === 'T' ? { ...plant, actorId: teammate } : plant, f.kill('recovery', 0, 15),
      side === 'CT' ? { ...terminal, actorId: teammate } : terminal];
    expect(evaluateRoundImpact(f.prepare().timeline.rounds[0]!, f.playerId, f.team.id)).toBeNull();
  });

  it('removes the full traded death input and preserves other family inputs and unknown-link deaths', () => {
    const f = synthetic(3, 3);
    const killer = f.enemy.playerIds[0]!;
    f.match.events = [f.event('victim', 'PLAYER_DEATH', killer, f.playerId, 10), f.kill('revenge', 0, 40, f.team.playerIds[1]!)];
    const profiles = f.prepare().profiles;
    const victim = profiles.find((p) => p.playerId === f.playerId)!;
    for (const row of [victim.prepared.p4BPlus, victim.prepared.p4CPlus]) {
      row.familyContributions!.DEATH_RELATED = -0.001;
      row.episodeContributions = [{ anchorId: 'victim', chosenAxis: 'ownDeaths', base: -0.1, family: 'DEATH_RELATED', tags: [] }];
    }
    const data = prepareJointEvidence(f.match, profiles, [f.start], []);
    const full = projectH3(data);
    expect(full.players.find((p) => p.playerId === f.playerId)?.rawFamilyInputs?.DEATH_RELATED).toBeCloseTo(0.009, 12);
    expect(full.actionLedger.filter((r) => r.playerId === f.playerId && r.mechanism === 'E2'))
      .toEqual([expect.objectContaining({ anchorId: 'victim', inputDelta: expect.closeTo(0.01, 12), cap: null })]);
    expect(full.players.find((p) => p.playerId === f.playerId)?.rawFamilyInputs?.COMBAT)
      .toBe(data.baseline.find((p) => p.playerId === f.playerId)?.rawFamilyInputs?.COMBAT);
    const unknown = prepareJointEvidence({ ...f.match, tickRate: null }, profiles, [f.start], []);
    expect(projectH3(unknown).players.find((p) => p.playerId === f.playerId)?.rawFamilyInputs?.DEATH_RELATED).toBe(-0.001);
  });

  it('runs E6 on the joint H3 context winner with complete pools and never treats missing gear as cheap', () => {
    const f = synthetic(2, 4, false);
    f.match.events = [f.kill('combat', 0, 10)];
    const profiles = f.prepare().profiles;
    const snapshots: EquipmentSnapshotObservation[] = f.match.players.map((p) => ({
      evidenceId: `equipment:${p.id}`, matchId: f.match.matchId, roundId: f.round.id, playerId: p.id, teamId: p.teamId,
      side: f.round.sideByTeamId[p.teamId] ?? null, tick: f.round.freezeEndTick!, phase: 'FREEZE_END',
      equipmentValue: p.teamId === f.team.id ? 900 : 4500, roundStartEquipmentValue: null,
      inventory: null, activeWeapon: null, activeWeaponEntityId: null, armor: null, hasHelmet: null, hasDefuser: null,
      balance: null, cashSpentThisRound: null, totalCashSpent: null, alive: null, provenance: 'SYNTHETIC_TEST',
    }));
    const ready = projectH3(prepareJointEvidence(f.match, profiles, [f.start], snapshots));
    const withheld = projectH3(prepareJointEvidence(f.match, profiles, [f.start], snapshots.filter((s) => s.playerId !== f.enemy.playerIds[4])));
    expect(ready.actionLedger.filter((r) => r.mechanism === 'E6' && r.anchorId === 'combat')).toHaveLength(1);
    expect(withheld.actionLedger.some((r) => r.mechanism === 'E6' && r.anchorId === 'combat')).toBe(false);
    expect(ready.players.find((p) => p.playerId === f.playerId)?.rawFamilyInputs?.COMBAT)
      .toBe(withheld.players.find((p) => p.playerId === f.playerId)?.rawFamilyInputs?.COMBAT);
    expect(withheld.actionLedger.some((r) => r.mechanism === 'E5' && r.anchorId === 'combat' && r.reason === 'STATE_CONTEXT_REPLACEMENT')).toBe(true);
    expect(ready.players.find((p) => p.playerId === f.playerId)?.roundImpact?.awards).toEqual([]);
  });

  it('withholds passive survival, isolated ordinary advantage kills, and ambiguous same-tick sequences', () => {
    const f = synthetic(1, 3, true);
    expect(evaluateRoundImpact(f.prepare().timeline.rounds[0]!, f.playerId, f.team.id)).toBeNull();
    f.match.events = [f.kill('a', 0, 10, f.playerId, 1), f.kill('b', 1, 10, f.playerId, 1)];
    expect(evaluateRoundImpact(f.prepare().timeline.rounds[0]!, f.playerId, f.team.id)).toBeNull();
    const regular = synthetic(4, 3, true);
    regular.match.events = [regular.kill('a', 0, 10), regular.kill('b', 1, 40)];
    expect(evaluateRoundImpact(regular.prepare().timeline.rounds[0]!, regular.playerId, regular.team.id)).toBeNull();
  });

  it('distinguishes a verified zero for ROUND_IMPACT from missing and partial timeline evidence', () => {
    const f = synthetic(3, 3);
    const absent = f.prepare();
    const withhold = { ...absent, timeline: { ...absent.timeline, rounds: absent.timeline.rounds.map((r) => ({ ...r, coverageStatus: 'PARTIAL' as const })) } };
    const row = projectH3(absent).players[0]!;
    const unavailable = projectH3(withhold).players[0]!;
    expect(row.roundImpact?.availability).toBe('AVAILABLE');
    expect(row.rawFamilyInputs?.ROUND_IMPACT).toBe(0);
    expect(unavailable.roundImpact?.availability).toBe('UNAVAILABLE');
    expect(unavailable.rawFamilyInputs?.ROUND_IMPACT).toBeNull();
    expect(unavailable.finalAttribution?.ROUND_IMPACT).toBeNull();
    expect(unavailable.rating).toBe(row.rating);
  });

  it('uses confirmed utility effect inside the usage budget and keeps unknown smoke and friendly-only evidence distinct', () => {
    const f = synthetic(2, 3);
    f.match.events = [
      f.event('flash', 'FLASH_DETONATE', f.playerId, null, 10, { entityId: 1 }),
      f.event('enemy-blind', 'PLAYER_BLIND', f.playerId, f.enemy.playerIds[0]!, 11, { entityId: 1, blindDuration: 2 }),
      f.event('friendly-blind', 'PLAYER_BLIND', f.playerId, f.team.playerIds[1]!, 11, { entityId: 1, blindDuration: 2 }),
      f.event('smoke', 'SMOKE_DETONATE', f.playerId, null, 40, { entityId: 2 }),
    ];
    const row = projectH3(f.prepare()).players.find((p) => p.playerId === f.playerId)!;
    expect(row.utility!.uses).toEqual(expect.arrayContaining([
      expect.objectContaining({ useEventId: 'flash', creditBasis: 'VERIFIED_ENTITY_EFFECT', effectEvidenceIds: ['enemy-blind'] }),
      expect.objectContaining({ useEventId: 'smoke', creditBasis: 'EFFECT_UNAVAILABLE', effectEvidenceIds: [], weightFactor: 1 }),
    ]));
    expect(row.utility?.rounds[0]).toMatchObject({ effect: 0 });
    expect(row.utility?.supportInput).toBeCloseTo(0.00185, 12);
  });

  it('places one efficacy slot on a player/round/type bundle without claiming projectile identity', () => {
    const f = synthetic(2, 3);
    f.match.events = [
      f.event('he1', 'HE_DETONATE', f.playerId, null, 10, { entityId: 1 }),
      f.event('he2', 'HE_DETONATE', f.playerId, null, 20, { entityId: 2 }),
      f.event('damage', 'PLAYER_HURT', f.playerId, f.enemy.playerIds[0]!, 21, { weapon: 'hegrenade', rawHealthDamage: 30, healthAfter: 70 }),
    ];
    const data = f.prepare();
    const row = projectH3(data).players.find((p) => p.playerId === f.playerId)!;
    expect(row.utility?.uses.filter((use) => use.creditBasis === 'VERIFIED_ROUND_TYPE_EFFECT')).toHaveLength(1);
    expect(row.rawFamilyInputs?.COMBAT).toBe(data.baseline.find((p) => p.playerId === f.playerId)?.rawFamilyInputs?.COMBAT);
  });

  it('preserves ineligible rows, verifies input permutation, and maps event codes to explicit properties', () => {
    const f = synthetic(2, 4, false);
    f.match.events = [f.kill('a', 0, 10), f.kill('b', 1, 40)];
    const data = f.prepare();
    const ineligible = data.profiles.find((p) => p.playerId !== f.playerId)!;
    const profiles = data.profiles.map((p) => p === ineligible ? { ...p, status: 'PARTICIPATION_EVIDENCE_UNKNOWN' as const } : p);
    const left = projectH3(prepareJointEvidence(f.match, profiles, [f.start], []));
    const right = projectH3(prepareJointEvidence({ ...f.match, events: [...f.match.events].reverse() }, [...profiles].reverse(), [f.start], []));
    expect(left).toEqual(right);
    expect(left.players.find((row) => row.playerId === ineligible.playerId)).toMatchObject({ rating: null, finalAttribution: null });
    expect(NORMALIZED_FACT_MAP.PLAYER_DEATH).toContain('clutchConversion');
    expect(Object.values(NORMALIZED_FACT_MAP).flat().every((key) => Object.hasOwn(COVERAGE, key))).toBe(true);
    expect(Object.entries(COVERAGE).filter(([, row]) => row[2].startsWith('ROUND_IMPACT,')).map(([key]) => key))
      .toEqual(['postplantConversion', 'deficitRecoverySequence', 'clutchConversion']);
    for (const [key, row] of Object.entries(COVERAGE)) {
      if (row[1] === 'FULLY_SCORED' || row[1] === 'PARTIALLY_SCORED') expect(H2_FAMILY_COVERAGE[key as keyof typeof COVERAGE]).toBeTruthy();
    }
  });
});
