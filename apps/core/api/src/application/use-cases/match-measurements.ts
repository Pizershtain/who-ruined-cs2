import {
  playerRadarAxisIds,
  profileSteamIdSchema,
  type EvpReport,
  type MatchPublicationState,
  type PlayerMeasurement,
  type PlayerRadarAxisId,
  type ProfilePlayerMatch,
} from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import { buildPlayerRadar, measureEnemyDamage } from '@who-ruined/scoring';
import type { CanonicalMatchResult } from '@who-ruined/contracts';

type H3Result = Extract<CanonicalMatchResult, { schemaVersion: 'match-result@2' }>;
const radarNumerators = {
  MULTIKILL: ['DOUBLE_KILL_ROUNDS', 'TRIPLE_KILL_ROUNDS', 'QUAD_KILL_ROUNDS', 'ACE_ROUNDS'],
  ASSISTS: ['NON_FLASH_ASSISTS'], FLASH: ['ENEMY_BLIND_SECONDS'], TRADES: ['TRADE_KILLS'],
  CLUTCH: ['CLUTCH_WINS'], ENTRY: ['OPENING_KILLS'],
  UTILITY: ['HE_ENEMY_DAMAGE', 'INFERNO_ENEMY_DAMAGE'], OBJECTIVES: ['BOMB_PLANTS', 'BOMB_DEFUSES'],
} satisfies Record<PlayerRadarAxisId, string[]>;

function measurement(
  numerator: number | null, observedRounds: number | null, expectedRounds: number,
  options: { denominator?: number; partial?: boolean; notApplicable?: boolean } = {},
): PlayerMeasurement {
  return {
    status: options.notApplicable ? 'NOT_APPLICABLE' : numerator === null ? 'UNAVAILABLE'
      : options.partial || (observedRounds !== null && observedRounds < expectedRounds) ? 'PARTIAL' : 'AVAILABLE',
    numerator: options.notApplicable ? null : numerator,
    denominator: numerator !== null && !options.notApplicable ? options.denominator ?? null : null,
    observedRounds, expectedRounds,
  };
}

/** Query-time statistical projection of an already verified canonical result. */
export function projectMatchMeasurements(
  canonical: H3Result,
  uploadedAt: Date,
  revision: string,
  evp: EvpReport | null,
): Extract<MatchPublicationState, { state: 'PUBLISHED' }> {
  const { match, analytics } = canonical.artifact;
  const rating = canonical.activeRating;
  const seed = canonical.internal.recomputeSeed;
  const expected = match.rounds.length;
  const validRounds = match.rounds.filter(round => round.isValid);
  const faultyDeathRounds = new Set(match.events.flatMap(event => event.kind === 'PLAYER_DEATH'
    && event.context?.phase === 'LIVE' && event.targetId === null ? [event.roundId] : []));
  const roundSets = new Map(seed.profiles.map(profile => [profile.playerId, new Set(profile.countedRoundIds)]));
  const byScope = new Map<string, ReturnType<typeof computeMatchAnalytics>>();
  function analyticsFor(ids: readonly string[]) {
    if (!ids.length) return null;
    const key = JSON.stringify(ids);
    const existing = byScope.get(key);
    if (existing) return existing;
    const scope = new Set(ids);
    const result = computeMatchAnalytics({
      ...match,
      rounds: match.rounds.filter(round => scope.has(round.id)),
      events: match.events.filter(event => scope.has(event.roundId)),
    }, analytics.generatedAt);
    byScope.set(key, result);
    return result;
  }

  // Radar is optional in this projection. A projection-size or shape failure does
  // not discard independently verified statistics from the canonical source.
  let radar: ReturnType<typeof buildPlayerRadar> | undefined;
  try {
    radar = buildPlayerRadar(canonical, null, true);
  } catch (error) {
    if (!(error instanceof Error && error.name === 'ZodError')) throw error;
  }
  const players: ProfilePlayerMatch[] = match.players.flatMap(identity => {
    const steamId = profileSteamIdSchema.safeParse(identity.steamId);
    if (!steamId.success || identity.id !== steamId.data) return [];
    const participant = rating.players.find(row => row.playerId === identity.id);
    const counted = roundSets.get(identity.id) ?? new Set<string>();
    const measuredRounds = validRounds.filter(round => counted.has(round.id));
    const observed = measuredRounds.length;
    // Known positive facts can still be shown when participation does not permit a rate.
    const factual = (observed > 0 ? measuredRounds : validRounds).filter(round => !faultyDeathRounds.has(round.id));
    const factualIds = factual.map(round => round.id);
    const scoped = analyticsFor(factualIds)?.players.find(row => row.playerId === identity.id);
    const count = (value: number | null | undefined) => measurement(
      value === 0 && observed === 0 ? null : value ?? null, observed === 0 ? null : factual.length, expected,
      { partial: observed === 0 || match.quality !== 'VALID' },
    );
    const kastIds = match.tickRate === null ? [] : factualIds.filter(id =>
      counted.has(id) && match.players.every(player => roundSets.get(player.id)?.has(id)));
    const kast = analyticsFor(kastIds)?.players.find(row => row.playerId === identity.id);
    const damageRounds = measureEnemyDamage(match, identity.id, new Set(measuredRounds.map(round => round.id)));
    const verifiedDamageRounds = damageRounds.filter(round => round.complete);
    const total = (rows: typeof damageRounds, key: 'damage' | 'he' | 'fire') => rows.reduce((sum, round) => sum + round[key], 0);
    const sum = (key: 'damage' | 'he' | 'fire', hitKey: 'hits' | 'heHits' | 'fireHits') => {
      const complete = damageRounds.filter(round => key === 'damage' ? round.complete : key === 'he' ? round.heComplete : round.fireComplete).length;
      const amount = total(damageRounds, key);
      return measurement(complete > 0 || damageRounds.some(round => round[hitKey] > 0) ? amount : null, complete, expected,
        { partial: complete < damageRounds.length });
    };
    const playerRadar = radar?.players.find(player => player.playerId === identity.id);
    const partialRadar = radar && 'confirmedEvidence' in radar
      ? radar.confirmedEvidence.players.find(player => player.playerId === identity.id)?.axes : undefined;
    const axes: NonNullable<ProfilePlayerMatch['radar']>['axes'] = {} as NonNullable<ProfilePlayerMatch['radar']>['axes'];
    for (const axisId of playerRadarAxisIds) {
      const axis = playerRadar?.axes.find(row => row.axisId === axisId);
      const values = radarNumerators[axisId].map(id => axis?.secondaryMetrics.find(metric => metric.metricId === id)?.value ?? null);
      const numerator = values.every(value => value !== null) ? values.reduce((sum, value) => sum + value, 0) : null;
      const rounds = axis?.availability === 'AVAILABLE' ? axis.verifiedRounds : null;
      axes[axisId] = measurement(numerator, rounds, expected, {
          ...(rounds === null ? {} : { denominator: rounds }),
          notApplicable: axisId === 'OBJECTIVES' && rating.scenario !== 'BOMB' && rating.scenario !== 'UNKNOWN',
        });
    }
    const flash = playerRadar?.axes.find(axis => axis.axisId === 'FLASH');
    const flashPartial = partialRadar?.find(axis => axis.axisId === 'FLASH');
    const observedFlashes = match.events.filter(event => event.kind === 'PLAYER_BLIND' && event.context?.phase === 'LIVE'
      && counted.has(event.roundId));
    const ownBlinds = observedFlashes.filter(event => event.actorId === identity.id);
    const teamById = new Map(match.players.map(player => [player.id, player.teamId]));
    const blindCount = ownBlinds.filter(event => event.targetId !== null
      && teamById.has(event.targetId) && teamById.get(event.targetId) !== identity.teamId).length;
    const incompleteBlindRelations = ownBlinds.some(event => event.targetId === null || !teamById.has(event.targetId))
      || observedFlashes.some(event => event.actorId === null);
    const eyes = observedFlashes.length > 0 && (!incompleteBlindRelations || blindCount > 0) ? blindCount : null;
    const objective = (value: number | null | undefined, applicable: boolean) => applicable ? count(value)
      : measurement(null, null, expected, { notApplicable: rating.scenario !== 'UNKNOWN' });
    const hostageRescues = seed.roundStarts.filter(round => round.boundaryComplete && counted.has(round.roundId))
      .flatMap(round => round.supplementalEvents.filter(event => event.tick >= round.liveStart && event.tick <= round.liveEnd))
      .filter(event => event.kind === 'HOSTAGE_RESCUED' && event.actorId === identity.id).length;
    const team = match.teams.find(row => row.id === identity.teamId);
    const outcome = rating.awards.outcome;
    const end = match.rounds.at(-1);
    const ownScore = end?.scoreAfter[identity.teamId];
    const other = match.teams.find(row => row.id !== identity.teamId);
    const theirScore = other ? end?.scoreAfter[other.id] : undefined;
    const result = !team ? 'UNKNOWN' : outcome === 'DRAW' ? 'DRAW'
      : outcome === 'DECIDED' && ownScore !== undefined && theirScore !== undefined && ownScore !== theirScore
        ? (ownScore > theirScore ? 'WIN' : 'LOSS') : 'UNKNOWN';
    const explanation = canonical.explanation.players.find(row => row.playerId === identity.id);
    const evpPlayer = evp?.players.find(row => row.playerId === identity.id);
    return [{
      playerId: identity.id, steamId: steamId.data, displayName: identity.displayName || null,
      teamId: identity.teamId, teamLabel: team?.label ?? null, outcome: result,
      measurements: {
        verifiedRounds: measurement(participant ? observed : null, participant ? observed : null, expected),
        kills: count(scoped?.kills), deaths: count(scoped?.deaths), assists: count(scoped?.assists),
        kd: measurement(scoped?.kills == null || scoped.deaths === null || observed === 0 ? null : scoped.kills,
          observed === 0 ? null : factual.length, expected, { ...(scoped?.deaths == null ? {} : { denominator: scoped.deaths }) }),
        damage: sum('damage', 'hits'),
        adr: measurement(verifiedDamageRounds.length ? total(verifiedDamageRounds, 'damage') : null, verifiedDamageRounds.length, expected,
          { denominator: verifiedDamageRounds.length }),
        kast: measurement(kast?.kastRounds ?? null, kastIds.length, expected, { denominator: kastIds.length }),
        openingKills: count(scoped?.openingKills), openingDeaths: count(scoped?.openingDeaths), tradeKills: count(match.tickRate === null ? null : scoped?.tradeKills),
        doubleKills: count(scoped?.multiKills.two), tripleKills: count(scoped?.multiKills.three),
        quadKills: count(scoped?.multiKills.four), aces: count(scoped?.multiKills.five),
        clutchWins: measurement(axes.CLUTCH.numerator, axes.CLUTCH.observedRounds, expected),
        enemiesFlashed: measurement(eyes, observedFlashes.length && !incompleteBlindRelations ? observed : null, expected,
          { partial: incompleteBlindRelations }),
        enemyBlindSeconds: measurement(
          flash?.rawValue == null ? flashPartial ? flashPartial.rawValue * flash!.verifiedRounds : null : flash.rawValue * flash.verifiedRounds,
          flash?.rawValue != null ? flash.verifiedRounds : null, expected, { partial: !!flashPartial }),
        heDamage: sum('he', 'heHits'), fireDamage: sum('fire', 'fireHits'),
        bombPlants: objective(scoped?.bomb.plants, rating.scenario === 'BOMB'),
        bombDefuses: objective(scoped?.bomb.defuses, rating.scenario === 'BOMB'),
        hostageRescues: objective(hostageRescues > 0 ? hostageRescues : null, rating.scenario === 'HOSTAGE'),
      },
      radar: playerRadar ? { normalizationVersion: 'radar-normalization@1', axes } : null,
      rating: participant?.rating && explanation?.rating ? {
        value: participant.rating.value,
        families: explanation.rating.families.map(({ family, finalAttribution }) => ({ family, finalAttribution })),
      } : null,
      awards: {
        mvp: rating.awards.mvp.playerId === null ? null : rating.awards.mvp.playerId === identity.id,
        whoRuined: rating.awards.whoRuined.playerId === null ? null : rating.awards.whoRuined.playerId === identity.id,
        evp: evp?.applicability.applicable && evpPlayer
          ? evpPlayer.status === 'AWARDED'
            ? [evpPlayer.primarySpecializationId, evpPlayer.secondarySpecializationId].filter(id => id !== null) : []
          : null,
      },
    }];
  });
  return {
    schemaVersion: 'match-publication-state@1', revision, matchId: match.matchId, state: 'PUBLISHED',
    fileSha256: match.fileSha256, uploadedAt: uploadedAt.toISOString(), playedAt: null,
    map: match.map, quality: match.quality, policy: rating.policy, players,
  };
}
