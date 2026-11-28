import { describe, expect, it } from 'vitest';
import type { MatchData, MatchEvent, MatchRound } from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import {
  PARTICIPATION_FAMILY_POLICY,
  prepareEvpMatchInput,
  projectParticipationRatings,
  type ParticipationEpisodeContribution,
} from '@who-ruined/scoring';
import { syntheticValidMatch } from '@who-ruined/testkit';

import {
  H2_E3_CONFIGURATIONS,
  evaluateH2E3Experiment,
  extractUtilityEvidence,
  projectUtilityContribution,
  type H2E3ResearchProfile,
  type UtilityType,
} from '@who-ruined/scoring/h3';

type EventInput = {
  id: string;
  kind: string;
  tick?: number;
  actorId?: string | null;
  targetId?: string | null;
  assisterId?: string | null;
  round?: MatchRound;
  attrs?: MatchEvent['attrs'];
  rowIndex?: number;
  phase?: NonNullable<MatchEvent['context']>['phase'];
};

function event(match: MatchData, input: EventInput): MatchEvent {
  const round = input.round ?? match.rounds[0]!;
  const actorId = input.actorId === undefined ? match.teams[0]!.playerIds[0]! : input.actorId;
  const targetId = input.targetId === undefined ? null : input.targetId;
  const teamByPlayer = new Map(match.players.map((player) => [player.id, player.teamId]));
  const actorTeamId = actorId ? teamByPlayer.get(actorId) ?? null : null;
  const targetTeamId = targetId ? teamByPlayer.get(targetId) ?? null : null;
  return {
    id: input.id,
    kind: input.kind,
    roundId: round.id,
    tick: input.tick ?? round.freezeEndTick! + 100,
    actorId,
    targetId,
    assisterId: input.assisterId ?? null,
    attrs: input.attrs ?? {},
    context: {
      phase: input.phase ?? 'LIVE', actorTeamId, targetTeamId,
      actorSide: actorTeamId ? round.sideByTeamId[actorTeamId] ?? null : null,
      targetSide: targetTeamId ? round.sideByTeamId[targetTeamId] ?? null : null,
      aliveByTeamId: null, secondsFromFreezeEnd: null, bombState: null,
      actorEquipmentValue: null, actorMoney: null,
    },
    source: { eventName: input.kind.toLowerCase(), rowIndex: input.rowIndex ?? 1 },
  };
}

function fixture(events: EventInput[]): MatchData {
  const match = syntheticValidMatch();
  match.events = events.map((input) => event(match, input));
  return match;
}

function profile(
  match: MatchData,
  options: {
    playerId?: string;
    status?: H2E3ResearchProfile['status'];
    countedRoundIds?: string[];
    episodes?: ParticipationEpisodeContribution[];
  } = {},
): H2E3ResearchProfile {
  const playerId = options.playerId ?? match.teams[0]!.playerIds[0]!;
  const identity = match.players.find((player) => player.id === playerId)!;
  const episodes = options.episodes ?? [];
  const contributions = { COMBAT: 0, SUPPORT: 0, DEATH_RELATED: 0, DIRECT_HARM: 0 };
  for (const episode of episodes) {
    contributions[episode.family] += episode.base * PARTICIPATION_FAMILY_POLICY.scoreScale;
  }
  const row = {
    status: 'CALCULATED_RESEARCH_ONLY' as const,
    reason: null,
    familyContributions: contributions,
    objectiveSignals: { 'objective:plants': 0, 'objective:defuses': 0 },
    episodeContributions: episodes,
  };
  return {
    profileKey: `${match.matchId}:${playerId}`,
    playerId,
    teamId: identity.teamId,
    status: options.status ?? 'ELIGIBLE',
    reason: options.status && options.status !== 'ELIGIBLE' ? 'SYNTHETIC_UNRELIABLE_PARTICIPATION' : null,
    countedRoundIds: options.countedRoundIds ?? match.rounds.map((round) => round.id),
    prepared: { profileKey: `${match.matchId}:${playerId}`, scenario: 'BOMB', p4BPlus: structuredClone(row), p4CPlus: structuredClone(row) },
  };
}

function roundEvidence(match: MatchData, type: UtilityType) {
  return extractUtilityEvidence(match).rounds.find((row) => row.utilityType === type)!;
}

const config = H2_E3_CONFIGURATIONS[0]!;

describe('H2-E3 utility contribution research (synthetic fixtures)', () => {
  it('1. credits confirmed HE detonation even without damage', () => {
    const match = fixture([{ id: 'he', kind: 'HE_DETONATE', attrs: { entityId: 1 } }]);
    const row = roundEvidence(match, 'HE');
    const projected = projectUtilityContribution(extractUtilityEvidence(match), profile(match), config, 'NAIVE_USAGE_AND_EFFECT');
    expect(row).toMatchObject({ enemyDamage: 0, effectivenessAvailability: 'AVAILABLE' });
    expect(projected.usage).toBeGreaterThan(0);
    expect(projected.effect).toBe(0);
  });

  it('2. records confirmed HE enemy damage', () => {
    const match = syntheticValidMatch();
    const actor = match.teams[0]!.playerIds[0]!;
    const enemy = match.teams[1]!.playerIds[0]!;
    match.events = [
      event(match, { id: 'he', kind: 'HE_DETONATE', actorId: actor, attrs: { entityId: 1 }, rowIndex: 1 }),
      event(match, { id: 'hurt', kind: 'PLAYER_HURT', actorId: actor, targetId: enemy, attrs: { weapon: 'hegrenade', rawHealthDamage: 40, healthAfter: 60 }, rowIndex: 2 }),
    ];
    expect(roundEvidence(match, 'HE')).toMatchObject({ enemyDamage: 40, damageAnchorIds: ['hurt'], effectivenessAvailability: 'AVAILABLE' });
  });

  it('3. does not convert missing HE rawHealthDamage to zero', () => {
    const match = syntheticValidMatch();
    const [actor, enemy] = [match.teams[0]!.playerIds[0]!, match.teams[1]!.playerIds[0]!];
    match.events = [
      event(match, { id: 'he', kind: 'HE_DETONATE', actorId: actor }),
      event(match, { id: 'hurt', kind: 'PLAYER_HURT', actorId: actor, targetId: enemy, attrs: { weapon: 'hegrenade', rawHealthDamage: null, healthAfter: 60 } }),
    ];
    expect(roundEvidence(match, 'HE')).toMatchObject({ enemyDamage: null, effectivenessAvailability: 'UNAVAILABLE', unavailableReasons: ['DAMAGE_LEDGER_INCOMPLETE'] });
  });

  it('4. makes HE effectiveness unavailable after a damaged target HP ledger', () => {
    const match = syntheticValidMatch();
    const [actor, enemy, other] = [match.teams[0]!.playerIds[0]!, match.teams[1]!.playerIds[0]!, match.teams[0]!.playerIds[1]!];
    match.events = [
      event(match, { id: 'bad', kind: 'PLAYER_HURT', actorId: other, targetId: enemy, tick: 1200, attrs: { weapon: 'ak47', rawHealthDamage: 20, healthAfter: 10 }, rowIndex: 1 }),
      event(match, { id: 'he', kind: 'HE_DETONATE', actorId: actor, tick: 1210, rowIndex: 2 }),
      event(match, { id: 'hurt', kind: 'PLAYER_HURT', actorId: actor, targetId: enemy, tick: 1210, attrs: { weapon: 'hegrenade', rawHealthDamage: 10, healthAfter: 0 }, rowIndex: 3 }),
    ];
    expect(roundEvidence(match, 'HE').enemyDamage).toBeNull();
  });

  it('5. credits confirmed inferno start without inventing damage', () => {
    const match = fixture([{ id: 'fire', kind: 'INFERNO_START', attrs: { entityId: 10 } }]);
    expect(extractUtilityEvidence(match).uses[0]).toMatchObject({ utilityType: 'FIRE', observationState: 'EFFECT_CONFIRMED' });
    expect(roundEvidence(match, 'FIRE').enemyDamage).toBe(0);
  });

  it('6. sums multiple confirmed inferno damage ticks through one HP ledger', () => {
    const match = syntheticValidMatch();
    const [actor, enemy] = [match.teams[0]!.playerIds[0]!, match.teams[1]!.playerIds[0]!];
    match.events = [
      event(match, { id: 'fire', kind: 'INFERNO_START', actorId: actor, tick: 1200, attrs: { entityId: 9 }, rowIndex: 1 }),
      event(match, { id: 'hurt-1', kind: 'PLAYER_HURT', actorId: actor, targetId: enemy, tick: 1210, attrs: { weapon: 'inferno', rawHealthDamage: 8, healthAfter: 92 }, rowIndex: 2 }),
      event(match, { id: 'hurt-2', kind: 'PLAYER_HURT', actorId: actor, targetId: enemy, tick: 1220, attrs: { weapon: 'inferno', rawHealthDamage: 7, healthAfter: 85 }, rowIndex: 3 }),
    ];
    expect(roundEvidence(match, 'FIRE').enemyDamage).toBe(15);
  });

  it('7. deduplicates repeated INFERNO_START for the same entity', () => {
    const match = fixture([
      { id: 'fire-a', kind: 'INFERNO_START', attrs: { entityId: 9 }, rowIndex: 1 },
      { id: 'fire-b', kind: 'INFERNO_START', attrs: { entityId: 9 }, rowIndex: 2 },
    ]);
    const evidence = extractUtilityEvidence(match);
    expect(evidence.uses).toHaveLength(1);
    expect(evidence.diagnostics.duplicateUsageEventIds).toEqual(['fire-b']);
  });

  it('8. keeps a flash without effect as confirmed usage and zero effect', () => {
    const match = fixture([{ id: 'flash', kind: 'FLASH_DETONATE', attrs: { entityId: 4 } }]);
    expect(roundEvidence(match, 'FLASH')).toMatchObject({ enemyBlindSeconds: 0, flashAssists: 0, effectivenessAvailability: 'AVAILABLE' });
  });

  it('9. records confirmed enemy blind duration', () => {
    const match = syntheticValidMatch();
    const [actor, enemy] = [match.teams[0]!.playerIds[0]!, match.teams[1]!.playerIds[0]!];
    match.events = [
      event(match, { id: 'flash', kind: 'FLASH_DETONATE', actorId: actor, attrs: { entityId: 4 }, rowIndex: 1 }),
      event(match, { id: 'blind', kind: 'PLAYER_BLIND', actorId: actor, targetId: enemy, attrs: { entityId: 4, blindDuration: 2.5 }, rowIndex: 2 }),
    ];
    expect(roundEvidence(match, 'FLASH')).toMatchObject({
      enemyBlindSeconds: 2.5,
      effectEventIds: ['blind'],
      linkedUsageEventIds: ['flash'],
      effectLinkage: 'EXACT_ENTITY',
      effectivenessAvailability: 'AVAILABLE',
    });
  });

  it('10. merges overlapping blind intervals for the same target', () => {
    const match = syntheticValidMatch();
    const [actor, enemy] = [match.teams[0]!.playerIds[0]!, match.teams[1]!.playerIds[0]!];
    match.events = [
      event(match, { id: 'flash-1', kind: 'FLASH_DETONATE', actorId: actor, tick: 1200, attrs: { entityId: 4 }, rowIndex: 1 }),
      event(match, { id: 'blind-1', kind: 'PLAYER_BLIND', actorId: actor, targetId: enemy, tick: 1200, attrs: { entityId: 4, blindDuration: 2 }, rowIndex: 2 }),
      event(match, { id: 'flash-2', kind: 'FLASH_DETONATE', actorId: actor, tick: 1264, attrs: { entityId: 5 }, rowIndex: 3 }),
      event(match, { id: 'blind-2', kind: 'PLAYER_BLIND', actorId: actor, targetId: enemy, tick: 1264, attrs: { entityId: 5, blindDuration: 2 }, rowIndex: 4 }),
    ];
    expect(roundEvidence(match, 'FLASH').enemyBlindSeconds).toBeCloseTo(3, 12);
  });

  it('11. records a confirmed flash assist but excludes it from exact reallocation', () => {
    const match = syntheticValidMatch();
    const [actor, killer, enemy] = [match.teams[0]!.playerIds[0]!, match.teams[0]!.playerIds[1]!, match.teams[1]!.playerIds[0]!];
    match.events = [
      event(match, { id: 'flash', kind: 'FLASH_DETONATE', actorId: actor, attrs: { entityId: 4 }, rowIndex: 1 }),
      event(match, { id: 'death', kind: 'PLAYER_DEATH', actorId: killer, targetId: enemy, assisterId: actor, attrs: { assistedFlash: true }, rowIndex: 2 }),
    ];
    const evidence = extractUtilityEvidence(match);
    expect(roundEvidence(match, 'FLASH')).toMatchObject({ flashAssists: 1, flashAssistAnchorIds: ['death'], effectLinkage: 'ROUND_LEVEL_ONLY' });
    expect(projectUtilityContribution(evidence, profile(match), config, 'REALLOCATED_USAGE_AND_EFFECT').effect).toBe(0);
  });

  it('12. keeps smoke tactical effectiveness unavailable without a spatial model', () => {
    const match = fixture([{ id: 'smoke', kind: 'SMOKE_DETONATE', attrs: { entityId: 2 } }]);
    expect(roundEvidence(match, 'SMOKE')).toMatchObject({ effectivenessAvailability: 'UNAVAILABLE', unavailableReasons: ['SMOKE_SPATIAL_EFFECT_UNAVAILABLE'] });
  });

  it('13. rejects usage credit when the owner is unknown', () => {
    const match = fixture([{ id: 'he', kind: 'HE_DETONATE', actorId: null }]);
    const evidence = extractUtilityEvidence(match);
    expect(evidence.uses).toEqual([]);
    expect(evidence.diagnostics.unknownOwnerEventIds).toEqual(['he']);
  });

  it('14. rejects every occurrence of a repeated event ID', () => {
    const match = fixture([
      { id: 'duplicate', kind: 'HE_DETONATE', attrs: { entityId: 1 }, rowIndex: 1 },
      { id: 'duplicate', kind: 'HE_DETONATE', attrs: { entityId: 2 }, rowIndex: 2 },
    ]);
    expect(extractUtilityEvidence(match)).toMatchObject({ uses: [], diagnostics: { duplicateEventIds: ['duplicate'] } });
  });

  it('15. counts multiple same-type grenades once each when their entities differ', () => {
    const match = fixture([
      { id: 'he-1', kind: 'HE_DETONATE', attrs: { entityId: 1 }, rowIndex: 1 },
      { id: 'he-2', kind: 'HE_DETONATE', attrs: { entityId: 2 }, rowIndex: 2 },
    ]);
    expect(roundEvidence(match, 'HE').usageEventIds).toEqual(['he-1', 'he-2']);
  });

  it('16. enforces usage, effect and total round caps', () => {
    const match = fixture(Array.from({ length: 6 }, (_, index) => ({
      id: `he-${index}`, kind: 'HE_DETONATE', attrs: { entityId: index + 1 }, rowIndex: index,
    })));
    const projected = projectUtilityContribution(extractUtilityEvidence(match), profile(match), config, 'USAGE_ONLY');
    expect(projected.rounds[0]).toMatchObject({ usage: config.usageRoundCap, usageCapped: true });
    expect(projected.rounds[0]!.total).toBeLessThanOrEqual(config.totalRoundCap);
  });

  it('17. never penalizes a player who used no grenades', () => {
    const match = fixture([]);
    expect(projectUtilityContribution(extractUtilityEvidence(match), profile(match), config, 'NAIVE_USAGE_AND_EFFECT')).toMatchObject({ usage: 0, effect: 0, total: 0 });
  });

  it('18. withholds overlapping blind duration when tick rate is unknown', () => {
    const match = syntheticValidMatch();
    match.tickRate = null;
    const [actor, enemy] = [match.teams[0]!.playerIds[0]!, match.teams[1]!.playerIds[0]!];
    match.events = [
      event(match, { id: 'flash', kind: 'FLASH_DETONATE', actorId: actor }),
      event(match, { id: 'blind', kind: 'PLAYER_BLIND', actorId: actor, targetId: enemy, attrs: { blindDuration: 2 } }),
    ];
    expect(roundEvidence(match, 'FLASH')).toMatchObject({ enemyBlindSeconds: null, effectivenessAvailability: 'UNAVAILABLE', unavailableReasons: ['TICK_RATE_UNAVAILABLE_FOR_BLIND_INTERVALS'] });
  });

  it('19. does not credit an H2-excluded round', () => {
    const match = fixture([{ id: 'he', kind: 'HE_DETONATE' }]);
    const p = profile(match, { countedRoundIds: match.rounds.slice(1).map((round) => round.id) });
    expect(projectUtilityContribution(extractUtilityEvidence(match), p, config, 'USAGE_ONLY').total).toBe(0);
  });

  it('20. withholds contribution for unreliable participation', () => {
    const match = fixture([{ id: 'he', kind: 'HE_DETONATE' }]);
    const p = profile(match, { status: 'PARTICIPATION_EVIDENCE_UNKNOWN' });
    expect(projectUtilityContribution(extractUtilityEvidence(match), p, config, 'USAGE_ONLY').total).toBe(0);
  });

  it('21. excludes friendly damage and blind from positive effect without cancelling production harm', () => {
    const match = syntheticValidMatch();
    const [actor, teammate] = match.teams[0]!.playerIds;
    match.events = [
      event(match, { id: 'he', kind: 'HE_DETONATE', actorId: actor! }),
      event(match, { id: 'hurt', kind: 'PLAYER_HURT', actorId: actor!, targetId: teammate!, attrs: { weapon: 'hegrenade', rawHealthDamage: 20, healthAfter: 80 } }),
      event(match, { id: 'flash', kind: 'FLASH_DETONATE', actorId: actor! }),
      event(match, { id: 'blind', kind: 'PLAYER_BLIND', actorId: actor!, targetId: teammate!, attrs: { blindDuration: 2 } }),
    ];
    const evidence = extractUtilityEvidence(match);
    expect(evidence.rounds.flatMap((row) => row.friendlyEffectEventIds).sort()).toEqual(['blind', 'hurt']);
    expect(evidence.rounds.reduce((sum, row) => sum + (row.enemyDamage ?? 0) + (row.enemyBlindSeconds ?? 0), 0)).toBe(0);
  });

  it('22. reallocates an exact grenade COMBAT anchor before adding explicit effectiveness', () => {
    const match = syntheticValidMatch();
    const [actor, enemy] = [match.teams[0]!.playerIds[0]!, match.teams[1]!.playerIds[0]!];
    match.events = [
      event(match, { id: 'he', kind: 'HE_DETONATE', actorId: actor, rowIndex: 1 }),
      event(match, { id: 'hurt', kind: 'PLAYER_HURT', actorId: actor, targetId: enemy, attrs: { weapon: 'hegrenade', rawHealthDamage: 40, healthAfter: 60 }, rowIndex: 2 }),
    ];
    const p = profile(match, { episodes: [{ anchorId: 'hurt', chosenAxis: 'enemyHp', family: 'COMBAT', base: 0.2, tags: [] }] });
    const result = evaluateH2E3Experiment(match, [p]).configurations[0]!;
    expect(result.reallocatedUsageAndEffect[0]!.exactReallocationAnchorIds).toEqual(['hurt']);
    expect(result.reallocatedUsageAndEffect[0]!.h2AfterReallocation).toBeLessThan(result.reallocatedUsageAndEffect[0]!.baselineRating!);
    expect(result.naiveUsageAndEffect[0]!.rating).toBeGreaterThan(result.usageOnly[0]!.rating!);
  });

  it('23. distinguishes confirmed zero from unknown effectiveness', () => {
    const known = fixture([{ id: 'he', kind: 'HE_DETONATE' }]);
    const unknown = syntheticValidMatch();
    const [actor, enemy] = [unknown.teams[0]!.playerIds[0]!, unknown.teams[1]!.playerIds[0]!];
    unknown.events = [
      event(unknown, { id: 'he', kind: 'HE_DETONATE', actorId: actor }),
      event(unknown, { id: 'hurt', kind: 'PLAYER_HURT', actorId: actor, targetId: enemy, attrs: { weapon: 'hegrenade', rawHealthDamage: null, healthAfter: null } }),
    ];
    expect(roundEvidence(known, 'HE')).toMatchObject({ enemyDamage: 0, effectivenessAvailability: 'AVAILABLE' });
    expect(roundEvidence(unknown, 'HE')).toMatchObject({ enemyDamage: null, effectivenessAvailability: 'UNAVAILABLE' });
  });

  it('24. is invariant to input event order', () => {
    const match = fixture([
      { id: 'he', kind: 'HE_DETONATE', tick: 1250, attrs: { entityId: 1 }, rowIndex: 2 },
      { id: 'smoke', kind: 'SMOKE_DETONATE', tick: 1200, attrs: { entityId: 2 }, rowIndex: 1 },
    ]);
    const reversed = structuredClone(match);
    reversed.events.reverse();
    expect(extractUtilityEvidence(reversed)).toEqual(extractUtilityEvidence(match));
  });

  it('25. does not mutate production H2, M2 or EVP inputs', () => {
    const match = fixture([{ id: 'he', kind: 'HE_DETONATE' }]);
    const p = profile(match);
    const generatedAt = '2026-11-17T00:00:00.000Z';
    const artifact = { schemaVersion: 'm2-artifact-1' as const, match, analytics: computeMatchAnalytics(match, generatedAt) };
    const h2Before = projectParticipationRatings([p]);
    const m2Before = structuredClone(artifact.analytics);
    const participation = match.players.map((player) => ({ playerId: player.id, eligible: true, verifiedRounds: match.rounds.length, unknownRounds: 0, reasonCodes: [] }));
    const evpBefore = prepareEvpMatchInput({ artifact, participation, mvpPlayerId: null, scenario: 'BOMB' });
    evaluateH2E3Experiment(match, [p]);
    expect(projectParticipationRatings([p])).toEqual(h2Before);
    expect(computeMatchAnalytics(match, generatedAt)).toEqual(m2Before);
    expect(prepareEvpMatchInput({ artifact, participation, mvpPlayerId: null, scenario: 'BOMB' })).toEqual(evpBefore);
  });

  it('26. reconstructs every experimental rating from its explicit components', () => {
    const match = fixture([{ id: 'he', kind: 'HE_DETONATE' }]);
    const result = evaluateH2E3Experiment(match, [profile(match)]);
    for (const configuration of result.configurations) {
      for (const variant of [configuration.usageOnly, configuration.naiveUsageAndEffect, configuration.reallocatedUsageAndEffect]) {
        const row = variant[0]!;
        expect(row.rating).toBeCloseTo(row.h2AfterReallocation! + row.usageContribution + row.effectContribution, 14);
      }
    }
  });
});
