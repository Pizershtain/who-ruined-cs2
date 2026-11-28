import { describe, expect, it } from 'vitest';
import type { MatchEvent } from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import { prepareEvpMatchInput, projectParticipationRatings, projectParticipationResearchRatings, type ParticipationEpisodeContribution } from '@who-ruined/scoring';
import { syntheticValidMatch } from '@who-ruined/testkit';

import { neutralizeDeathAnchor } from '@who-ruined/scoring/h3';
import { projectUtilityContribution } from '@who-ruined/scoring/h3';
import type { RoundStartEvidence } from '@who-ruined/scoring/h3';
import { reconstructEquipmentSnapshots, type EquipmentSnapshotObservation } from '@who-ruined/scoring/h3';
import { CANDIDATES, NOMINAL, type CandidateId } from '@who-ruined/scoring/h3';
import { prepareJointEvidence, projectJointPolicy } from '@who-ruined/scoring/h3';

function synthetic() {
  const match = syntheticValidMatch();
  const first = match.rounds[0]!;
  const second = { ...structuredClone(first), id: 'second', ordinal: 2, startTick: first.endTick + 1,
    freezeEndTick: first.endTick + 2, endTick: first.endTick + 500 };
  match.rounds = [first, second];
  const [a, b] = match.teams.map((team) => team.playerIds);
  const player = a![0]!;
  const team = match.teams[0]!.id;
  const teamFor = (id: string | null) => match.players.find((p) => p.id === id)?.teamId ?? null;
  first.winnerTeamId = match.teams[1]!.id;
  const event = (id: string, kind: string, actorId: string | null, targetId: string | null, offset: number,
    attrs: MatchEvent['attrs'] = {}, round = first): MatchEvent => ({
    id, kind, actorId, targetId, assisterId: null, tick: round.freezeEndTick! + offset, roundId: round.id, attrs,
    context: { phase: 'LIVE', actorTeamId: teamFor(actorId), targetTeamId: teamFor(targetId), actorSide: null,
      targetSide: null, aliveByTeamId: null, secondsFromFreezeEnd: null, bombState: null, actorEquipmentValue: null, actorMoney: null },
    source: { eventName: kind.toLowerCase(), rowIndex: offset },
  });
  match.events = [
    event('opening', 'PLAYER_DEATH', player, b![0]!, 10),
    event('second-kill', 'PLAYER_DEATH', player, b![1]!, 40),
    event('traded-death', 'PLAYER_DEATH', b![2]!, player, 70),
    event('revenge', 'PLAYER_DEATH', a![1]!, b![2]!, 100),
    event('ordinary-death', 'PLAYER_DEATH', b![1]!, player, 20, {}, second),
    event('grenade', 'HE_DETONATE', player, null, 4, { entityId: 12 }),
    event('grenade-effect', 'PLAYER_HURT', player, b![0]!, 5, { weapon: 'hegrenade', rawHealthDamage: 20, healthAfter: 80 }),
  ];
  const physical = (anchorId: string, family: ParticipationEpisodeContribution['family'], base: number, tags: string[] = []) => ({
    anchorId, family, base, tags, chosenAxis: anchorId === 'grenade-effect' ? 'enemyHp' : family === 'COMBAT' ? 'enemyKills' : 'ownDeaths',
  });
  const episodes = [
    physical('opening', 'COMBAT', 0.1, ['OPENING', 'MULTI_KILL', 'TRADE', 'ALIVE_LEAD_TAKEN', 'LOW_EQUIP_COMBAT']),
    physical('second-kill', 'COMBAT', 0.035),
    physical('grenade-effect', 'COMBAT', 0.2),
    physical('traded-death', 'DEATH_RELATED', -0.15),
    physical('ordinary-death', 'DEATH_RELATED', -0.2),
  ];
  const profiles = match.players.map((identity) => {
    const key = `${match.matchId}:${identity.id}`;
    const prepared = {
      status: 'CALCULATED_RESEARCH_ONLY' as const,
      familyContributions: { COMBAT: 0.03, SUPPORT: -0.025, DEATH_RELATED: -0.11, DIRECT_HARM: 0 },
      objectiveSignals: { 'objective:plants': 0, 'objective:defuses': 0 },
      episodeContributions: identity.id === player ? structuredClone(episodes) : [],
    };
    return { profileKey: key, playerId: identity.id, teamId: identity.teamId, status: 'ELIGIBLE' as const, reason: null,
      countedRoundIds: match.rounds.map((round) => round.id),
      prepared: { profileKey: key, scenario: 'BOMB' as const, p4BPlus: structuredClone(prepared), p4CPlus: structuredClone(prepared) } };
  });
  const starts: RoundStartEvidence[] = match.rounds.map((round) => ({
    roundId: round.id, liveStart: round.freezeEndTick!, liveEnd: round.endTick, boundaryComplete: true,
    boundaryReasons: [], scenario: 'BOMB', players: match.players.map((p) => ({
      playerId: p.id, classification: 'PRESENT_VERIFIED', counted: true, startObserved: true, startAlive: true,
    })), supplementalEvents: [],
  }));
  const snapshots: EquipmentSnapshotObservation[] = match.rounds.flatMap((round) => match.players.map((identity) => ({
    evidenceId: `${round.id}/${identity.id}`, matchId: match.matchId, roundId: round.id, playerId: identity.id,
    teamId: identity.teamId, side: round.sideByTeamId[identity.teamId] ?? null, tick: round.freezeEndTick!,
    phase: 'FREEZE_END', equipmentValue: identity.teamId === team ? 1_000 : 4_000, roundStartEquipmentValue: null,
    inventory: null, activeWeapon: null, activeWeaponEntityId: null, armor: null, hasHelmet: null, hasDefuser: null,
    balance: null, cashSpentThisRound: null, totalCashSpent: null, alive: true, provenance: 'RAW_DEMOPARSER_TICK',
  })));
  return { match, profiles, player, event, snapshots, starts, team, first, second };
}

function evidence(f: ReturnType<typeof synthetic>) {
  return prepareJointEvidence(f.match, f.profiles, f.starts, f.snapshots);
}

describe('H2-E7 joint policy, synthetic evidence', () => {
  it('reconstructs all twelve candidates and keeps C0 exactly equal to the frozen projector', () => {
    const f = synthetic();
    const data = evidence(f);
    expect(projectJointPolicy(data, 'C0').rows).toEqual(projectParticipationRatings(f.profiles)
      .sort((a, b) => a.profileKey.localeCompare(b.profileKey)));
    expect(projectParticipationResearchRatings(data.profiles, new Map())).toEqual(data.baseline);
    for (const id of Object.keys(CANDIDATES) as CandidateId[]) {
      const result = projectJointPolicy(data, id);
      for (const row of result.rows) {
        expect(row.rating).not.toBeNull();
        expect(Object.values(row.rawFamilyInputs!).every(Number.isFinite)).toBe(true);
        expect(1 + Object.values(row.finalAttribution!).reduce((a, x) => a + x, 0)).toBeCloseTo(row.rating!, 12);
      }
    }
    expect(projectJointPolicy(data, 'C6')).toEqual({ ...projectJointPolicy(data, 'C11'), candidate: 'C6' });
  });

  it('neutralizes only the confirmed traded death and reprojects the negative mass', () => {
    const f = synthetic();
    const data = evidence(f);
    const baseline = projectJointPolicy(data, 'C0').rows.find((row) => row.playerId === f.player)!;
    const candidate = projectJointPolicy(data, 'C1');
    const row = candidate.rows.find((r) => r.playerId === f.player)!;
    expect(candidate.ledger.filter((r) => r.playerId === f.player).map((r) => r.anchorId)).toEqual(['traded-death']);
    expect(row.rawFamilyInputs!.DEATH_RELATED).toBeCloseTo(-0.095, 12);
    expect(row.rawFamilyInputs!.COMBAT).toBe(baseline.rawFamilyInputs!.COMBAT);
    expect(row.aggregates!.negativeMass).toBeLessThan(baseline.aggregates!.negativeMass);
    expect(row.rating! - baseline.rating!).not.toBeCloseTo(5 * 0.015, 8);
  });

  it('rejects inconsistent prepared variants atomically and caps recovery at the remaining debit', () => {
    const f = synthetic();
    const profile = f.profiles.find((p) => p.playerId === f.player)!;
    profile.prepared.p4CPlus.episodeContributions = [];
    const before = structuredClone(profile);
    expect(neutralizeDeathAnchor(profile, 'traded-death', 'DEBIT_ONLY')).toBeNull();
    expect(profile).toEqual(before);
    profile.prepared.p4CPlus = structuredClone(profile.prepared.p4BPlus);
    for (const prepared of [profile.prepared.p4BPlus, profile.prepared.p4CPlus]) prepared.familyContributions.DEATH_RELATED = -0.001;
    expect(neutralizeDeathAnchor(profile, 'traded-death', 'DEBIT_ONLY')).toMatchObject({ applied: 0.001, clipped: true });
    expect(profile.prepared.p4BPlus.familyContributions.DEATH_RELATED).toBe(0);
    expect(profile.prepared.p4CPlus).toEqual(profile.prepared.p4BPlus);
    expect(profile.prepared.p4BPlus.episodeContributions.some((row) => row.anchorId === 'ordinary-death')).toBe(true);
  });

  it.each(['unknown tick rate', 'same tick', 'unverified trader exposure'] as const)('withholds a trade with %s', (reason) => {
    const f = synthetic();
    if (reason === 'unknown tick rate') f.match.tickRate = null;
    if (reason === 'same tick') f.match.events.find((e) => e.id === 'revenge')!.tick = f.match.events.find((e) => e.id === 'traded-death')!.tick;
    if (reason === 'unverified trader exposure') {
      const trader = f.match.events.find((e) => e.id === 'revenge')!.actorId;
      f.profiles.find((p) => p.playerId === trader)!.countedRoundIds = [f.second.id];
    }
    expect(projectJointPolicy(evidence(f), 'C1').ledger.some((r) => r.anchorId === 'traded-death')).toBe(false);
  });

  it('keeps utility damage in combat, counts distinct uses and caps spam in SUPPORT', () => {
    const f = synthetic();
    const multiple = Array.from({ length: 15 }, (_, i) => f.event(`use-${i}`, 'HE_DETONATE', f.player, null, 130 + i, { entityId: 200 + i }));
    f.match.events.push(...multiple, f.event('extra-row-for-old-entity', 'HE_DETONATE', f.player, null, 140, { entityId: 12 }));
    const data = evidence(f);
    const result = projectJointPolicy(data, 'C2');
    const original = data.baseline.find((r) => r.playerId === f.player)!;
    const projected = result.rows.find((r) => r.playerId === f.player)!;
    expect(result.ledger).toHaveLength(1);
    expect(result.ledger[0]).toMatchObject({ inputDelta: 0.0011, cap: { round: 0.022, applied: true } });
    expect(result.ledger[0]!.evidenceIds).toHaveLength(16);
    expect(projected.rawFamilyInputs!.COMBAT).toBe(original.rawFamilyInputs!.COMBAT);
    // The old effect branch has exact anchors available but is outside E7.
    const protectedProbe = projectUtilityContribution(data.utility, f.profiles.find((p) => p.playerId === f.player)!,
      { ...NOMINAL.utility, effectRoundCap: 0.0001 }, 'REALLOCATED_USAGE_AND_EFFECT');
    expect(protectedProbe.exactReallocationAnchorIds).toEqual(['grenade-effect']);
    expect(protectedProbe.rounds[0]).toMatchObject({ effectCapped: true, effect: 0.0001 });
  });

  it('picks one context per anchor and keeps a zero-overlap action from consuming R2 diminishing position', () => {
    const f = synthetic();
    const result = projectJointPolicy(evidence(f), 'C3');
    const rows = result.ledger.filter((r) => r.playerId === f.player);
    expect(rows.find((row) => row.anchorId === 'opening')).toMatchObject({ proposedContext: null,
      reason: 'EXISTING_H2_CONTEXT_OR_OBJECTIVE_SEMANTICALLY_COVERS_THE_STATE_CHANGE' });
    const useful = rows.find((row) => row.anchorId === 'second-kill')!;
    expect(useful.reason).toBe('STATE_CONTEXT_REPLACEMENT');
    expect(useful.proposedContext?.multiplier).toBeCloseTo(1 + (0.005 * 0.5) / 2 / 0.035, 12);
    expect(result.rows.find((r) => r.playerId === f.player)!.kernel?.context?.winningTagByAnchor['second-kill']).toBe('ALIVE_LEAD_TAKEN');
  });

  it('preserves frozen economy context for an incomplete pool and removes it for a confirmed non-underdog', () => {
    const f = synthetic();
    const complete = projectJointPolicy(evidence(f), 'C4');
    expect(complete.ledger.some((row) => row.anchorId === 'opening' && row.reason === 'REFINED_LOW_EQUIPMENT')).toBe(true);
    const saved = f.snapshots;
    f.snapshots = saved.filter((row) => row.playerId !== f.match.teams[1]!.playerIds[4]);
    const incomplete = evidence(f);
    expect(incomplete.economy.rejections.some((r) => r.reasons.includes('OPPONENT_TEAM_COMPARISON_INCOMPLETE'))).toBe(true);
    expect(projectJointPolicy(incomplete, 'C4').rows).toEqual(incomplete.baseline);
    f.snapshots = saved.map((row) => ({ ...row, equipmentValue: 1_000 }));
    expect(projectJointPolicy(evidence(f), 'C4').ledger.find((r) => r.anchorId === 'opening')).toMatchObject({
      reason: 'COMPLETE_COMPARISON_FAILS_REFINED_RULE', proposedContext: { multiplier: 1 }, selectedContext: { tag: 'OPENING' },
    });
  });

  it('quarantines conflicting snapshots with identical evidence IDs regardless of order', () => {
    const row = synthetic().snapshots[0]!;
    const conflicting = { ...row, equipmentValue: 8_000 };
    const left = reconstructEquipmentSnapshots([row, conflicting]);
    expect(left).toEqual(reconstructEquipmentSnapshots([conflicting, row]));
    expect(left.snapshots[0]).toMatchObject({ equipmentValue: null, availability: 'UNAVAILABLE', duplicateEvidenceIds: [row.evidenceId] });
  });

  it('handles duplicates, missing evidence, and input permutations without adding rating', () => {
    const f = synthetic();
    const direct = projectJointPolicy(evidence(f), 'C7');
    f.match.events = [...f.match.events.reverse(), structuredClone(f.match.events[0]!)];
    f.profiles.reverse(); f.starts.reverse(); f.snapshots.reverse();
    expect(projectJointPolicy(evidence(f), 'C7')).toEqual(direct);
    f.match.events.push(f.event('unknown', 'SMOKE_DETONATE', null, null, 165));
    expect(projectJointPolicy(evidence(f), 'C7').rows).toEqual(direct.rows);
    f.match.events.push({ ...f.match.events[0]!, tick: f.match.events[0]!.tick + 1 });
    expect(() => evidence(f)).toThrow('E7_CONFLICTING_EVENT_ID');
  });

  it('keeps both coverage exclusions and unknown objective applicability stable', () => {
    const f = synthetic();
    const p = f.profiles.find((profile) => profile.playerId === f.player)!;
    p.countedRoundIds = [f.second.id];
    const excluded = projectJointPolicy(evidence(f), 'C7');
    expect(excluded.ledger.some((row) => row.playerId === f.player && row.roundId === f.first.id)).toBe(false);
    p.countedRoundIds.push(f.first.id);
    const unknown = { ...p, status: 'UNKNOWN_APPLICABILITY' as const, reason: 'SCENARIO_UNKNOWN', prepared: {
      ...p.prepared, scenario: 'UNKNOWN' as const, p4CPlus: { status: 'UNKNOWN_APPLICABILITY' as const, reason: 'SCENARIO_UNKNOWN' },
    } };
    const profiles = f.profiles.map((profile) => profile === p ? unknown : profile);
    const result = projectJointPolicy(prepareJointEvidence(f.match, profiles, f.starts, f.snapshots), 'C7');
    expect(result.rows.find((row) => row.playerId === f.player)?.rawFamilyInputs?.OBJECTIVES).toBe(0);
  });

  it('exposes real nonlinear interactions and leaves frozen H2, M2 and EVP inputs identical', () => {
    const f = synthetic();
    const data = evidence(f);
    const timestamp = '2000-01-01T00:00:00.000Z';
    const snapshot = structuredClone({ episodes: f.profiles, m2: computeMatchAnalytics(f.match, timestamp) });
    const evpSource = (analytics: typeof snapshot.m2) => ({
      artifact: { schemaVersion: 'm2-artifact-1' as const, match: f.match, analytics },
      participation: f.profiles.map((p) => ({ playerId: p.playerId, eligible: true,
        verifiedRounds: p.countedRoundIds.length, unknownRounds: 0, reasonCodes: [] })),
      mvpPlayerId: null, scenario: 'BOMB' as const,
    });
    const evpBefore = prepareEvpMatchInput(evpSource(snapshot.m2));
    const score = (id: CandidateId) => projectJointPolicy(data, id).rows.find((row) => row.playerId === f.player)!.rating!;
    const baseline = score('C0');
    const independent = (['C1', 'C2', 'C3', 'C4'] as const).reduce((n, id) => n + score(id) - baseline, 0);
    expect(score('C7') - baseline).not.toBeCloseTo(independent, 8);
    expect(f.profiles).toEqual(snapshot.episodes);
    const m2After = computeMatchAnalytics(f.match, timestamp);
    expect(m2After).toEqual(snapshot.m2);
    expect(prepareEvpMatchInput(evpSource(m2After))).toEqual(evpBefore);
    expect(projectJointPolicy(data, 'C0').rows).toEqual(data.baseline);
  });
});
