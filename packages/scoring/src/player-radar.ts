import {
  playerRadarAxisIds,
  playerRadarReportSchema,
  h3RadarReportSchema,
  playerRadarWithConfirmedEvidenceSchema,
  radarNormalizationVersion,
  type CanonicalMatchResult,
  type HistoricalMatchResult,
  type H3ExplanationFamily,
  type StoredPlayerRadarReport,
  type EvpReport,
  type EvpSpecializationId,
  type MatchEvent,
  type ParticipationExplanationFamilyRow,
  type PlayerAnalytics,
  type PlayerRadarAxis,
  type PlayerRadarAxisId,
  type PlayerRadarReport,
  type PlayerRadarWithConfirmedEvidence,
  type RadarConfirmedValue,
} from '@who-ruined/contracts';
import { H2_PARTICIPATION_RATING_POLICY } from './participation-policy.js';
import { buildStoredParticipationExplanation } from './participation-explanation.js';

type AxisDefinition = PlayerRadarReport['axisDefinitions'][number];
type AxisDraft = Omit<PlayerRadarAxis, 'matchAverage' | 'comparisonPoolSize' | 'comparisonIncompleteCoverage'>;
type UnavailableReason = NonNullable<PlayerRadarAxis['reasonIfUnavailable']>;
type PlayerFact = PlayerAnalytics['facts'][number];

const METRIC_EPSILON = 1e-9;
const CLUTCH_WEIGHTS: Readonly<Record<string, number>> = Object.freeze({
  '1v1': 1,
  '1v2': 3,
  '1v3': 6,
  '1v4': 10,
  '1v5': 15,
});

const AXIS_DEFINITIONS: readonly AxisDefinition[] = Object.freeze([
  { axisId: 'MULTIKILL', primaryMetricId: 'MULTIKILL_ROUNDS_PER_10_VERIFIED_ROUNDS', unit: 'COUNT_PER_10_VERIFIED_ROUNDS', direction: 'HIGHER_IS_BETTER', normalization: { kind: 'LINEAR_FIXED_CAP', minimum: 0, maximum: 4 }, comparisonPoolRule: 'AVAILABLE_PLAYERS_WITH_SAME_METRIC_AND_DENOMINATOR', limitationCodes: ['CONFIRMED_2_TO_5_KILL_ROUNDS_ONLY'] },
  { axisId: 'ASSISTS', primaryMetricId: 'NON_FLASH_ASSISTS_PER_10_VERIFIED_ROUNDS', unit: 'COUNT_PER_10_VERIFIED_ROUNDS', direction: 'HIGHER_IS_BETTER', normalization: { kind: 'LINEAR_FIXED_CAP', minimum: 0, maximum: 6 }, comparisonPoolRule: 'AVAILABLE_PLAYERS_WITH_SAME_METRIC_AND_DENOMINATOR', limitationCodes: ['FLASH_ASSISTS_EXCLUDED'] },
  { axisId: 'FLASH', primaryMetricId: 'ENEMY_BLIND_SECONDS_PER_VERIFIED_ROUND', unit: 'SECONDS_PER_VERIFIED_ROUND', direction: 'HIGHER_IS_BETTER', normalization: { kind: 'LINEAR_FIXED_CAP', minimum: 0, maximum: 4 }, comparisonPoolRule: 'AVAILABLE_PLAYERS_WITH_SAME_METRIC_AND_DENOMINATOR', limitationCodes: ['ENEMY_BLINDS_ONLY'] },
  { axisId: 'TRADES', primaryMetricId: 'TRADE_KILLS_PER_10_VERIFIED_ROUNDS', unit: 'COUNT_PER_10_VERIFIED_ROUNDS', direction: 'HIGHER_IS_BETTER', normalization: { kind: 'LINEAR_FIXED_CAP', minimum: 0, maximum: 3 }, comparisonPoolRule: 'AVAILABLE_PLAYERS_WITH_SAME_METRIC_AND_DENOMINATOR', limitationCodes: ['CONFIRMED_TRADE_RULE_ONLY'] },
  { axisId: 'CLUTCH', primaryMetricId: 'CLUTCH_WINS_PER_10_VERIFIED_ROUNDS', unit: 'COUNT_PER_10_VERIFIED_ROUNDS', direction: 'HIGHER_IS_BETTER', normalization: { kind: 'LINEAR_FIXED_CAP', minimum: 0, maximum: 1 }, comparisonPoolRule: 'AVAILABLE_PLAYERS_WITH_SAME_METRIC_AND_DENOMINATOR', limitationCodes: ['CONFIRMED_WON_1VX_ONLY'] },
  { axisId: 'ENTRY', primaryMetricId: 'OPENING_KILLS_PER_10_VERIFIED_ROUNDS', unit: 'COUNT_PER_10_VERIFIED_ROUNDS', direction: 'HIGHER_IS_BETTER', normalization: { kind: 'LINEAR_FIXED_CAP', minimum: 0, maximum: 3 }, comparisonPoolRule: 'AVAILABLE_PLAYERS_WITH_SAME_METRIC_AND_DENOMINATOR', limitationCodes: ['OPENING_DEATHS_ARE_SECONDARY_CONTEXT'] },
  { axisId: 'UTILITY', primaryMetricId: 'ENEMY_HE_INFERNO_DAMAGE_PER_VERIFIED_ROUND', unit: 'DAMAGE_PER_VERIFIED_ROUND', direction: 'HIGHER_IS_BETTER', normalization: { kind: 'LINEAR_FIXED_CAP', minimum: 0, maximum: 20 }, comparisonPoolRule: 'AVAILABLE_PLAYERS_WITH_SAME_METRIC_AND_DENOMINATOR', limitationCodes: ['HE_AND_INFERNO_ENEMY_DAMAGE_ONLY'] },
  { axisId: 'OBJECTIVES', primaryMetricId: 'CONFIRMED_BOMB_ACTIONS_PER_10_VERIFIED_ROUNDS', unit: 'COUNT_PER_10_VERIFIED_ROUNDS', direction: 'HIGHER_IS_BETTER', normalization: { kind: 'LINEAR_FIXED_CAP', minimum: 0, maximum: 4 }, comparisonPoolRule: 'AVAILABLE_PLAYERS_WITH_SAME_METRIC_AND_DENOMINATOR', limitationCodes: ['BOMB_SCENARIO_ONLY', 'PLANTS_AND_DEFUSES_ARE_ACTION_COUNTS'] },
]);

const RELATED_H2_FAMILIES: Readonly<Record<PlayerRadarAxisId, PlayerRadarAxis['relatedH2Families']>> = {
  MULTIKILL: ['COMBAT', 'CONTEXT'],
  ASSISTS: ['SUPPORT'],
  FLASH: ['SUPPORT', 'CONTEXT'],
  TRADES: ['COMBAT', 'CONTEXT'],
  CLUTCH: ['COMBAT', 'CONTEXT'],
  ENTRY: ['COMBAT', 'CONTEXT'],
  UTILITY: ['SUPPORT'],
  OBJECTIVES: ['OBJECTIVES', 'CONTEXT'],
};

const SPECIALIZATION_AXIS: Readonly<Record<EvpSpecializationId, PlayerRadarAxisId>> = {
  FLASH_SUPPORT: 'FLASH',
  NON_FLASH_ASSIST_SUPPORT: 'ASSISTS',
  TRADE_SPECIALIST: 'TRADES',
  CLUTCH_SPECIALIST: 'CLUTCH',
  MULTIKILL_SPECIALIST: 'MULTIKILL',
  ENTRY_SPECIALIST: 'ENTRY',
  UTILITY_DAMAGE_SPECIALIST: 'UTILITY',
  OBJECTIVE_SPECIALIST: 'OBJECTIVES',
};

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function eventOrder(left: MatchEvent, right: MatchEvent): number {
  return left.tick - right.tick || left.source.rowIndex - right.source.rowIndex || left.id.localeCompare(right.id);
}

type TeamRelation = 'ENEMY' | 'FRIENDLY' | 'SELF' | 'UNKNOWN';

function teamRelation(teamByPlayer: ReadonlyMap<string, string>, event: MatchEvent): TeamRelation {
  if (event.actorId === null || event.targetId === null) return 'UNKNOWN';
  if (event.actorId === event.targetId) return 'SELF';
  const actorTeam = teamByPlayer.get(event.actorId);
  const targetTeam = teamByPlayer.get(event.targetId);
  if (actorTeam === undefined || targetTeam === undefined) return 'UNKNOWN';
  return actorTeam === targetTeam ? 'FRIENDLY' : 'ENEMY';
}

function enemyRelation(teamByPlayer: ReadonlyMap<string, string>, event: MatchEvent): boolean {
  return teamRelation(teamByPlayer, event) === 'ENEMY';
}

function isLive(event: MatchEvent): boolean {
  return event.context?.phase === 'LIVE' && event.kind !== 'PLAYER_DEATH_NONLIVE';
}

function unavailable(axisId: PlayerRadarAxisId, verifiedRounds: number, reason: UnavailableReason): AxisDraft {
  const definition = AXIS_DEFINITIONS.find((row) => row.axisId === axisId)!;
  return {
    axisId,
    availability: 'UNAVAILABLE',
    reasonIfUnavailable: reason,
    rawValue: null,
    unit: definition.unit,
    verifiedRounds,
    geometryValue: null,
    scaleExceeded: false,
    secondaryMetrics: [],
    evpAttribution: null,
    mvpAttribution: null,
    evidenceEventIds: [],
    evidenceRoundIds: [],
    relatedH2Families: [...RELATED_H2_FAMILIES[axisId]],
  };
}

function available(
  axisId: PlayerRadarAxisId,
  verifiedRounds: number,
  rawValue: number,
  secondaryMetrics: PlayerRadarAxis['secondaryMetrics'],
  evidenceEventIds: readonly string[],
  evidenceRoundIds: readonly string[],
): AxisDraft {
  const definition = AXIS_DEFINITIONS.find((row) => row.axisId === axisId)!;
  const maximum = definition.normalization.maximum;
  return {
    axisId,
    availability: 'AVAILABLE',
    reasonIfUnavailable: null,
    rawValue,
    unit: definition.unit,
    verifiedRounds,
    geometryValue: Math.min(1, rawValue / maximum),
    scaleExceeded: rawValue > maximum,
    secondaryMetrics,
    evpAttribution: null,
    mvpAttribution: null,
    evidenceEventIds: sortedUnique(evidenceEventIds),
    evidenceRoundIds: sortedUnique(evidenceRoundIds),
    relatedH2Families: [...RELATED_H2_FAMILIES[axisId]],
  };
}

function addConfirmedValue(
  confirmed: RadarConfirmedValue[] | undefined,
  axisId: RadarConfirmedValue['axisId'],
  rawValue: number,
  events: readonly MatchEvent[],
): void {
  if (!confirmed || !Number.isFinite(rawValue) || rawValue <= 0 || events.length === 0) return;
  const maximum = AXIS_DEFINITIONS.find((row) => row.axisId === axisId)!.normalization.maximum;
  const geometryValue = Math.min(1, rawValue / maximum);
  if (geometryValue === 0) return;
  confirmed.push({
    axisId, rawValue, geometryValue,
    evidenceEventIds: sortedUnique(events.map((event) => event.id)).slice(0, 512),
    evidenceRoundIds: sortedUnique(events.map((event) => event.roundId)).slice(0, 128),
  });
}

function facts(
  analytics: PlayerAnalytics,
  kinds: readonly string[],
  roundIds?: ReadonlySet<string>,
): PlayerFact[] {
  return analytics.facts.filter((fact) => kinds.includes(fact.kind) && (roundIds === undefined || roundIds.has(fact.roundId)));
}

function factEvidence(analytics: PlayerAnalytics, kinds: readonly string[], roundIds?: ReadonlySet<string>) {
  const rows = facts(analytics, kinds, roundIds);
  return {
    eventIds: rows.flatMap((row) => row.eventId === null ? [] : [row.eventId]),
    roundIds: rows.map((row) => row.roundId),
  };
}

function closeMetric(left: number, right: number): boolean {
  return Math.abs(left - right) <= METRIC_EPSILON;
}

function countedRounds(
  canonical: CanonicalMatchResult,
  playerId: string,
  verifiedRounds: number,
): ReadonlySet<string> | null {
  const profile = canonical.internal.recomputeSeed.profiles.find((row) => row.playerId === playerId);
  if (!profile) return null;
  const roundIds = new Set(profile.countedRoundIds);
  const knownRoundIds = new Set(canonical.artifact.match.rounds.map((round) => round.id));
  if (roundIds.size !== verifiedRounds || [...roundIds].some((roundId) => !knownRoundIds.has(roundId))) return null;
  return roundIds;
}

function multikillBuckets(rows: readonly PlayerFact[]): { two: number; three: number; four: number; five: number; rounds: Set<string> } {
  const killsByRound = new Map<string, number>();
  for (const fact of rows) killsByRound.set(fact.roundId, (killsByRound.get(fact.roundId) ?? 0) + 1);
  const result = { two: 0, three: 0, four: 0, five: 0, rounds: new Set<string>() };
  for (const [roundId, count] of killsByRound) {
    if (count < 2) continue;
    result.rounds.add(roundId);
    if (count === 2) result.two += 1;
    else if (count === 3) result.three += 1;
    else if (count === 4) result.four += 1;
    else result.five += 1;
  }
  return result;
}

function sameMultikills(
  left: Pick<ReturnType<typeof multikillBuckets>, 'two' | 'three' | 'four' | 'five'>,
  right: PlayerAnalytics['multiKills'],
): boolean {
  return left.two === right.two && left.three === right.three && left.four === right.four && left.five === right.five;
}

function openingEvents(canonical: CanonicalMatchResult, teamByPlayer: ReadonlyMap<string, string>): MatchEvent[] {
  return canonical.artifact.match.rounds.flatMap((round) => {
    const opening = canonical.artifact.match.events
      .filter((event) => event.roundId === round.id && isLive(event) && event.kind === 'PLAYER_DEATH' && enemyRelation(teamByPlayer, event))
      .sort(eventOrder)[0];
    return opening ? [opening] : [];
  });
}

type ClutchWin = { playerId: string; roundId: string; opponents: number };

function clutchWins(canonical: CanonicalMatchResult, teamByPlayer: ReadonlyMap<string, string>): ClutchWin[] {
  const result: ClutchWin[] = [];
  const deaths = canonical.artifact.match.events
    .filter((event) => isLive(event) && event.kind === 'PLAYER_DEATH')
    .sort(eventOrder);
  for (const round of canonical.artifact.match.rounds) {
    const alive = new Map(canonical.artifact.match.teams.map((team) => [team.id, new Set(team.playerIds)]));
    const candidates = new Map<string, number>();
    for (const death of deaths.filter((event) => event.roundId === round.id)) {
      if (death.targetId) alive.get(teamByPlayer.get(death.targetId) ?? '')?.delete(death.targetId);
      for (const team of canonical.artifact.match.teams) {
        const survivors = alive.get(team.id);
        const enemy = canonical.artifact.match.teams.find((candidate) => candidate.id !== team.id);
        const enemyCount = enemy ? alive.get(enemy.id)?.size ?? 0 : 0;
        if (survivors?.size === 1 && enemyCount > 0) {
          const survivor = [...survivors][0]!;
          candidates.set(survivor, Math.max(candidates.get(survivor) ?? 0, enemyCount));
        }
      }
    }
    for (const [playerId, opponents] of candidates) {
      const teamId = teamByPlayer.get(playerId);
      if (round.winnerTeamId === teamId && alive.get(teamId ?? '')?.has(playerId)) {
        result.push({ playerId, roundId: round.id, opponents });
      }
    }
  }
  return result;
}

type NumericAttribute =
  | { status: 'VALID'; value: number }
  | { status: 'MISSING'; value: null }
  | { status: 'INVALID'; value: null };

function numericAttribute(
  event: MatchEvent,
  key: string,
  valid: (value: number) => boolean,
): NumericAttribute {
  const value = event.attrs[key];
  if (value === null || value === undefined) return { status: 'MISSING', value: null };
  if (typeof value !== 'number' || !Number.isFinite(value) || !valid(value)) return { status: 'INVALID', value: null };
  return { status: 'VALID', value };
}

type HealthDamage = { actual: number | null; nextHealth: number | null };

function healthDamage(event: MatchEvent, previousHealth: number | null): HealthDamage {
  const raw = numericAttribute(event, 'rawHealthDamage', (value) => value >= 0);
  const after = numericAttribute(event, 'healthAfter', (value) => value >= 0 && value <= 100);

  if (previousHealth === null) {
    return { actual: null, nextHealth: after.status === 'VALID' ? after.value : null };
  }
  if (raw.status !== 'VALID') {
    return { actual: null, nextHealth: after.status === 'VALID' ? after.value : null };
  }

  const actual = Math.min(raw.value, previousHealth);
  const expectedAfter = previousHealth - actual;
  if (after.status === 'MISSING') return { actual, nextHealth: expectedAfter };
  if (after.status === 'INVALID' || !closeMetric(after.value, expectedAfter)) {
    return { actual: null, nextHealth: null };
  }
  return { actual, nextHealth: after.value };
}

type UtilityDamage = { he: number; inferno: number; events: MatchEvent[]; complete: boolean };

function utilityDamage(
  canonical: CanonicalMatchResult,
  playerId: string,
  teamByPlayer: ReadonlyMap<string, string>,
  roundIds?: ReadonlySet<string>,
): UtilityDamage {
  const result: UtilityDamage = { he: 0, inferno: 0, events: [], complete: true };
  const hpByRoundPlayer = new Map<string, number | null>();
  const hurts = canonical.artifact.match.events
    .filter((event) => isLive(event) && event.kind === 'PLAYER_HURT')
    .sort(eventOrder);
  for (const event of hurts) {
    const inScope = roundIds === undefined || roundIds.has(event.roundId);
    const ownEvent = event.actorId === playerId && inScope;
    const weapon = typeof event.attrs.weapon === 'string' ? event.attrs.weapon : null;
    const utilityWeapon = weapon === 'hegrenade' || weapon === 'inferno';
    const relation = teamRelation(teamByPlayer, event);

    if (!event.targetId) {
      if (ownEvent && (utilityWeapon || weapon === null)) result.complete = false;
      continue;
    }
    const hpKey = `${event.roundId}:${event.targetId}`;
    const previousHp = hpByRoundPlayer.has(hpKey) ? hpByRoundPlayer.get(hpKey)! : 100;
    const damage = healthDamage(event, previousHp);
    hpByRoundPlayer.set(hpKey, damage.nextHealth);

    if (!ownEvent || relation === 'SELF' || relation === 'FRIENDLY') continue;
    if (weapon === null) {
      result.complete = false;
      continue;
    }
    if (!utilityWeapon) continue;
    if (relation !== 'ENEMY' || damage.actual === null) {
      result.complete = false;
      continue;
    }
    if (weapon === 'hegrenade') result.he += damage.actual;
    else result.inferno += damage.actual;
    result.events.push(event);
  }
  return result;
}

function enemyBlinds(
  canonical: CanonicalMatchResult,
  playerId: string,
  teamByPlayer: ReadonlyMap<string, string>,
  roundIds?: ReadonlySet<string>,
): { seconds: number; events: MatchEvent[]; confirmedEvents: MatchEvent[]; complete: boolean } {
  const result = { seconds: 0, events: [] as MatchEvent[], confirmedEvents: [] as MatchEvent[], complete: true };
  for (const event of canonical.artifact.match.events) {
    if (!isLive(event) || event.kind !== 'PLAYER_BLIND' || event.actorId !== playerId
      || (roundIds !== undefined && !roundIds.has(event.roundId))) continue;
    const relation = teamRelation(teamByPlayer, event);
    if (relation === 'SELF' || relation === 'FRIENDLY') continue;
    if (relation !== 'ENEMY') {
      result.complete = false;
      continue;
    }
    result.events.push(event);
    const duration = numericAttribute(event, 'blindDuration', (value) => value >= 0);
    if (duration.status !== 'VALID') {
      result.complete = false;
      continue;
    }
    result.seconds += duration.value;
    result.confirmedEvents.push(event);
  }
  return result;
}

function objectiveEvents(
  canonical: CanonicalMatchResult,
  playerId: string,
  roundIds?: ReadonlySet<string>,
): { plants: MatchEvent[]; defuses: MatchEvent[] } {
  const own = canonical.artifact.match.events.filter((event) => isLive(event)
    && event.actorId === playerId
    && (roundIds === undefined || roundIds.has(event.roundId)));
  return {
    plants: own.filter((event) => event.kind === 'BOMB_PLANTED'),
    defuses: own.filter((event) => event.kind === 'BOMB_DEFUSED'),
  };
}

function axisDrafts(
  canonical: CanonicalMatchResult,
  analytics: PlayerAnalytics | undefined,
  playerId: string,
  verifiedRounds: number,
  confirmed: RadarConfirmedValue[] | undefined,
): AxisDraft[] {
  if (!analytics) return playerRadarAxisIds.map((axisId) => unavailable(axisId, verifiedRounds, 'ANALYTICS_MISSING'));
  const verifiedRoundIds = countedRounds(canonical, playerId, verifiedRounds);
  if (verifiedRoundIds === null) return playerRadarAxisIds.map((axisId) => unavailable(axisId, verifiedRounds, 'VERIFIED_ROUND_IDS_UNAVAILABLE'));
  if (verifiedRounds <= 0) return playerRadarAxisIds.map((axisId) => unavailable(
    axisId,
    verifiedRounds,
    axisId === 'OBJECTIVES' && canonical.activeRating.scenario === 'UNKNOWN'
      ? 'SCENARIO_UNKNOWN'
      : axisId === 'OBJECTIVES' && canonical.activeRating.scenario !== 'BOMB'
        ? 'BOMB_SCENARIO_REQUIRED'
        : 'INSUFFICIENT_VERIFIED_ROUNDS',
  ));

  const perTen = (value: number) => value * 10 / verifiedRounds;
  const result = new Map<PlayerRadarAxisId, AxisDraft>();
  const allKillFacts = facts(analytics, ['KILL']);
  const scopedKillFacts = facts(analytics, ['KILL'], verifiedRoundIds);
  const allMultikills = multikillBuckets(allKillFacts);
  const scopedMultikills = multikillBuckets(scopedKillFacts);
  const multikillCount = scopedMultikills.two + scopedMultikills.three + scopedMultikills.four + scopedMultikills.five;
  const multikillFacts = scopedKillFacts.filter((fact) => scopedMultikills.rounds.has(fact.roundId));
  result.set('MULTIKILL', analytics.kills === null || allKillFacts.length !== analytics.kills || !sameMultikills(allMultikills, analytics.multiKills)
    ? unavailable('MULTIKILL', verifiedRounds, 'SOURCE_VALUE_UNAVAILABLE')
    : available('MULTIKILL', verifiedRounds, perTen(multikillCount), [
      { metricId: 'DOUBLE_KILL_ROUNDS', value: scopedMultikills.two, unit: 'COUNT' },
      { metricId: 'TRIPLE_KILL_ROUNDS', value: scopedMultikills.three, unit: 'COUNT' },
      { metricId: 'QUAD_KILL_ROUNDS', value: scopedMultikills.four, unit: 'COUNT' },
      { metricId: 'ACE_ROUNDS', value: scopedMultikills.five, unit: 'COUNT' },
    ], multikillFacts.flatMap((fact) => fact.eventId === null ? [] : [fact.eventId]), [...scopedMultikills.rounds]));

  const allAssistFacts = facts(analytics, ['ASSIST', 'FLASH_ASSIST']);
  const scopedAssistFacts = facts(analytics, ['ASSIST', 'FLASH_ASSIST'], verifiedRoundIds);
  const nonFlashAssists = scopedAssistFacts.filter((fact) => fact.kind === 'ASSIST').length;
  const flashAssists = scopedAssistFacts.filter((fact) => fact.kind === 'FLASH_ASSIST').length;
  const assistEvidence = factEvidence(analytics, ['ASSIST'], verifiedRoundIds);
  result.set('ASSISTS', analytics.assists === null || allAssistFacts.length !== analytics.assists
    ? unavailable('ASSISTS', verifiedRounds, 'SOURCE_VALUE_UNAVAILABLE')
    : available('ASSISTS', verifiedRounds, perTen(nonFlashAssists), [
      { metricId: 'NON_FLASH_ASSISTS', value: nonFlashAssists, unit: 'COUNT' },
      { metricId: 'ALL_ASSISTS', value: scopedAssistFacts.length, unit: 'COUNT' },
    ], assistEvidence.eventIds, assistEvidence.roundIds));

  const teamByPlayer = new Map(canonical.artifact.match.players.map((player) => [player.id, player.teamId]));
  const allEnemyBlinds = enemyBlinds(canonical, playerId, teamByPlayer);
  const scopedEnemyBlinds = enemyBlinds(canonical, playerId, teamByPlayer, verifiedRoundIds);
  const flashEvidence = factEvidence(analytics, ['FLASH_ASSIST'], verifiedRoundIds);
  const flashSourceConsistent = analytics.grenades.enemyBlindSeconds !== null
    && analytics.grenades.enemiesFlashed !== null
    && closeMetric(allEnemyBlinds.seconds, analytics.grenades.enemyBlindSeconds)
    && allEnemyBlinds.events.length === analytics.grenades.enemiesFlashed
    && (allEnemyBlinds.complete || canonical.artifact.analytics.availability.flashes === 'PARTIAL');
  const flashUnavailable = canonical.artifact.analytics.availability.flashes === 'UNAVAILABLE'
    || !flashSourceConsistent || !scopedEnemyBlinds.complete;
  const flashPerRound = scopedEnemyBlinds.seconds / verifiedRounds;
  if (flashUnavailable) addConfirmedValue(confirmed, 'FLASH', flashPerRound, scopedEnemyBlinds.confirmedEvents);
  result.set('FLASH', flashUnavailable
    ? unavailable('FLASH', verifiedRounds, 'FLASH_DATA_UNAVAILABLE')
    : available('FLASH', verifiedRounds, flashPerRound, [
      { metricId: 'ENEMY_BLIND_SECONDS', value: scopedEnemyBlinds.seconds, unit: 'SECONDS' },
      { metricId: 'ENEMIES_FLASHED', value: scopedEnemyBlinds.events.length, unit: 'COUNT' },
      { metricId: 'FLASH_ASSISTS', value: flashAssists, unit: 'COUNT' },
    ], [...flashEvidence.eventIds, ...scopedEnemyBlinds.events.map((event) => event.id)], [...flashEvidence.roundIds, ...scopedEnemyBlinds.events.map((event) => event.roundId)]));

  const allTradeFacts = facts(analytics, ['TRADE_KILL']);
  const scopedTradeFacts = facts(analytics, ['TRADE_KILL'], verifiedRoundIds);
  const tradeEvidence = factEvidence(analytics, ['TRADE_KILL'], verifiedRoundIds);
  result.set('TRADES', analytics.tradeKills === null || allTradeFacts.length !== analytics.tradeKills
    ? unavailable('TRADES', verifiedRounds, 'SOURCE_VALUE_UNAVAILABLE')
    : available('TRADES', verifiedRounds, perTen(scopedTradeFacts.length), [
      { metricId: 'TRADE_KILLS', value: scopedTradeFacts.length, unit: 'COUNT' },
    ], tradeEvidence.eventIds, tradeEvidence.roundIds));

  const playerClutches = clutchWins(canonical, teamByPlayer).filter((row) => row.playerId === playerId);
  const allClutchCounts = Object.fromEntries(Object.keys(CLUTCH_WEIGHTS).map((label) => [label, playerClutches.filter((row) => label === `1v${row.opponents}`).length]));
  const clutchSourceConsistent = Object.entries(analytics.clutches).every(([label, count]) => (allClutchCounts[label] ?? 0) === count)
    && Object.entries(allClutchCounts).every(([label, count]) => (analytics.clutches[label] ?? 0) === count);
  const scopedClutches = playerClutches.filter((row) => verifiedRoundIds.has(row.roundId));
  const scopedClutchWins = scopedClutches.length;
  const clutchPoints = scopedClutches.reduce((sum, row) => sum + (CLUTCH_WEIGHTS[`1v${row.opponents}`] ?? 0), 0);
  result.set('CLUTCH', canonical.artifact.analytics.availability.aliveContext === 'UNAVAILABLE' || !clutchSourceConsistent
    ? unavailable('CLUTCH', verifiedRounds, canonical.artifact.analytics.availability.aliveContext === 'UNAVAILABLE' ? 'ALIVE_CONTEXT_UNAVAILABLE' : 'SOURCE_VALUE_UNAVAILABLE')
    : available('CLUTCH', verifiedRounds, perTen(scopedClutchWins), [
      { metricId: 'CLUTCH_WINS', value: scopedClutchWins, unit: 'COUNT' },
      { metricId: 'CLUTCH_POINTS', value: clutchPoints, unit: 'POINTS' },
    ], [], scopedClutches.map((row) => row.roundId)));

  const allOpeningEvents = openingEvents(canonical, teamByPlayer);
  const ownOpeningKills = allOpeningEvents.filter((event) => event.actorId === playerId);
  const ownOpeningDeaths = allOpeningEvents.filter((event) => event.targetId === playerId);
  const scopedOpeningKills = ownOpeningKills.filter((event) => verifiedRoundIds.has(event.roundId));
  const scopedOpeningDeaths = ownOpeningDeaths.filter((event) => verifiedRoundIds.has(event.roundId));
  result.set('ENTRY', analytics.openingKills === null || analytics.openingDeaths === null
      || ownOpeningKills.length !== analytics.openingKills || ownOpeningDeaths.length !== analytics.openingDeaths
    ? unavailable('ENTRY', verifiedRounds, 'SOURCE_VALUE_UNAVAILABLE')
    : available('ENTRY', verifiedRounds, perTen(scopedOpeningKills.length), [
      { metricId: 'OPENING_KILLS', value: scopedOpeningKills.length, unit: 'COUNT' },
      { metricId: 'OPENING_DEATHS', value: scopedOpeningDeaths.length, unit: 'COUNT' },
    ], scopedOpeningKills.map((event) => event.id), scopedOpeningKills.map((event) => event.roundId)));

  const allUtility = utilityDamage(canonical, playerId, teamByPlayer);
  const scopedUtility = utilityDamage(canonical, playerId, teamByPlayer, verifiedRoundIds);
  const utilitySourceConsistent = analytics.grenades.heEnemyDamage !== null
    && analytics.grenades.infernoEnemyDamage !== null
    && (allUtility.complete
      ? closeMetric(allUtility.he, analytics.grenades.heEnemyDamage)
        && closeMetric(allUtility.inferno, analytics.grenades.infernoEnemyDamage)
      : canonical.artifact.analytics.availability.damage === 'PARTIAL');
  const utilityUnavailable = canonical.artifact.analytics.availability.damage === 'UNAVAILABLE'
    || !utilitySourceConsistent || !scopedUtility.complete;
  const utilityPerRound = (scopedUtility.he + scopedUtility.inferno) / verifiedRounds;
  if (utilityUnavailable) addConfirmedValue(confirmed, 'UTILITY', utilityPerRound, scopedUtility.events);
  result.set('UTILITY', utilityUnavailable
    ? unavailable('UTILITY', verifiedRounds, 'DAMAGE_DATA_UNAVAILABLE')
    : available('UTILITY', verifiedRounds, utilityPerRound, [
      { metricId: 'HE_ENEMY_DAMAGE', value: scopedUtility.he, unit: 'DAMAGE' },
      { metricId: 'INFERNO_ENEMY_DAMAGE', value: scopedUtility.inferno, unit: 'DAMAGE' },
    ], scopedUtility.events.map((event) => event.id), scopedUtility.events.map((event) => event.roundId)));

  const allObjectives = objectiveEvents(canonical, playerId);
  const scopedObjectives = objectiveEvents(canonical, playerId, verifiedRoundIds);
  const objectiveEvidence = factEvidence(analytics, ['BOMB_PLANT', 'BOMB_DEFUSE'], verifiedRoundIds);
  const objectiveUnavailable = canonical.activeRating.scenario === 'UNKNOWN'
    ? 'SCENARIO_UNKNOWN'
    : canonical.activeRating.scenario !== 'BOMB'
      ? 'BOMB_SCENARIO_REQUIRED'
      : analytics.bomb.plants === null || analytics.bomb.defuses === null
        ? 'SOURCE_VALUE_UNAVAILABLE'
        : allObjectives.plants.length !== analytics.bomb.plants || allObjectives.defuses.length !== analytics.bomb.defuses
          ? 'SOURCE_VALUE_UNAVAILABLE'
        : null;
  result.set('OBJECTIVES', objectiveUnavailable
    ? unavailable('OBJECTIVES', verifiedRounds, objectiveUnavailable)
    : available('OBJECTIVES', verifiedRounds, perTen(scopedObjectives.plants.length + scopedObjectives.defuses.length), [
      { metricId: 'BOMB_PLANTS', value: scopedObjectives.plants.length, unit: 'COUNT' },
      { metricId: 'BOMB_DEFUSES', value: scopedObjectives.defuses.length, unit: 'COUNT' },
    ], objectiveEvidence.eventIds, objectiveEvidence.roundIds));

  return playerRadarAxisIds.map((axisId) => result.get(axisId)!);
}

function evpAttribution(report: EvpReport | null, playerId: string, axisId: PlayerRadarAxisId): PlayerRadarAxis['evpAttribution'] {
  if (!report) return null;
  const player = report.players.find((row) => row.playerId === playerId);
  if (!player || player.status !== 'AWARDED') return null;
  const role = player.primarySpecializationId !== null && SPECIALIZATION_AXIS[player.primarySpecializationId] === axisId
    ? 'PRIMARY'
    : player.secondarySpecializationId !== null && SPECIALIZATION_AXIS[player.secondarySpecializationId] === axisId
      ? 'SECONDARY'
      : null;
  if (!role) return null;
  const specializationId = role === 'PRIMARY' ? player.primarySpecializationId! : player.secondarySpecializationId!;
  const specialization = player.specializations.find((row) => row.specializationId === specializationId);
  if (!specialization || specialization.achievementStrength === null) return null;
  return {
    role,
    reasonCode: 'AWARDED_EVP_SPECIALIZATION',
    specializationId,
    achievementStrength: specialization.achievementStrength,
    sourceMetrics: specialization.sourceMetrics,
    thresholds: specialization.thresholds,
    evidenceQuality: specialization.evidence.quality,
    evidenceEventIds: specialization.evidence.eventIds,
    evidenceRoundIds: specialization.evidence.roundIds,
  };
}

function evpAxisEvidence(report: EvpReport | null, playerId: string, axisId: PlayerRadarAxisId) {
  const player = report?.players.find((row) => row.playerId === playerId);
  const specialization = player?.specializations.find((row) => SPECIALIZATION_AXIS[row.specializationId] === axisId);
  return specialization?.evidence ?? null;
}

function contextAxis(tag: string): PlayerRadarAxisId | null {
  if (tag === 'OPENING') return 'ENTRY';
  if (tag === 'TRADE' || tag === 'FAST_TRADE') return 'TRADES';
  if (tag === 'MULTI_KILL') return 'MULTIKILL';
  if (tag === 'FLASH_ASSIST') return 'FLASH';
  if (tag === 'POSTPLANT') return 'OBJECTIVES';
  return null;
}

function mvpAttributions(
  canonical: CanonicalMatchResult,
  playerId: string,
  families: readonly (ParticipationExplanationFamilyRow | H3ExplanationFamily)[],
) {
  const byAxis = new Map<PlayerRadarAxisId, { families: Map<string, number>; eventIds: string[]; roundIds: string[] }>();
  const analytics = canonical.artifact.analytics.players.find((row) => row.playerId === playerId);
  if (!analytics) return new Map();
  const factKindsByEvent = new Map<string, Set<string>>();
  for (const fact of analytics.facts) if (fact.eventId !== null) {
    const kinds = factKindsByEvent.get(fact.eventId) ?? new Set<string>();
    kinds.add(fact.kind);
    factKindsByEvent.set(fact.eventId, kinds);
  }
  const multikillRounds = new Set<string>();
  const killsPerRound = new Map<string, number>();
  for (const fact of facts(analytics, ['KILL'])) killsPerRound.set(fact.roundId, (killsPerRound.get(fact.roundId) ?? 0) + 1);
  for (const [roundId, count] of killsPerRound) if (count >= 2) multikillRounds.add(roundId);
  const teamByPlayer = new Map(canonical.artifact.match.players.map((player) => [player.id, player.teamId]));
  const eventById = new Map(canonical.artifact.match.events.map((event) => [event.id, event]));
  const openingEventIds = new Set(openingEvents(canonical, teamByPlayer)
    .filter((event) => event.actorId === playerId)
    .map((event) => event.id));
  const axesForEvidenceEvent = (eventId: string): PlayerRadarAxisId[] => {
    const axes: PlayerRadarAxisId[] = [];
    const kinds = factKindsByEvent.get(eventId) ?? new Set<string>();
    const event = eventById.get(eventId);
    if (kinds.has('FLASH_ASSIST')) axes.push('FLASH');
    else if (kinds.has('ASSIST')) axes.push('ASSISTS');
    if (kinds.has('TRADE_KILL')) axes.push('TRADES');
    if (kinds.has('KILL') && event && event.actorId === playerId && multikillRounds.has(event.roundId)) axes.push('MULTIKILL');
    if (openingEventIds.has(eventId)) axes.push('ENTRY');
    if (event?.actorId === playerId && event.kind === 'PLAYER_HURT' && enemyRelation(teamByPlayer, event)
      && (event.attrs.weapon === 'hegrenade' || event.attrs.weapon === 'inferno')) axes.push('UTILITY');
    if (event?.actorId === playerId && (event.kind === 'BOMB_PLANTED' || event.kind === 'BOMB_DEFUSED')) axes.push('OBJECTIVES');
    return axes;
  };
  const add = (axisId: PlayerRadarAxisId, family: { family: H3ExplanationFamily['family']; finalAttribution: number }, eventIds: readonly string[], roundIds: readonly string[]) => {
    const current = byAxis.get(axisId) ?? { families: new Map<string, number>(), eventIds: [], roundIds: [] };
    current.families.set(family.family, family.finalAttribution);
    current.eventIds.push(...eventIds);
    current.roundIds.push(...roundIds);
    byAxis.set(axisId, current);
  };
  for (const family of families) {
    if (family.finalAttribution === null || family.finalAttribution <= 0) continue;
    const positive = { family: family.family, finalAttribution: family.finalAttribution };
    if (family.family === 'ROUND_IMPACT') {
      for (const source of family.sources.filter((row) => row.rawContribution > 0)) {
        for (const eventId of source.evidenceEventIds) {
          const event = eventById.get(eventId);
          if (event?.actorId !== playerId) continue;
          if (source.reason === 'ROUND_IMPACT_CLUTCH' && event.kind === 'PLAYER_DEATH' && enemyRelation(teamByPlayer, event)) {
            add('CLUTCH', positive, [eventId], [event.roundId]);
          }
          if (source.reason === 'ROUND_IMPACT_POSTPLANT' && axesForEvidenceEvent(eventId).includes('OBJECTIVES')) {
            add('OBJECTIVES', positive, [eventId], [event.roundId]);
          }
        }
      }
      continue;
    }
    if (family.family !== 'CONTEXT') {
      for (const source of family.sources.filter((row) => (row.finalContribution ?? 0) > 0 && row.kind !== 'BASELINE')) {
        for (const eventId of source.evidenceEventIds) {
          const event = eventById.get(eventId);
          if (!event) continue;
          for (const axisId of axesForEvidenceEvent(eventId)) add(axisId, positive, [eventId], [event.roundId]);
          if (canonical.schemaVersion === 'match-result@2' && event.actorId === playerId && event.kind === 'PLAYER_BLIND'
            && enemyRelation(teamByPlayer, event) && typeof event.attrs.blindDuration === 'number' && event.attrs.blindDuration > 0) {
            add('FLASH', positive, [eventId], [event.roundId]);
          }
        }
      }
    }
    if (family.family === 'CONTEXT') {
      const rating = canonical.activeRating.players.find((row) => row.playerId === playerId)?.rating;
      for (const [anchorId, tag] of Object.entries(rating?.kernelDetails.context.winningTagByAnchor ?? {})) {
        if (!((rating?.kernelDetails.factorContributions.CONTEXT[tag] ?? 0) > 0)) continue;
        const axisId = contextAxis(tag);
        if (!axisId) continue;
        const event = eventById.get(anchorId);
        if (!event || !axesForEvidenceEvent(anchorId).includes(axisId)) continue;
        add(axisId, positive, [event.id], [event.roundId]);
      }
    }
  }
  return new Map([...byAxis].map(([axisId, value]) => [axisId, {
    families: [...value.families].sort(([left], [right]) => left.localeCompare(right)).map(([family, familyFinalAttribution]) => ({ family, familyFinalAttribution })),
    evidenceEventIds: sortedUnique(value.eventIds),
    evidenceRoundIds: sortedUnique(value.roundIds),
  }]));
}

function hasActiveH2(canonical: CanonicalMatchResult): boolean {
  return canonical.internal.selectedPolicySelector === H2_PARTICIPATION_RATING_POLICY.selector
    && canonical.internal.selectedPolicyId === H2_PARTICIPATION_RATING_POLICY.id
    && canonical.internal.selectedPolicyDigest === H2_PARTICIPATION_RATING_POLICY.digest;
}

/** Read-only projection of stored M2/H2/EVP data. It never evaluates either award policy. */
export function buildPlayerRadar(canonical: HistoricalMatchResult, evpReport: EvpReport | null): PlayerRadarReport;
export function buildPlayerRadar(canonical: CanonicalMatchResult, evpReport: EvpReport | null): StoredPlayerRadarReport;
export function buildPlayerRadar(canonical: CanonicalMatchResult, evpReport: EvpReport | null, includeConfirmed: true): PlayerRadarWithConfirmedEvidence;
export function buildPlayerRadar(canonical: CanonicalMatchResult, evpReport: EvpReport | null, includeConfirmed = false): StoredPlayerRadarReport | PlayerRadarWithConfirmedEvidence {
  const ratingAvailable = canonical.schemaVersion === 'match-result@2' || hasActiveH2(canonical);
  const explanation = ratingAvailable ? buildStoredParticipationExplanation(canonical) : null;
  const explanationByPlayer = new Map(explanation?.players.map((player) => [player.playerId, player]) ?? []);
  const analyticsByPlayer = new Map(canonical.artifact.analytics.players.map((player) => [player.playerId, player]));
  const ratingByPlayer = new Map(canonical.activeRating.players.map((player) => [player.playerId, player]));
  const mvpPlayerId = ratingAvailable ? canonical.activeRating.awards.mvp.playerId : null;
  const drafts = canonical.artifact.match.players.map((identity) => {
    const rating = ratingByPlayer.get(identity.id);
    const confirmed: RadarConfirmedValue[] | undefined = includeConfirmed ? [] : undefined;
    const axes = axisDrafts(canonical, analyticsByPlayer.get(identity.id), identity.id, rating?.coverage.verifiedRounds ?? 0, confirmed);
    const h2 = explanationByPlayer.get(identity.id);
    const mvp = identity.id === mvpPlayerId && h2?.rating ? mvpAttributions(canonical, identity.id, h2.rating.families) : new Map();
    return {
      identity,
      confirmed,
      h2,
      axes: axes.map((axis) => {
        const evidence = evpAxisEvidence(evpReport, identity.id, axis.axisId);
        return {
          ...axis,
          evpAttribution: evpAttribution(evpReport, identity.id, axis.axisId),
          mvpAttribution: mvp.get(axis.axisId) ?? null,
          evidenceEventIds: sortedUnique([...axis.evidenceEventIds, ...(evidence?.eventIds ?? [])]),
          evidenceRoundIds: sortedUnique([...axis.evidenceRoundIds, ...(evidence?.roundIds ?? [])]),
        };
      }),
    };
  }).sort((left, right) => left.identity.id.localeCompare(right.identity.id));

  const matchComparisons = playerRadarAxisIds.map((axisId, axisIndex) => {
    const values = drafts.flatMap((player) => {
      const axis = player.axes[axisIndex]!;
      return axis.availability === 'AVAILABLE' && axis.rawValue !== null ? [axis.rawValue] : [];
    });
    const globalPartial = (axisId === 'FLASH' && canonical.artifact.analytics.availability.flashes === 'PARTIAL')
      || (axisId === 'UTILITY' && canonical.artifact.analytics.availability.damage === 'PARTIAL')
      || (axisId === 'CLUTCH' && canonical.artifact.analytics.availability.aliveContext === 'PARTIAL');
    const participationPartial = canonical.activeRating.players.some((player) =>
      player.coverage.absentFullRounds > 0
      || player.coverage.partialRounds > 0
      || player.coverage.unknownRounds > 0
      || player.coverage.globalExcludedRounds > 0
      || player.coverage.excludedOpportunities > 0);
    return {
      axisId,
      availability: values.length > 0 ? 'AVAILABLE' as const : 'UNAVAILABLE' as const,
      reasonIfUnavailable: values.length > 0 ? null : 'COMPARISON_POOL_EMPTY' as const,
      average: values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null,
      comparisonPoolSize: values.length,
      incompleteCoverage: globalPartial || participationPartial || values.length < drafts.length,
    };
  });

  const players = drafts.map(({ identity, h2, axes }) => {
    const awardedEvp = evpReport?.players.some((row) => row.playerId === identity.id && row.status === 'AWARDED') ?? false;
    return {
      playerId: identity.id,
      teamId: identity.teamId,
      awardState: identity.id === mvpPlayerId ? 'MVP' as const : awardedEvp ? 'EVP' as const : 'NONE' as const,
      axes: axes.map((axis, index) => ({
        ...axis,
        matchAverage: matchComparisons[index]!.average,
        comparisonPoolSize: matchComparisons[index]!.comparisonPoolSize,
        comparisonIncompleteCoverage: matchComparisons[index]!.incompleteCoverage,
      })),
      ratingExplanation: !ratingAvailable
        ? { availability: 'UNAVAILABLE' as const, reasonIfUnavailable: 'H2_UNAVAILABLE' as const, ratingValue: null, families: [] }
        : !h2?.rating
          ? { availability: 'UNAVAILABLE' as const, reasonIfUnavailable: 'H2_PLAYER_RATING_UNAVAILABLE' as const, ratingValue: null, families: [] }
          : { availability: 'AVAILABLE' as const, reasonIfUnavailable: null, ratingValue: h2.rating.value, families: h2.rating.families },
    };
  });

  const reportFields = {
    matchId: canonical.artifact.match.matchId,
    normalizationVersion: radarNormalizationVersion,
    experimental: true,
    axisDefinitions: AXIS_DEFINITIONS,
    matchComparisons,
  };
  const evpBinding = {
    evpReportSchemaVersion: evpReport?.schemaVersion ?? null, evpInputDigest: evpReport?.binding.inputDigest ?? null,
  };
  const confirmedEvidence = {
    schemaVersion: 'radar-confirmed-evidence@1',
    players: drafts.flatMap(({ identity, confirmed }) => confirmed?.length ? [{ playerId: identity.id, axes: confirmed }] : []),
  };
  if (canonical.schemaVersion === 'match-result@2') {
    const report = {
      ...reportFields, schemaVersion: 'player-radar@2',
      sourceBinding: {
        ...evpBinding, matchResultSchemaVersion: canonical.schemaVersion,
        matchFileSha256: canonical.artifact.match.fileSha256,
        ratingReportSchemaVersion: canonical.activeRating.schemaVersion, ratingPolicy: canonical.activeRating.policy,
      },
      players: players.map(({ axes, ratingExplanation, ...player }) => ({ ...player,
        ratingExplanation: { ...ratingExplanation, reasonIfUnavailable: ratingExplanation.ratingValue === null ? 'PLAYER_RATING_UNAVAILABLE' : null },
        axes: axes.map(({ relatedH2Families, mvpAttribution, ...axis }) => ({
          ...axis, relatedRatingFamilies: axis.axisId === 'CLUTCH' || axis.axisId === 'OBJECTIVES'
            ? [...relatedH2Families, 'ROUND_IMPACT'] : relatedH2Families,
          mvpAttribution: mvpAttribution && {
            ...mvpAttribution, reasonCode: 'CONFIRMED_POSITIVE_H3_EVIDENCE',
            terminologyCode: 'POSITIVE_H3_FACTOR_NOT_DECISIVE_CAUSE',
          },
        })),
      })),
    };
    return includeConfirmed ? playerRadarWithConfirmedEvidenceSchema.parse({ ...report, confirmedEvidence }) : h3RadarReportSchema.parse(report);
  }
  const report = {
    ...reportFields, schemaVersion: 'player-radar@1',
    sourceBinding: {
      ...evpBinding,
      matchResultSchemaVersion: canonical.schemaVersion,
      matchFileSha256: canonical.artifact.match.fileSha256,
      h2ReportSchemaVersion: ratingAvailable ? canonical.activeRating.schemaVersion : null,
    },
    players: players.map(({ axes, ratingExplanation, ...player }) => ({ ...player, h2Explanation: ratingExplanation,
      axes: axes.map(({ mvpAttribution, ...axis }) => ({ ...axis, mvpAttribution: mvpAttribution && {
        ...mvpAttribution, reasonCode: 'CONFIRMED_POSITIVE_H2_EVIDENCE', terminologyCode: 'POSITIVE_H2_FACTOR_NOT_DECISIVE_CAUSE',
      } })),
    })),
  };
  return includeConfirmed ? playerRadarWithConfirmedEvidenceSchema.parse({ ...report, confirmedEvidence }) : playerRadarReportSchema.parse(report);
}

export { AXIS_DEFINITIONS as PLAYER_RADAR_AXIS_DEFINITIONS };
