import {
  h3FamilySchema, playerProfileSchema, playerRadarAxisIds, profileMetricIds, radarNormalizationVersion,
  type ProfileAggregate, type PlayerMeasurement, type ProfileMetricId, type PlayerRadarAxisId,
} from '@who-ruined/contracts';
import type { ProfileMatch } from './store.js';

function counters<K extends string>(keys: readonly K[]): Record<K, Aggregate> {
  return Object.fromEntries(keys.map(key => [key, new Aggregate()])) as Record<K, Aggregate>;
}

class Aggregate {
  private numerator = 0;
  private denominator = 0;
  private observedMatches = 0;
  private applicableMatches = 0;
  private expectedRounds = 0;
  private observedRounds = 0;
  private scopeKnown = true;
  private partial = false;

  add(row: PlayerMeasurement, ratio = false): void {
    if (row.status === 'NOT_APPLICABLE') return;
    this.applicableMatches += 1;
    this.expectedRounds += row.expectedRounds;
    if (row.numerator === null || (ratio && row.denominator === null)) return;
    this.observedMatches += 1;
    this.numerator += row.numerator;
    this.denominator += row.denominator ?? 0;
    if (row.observedRounds === null) this.scopeKnown = false;
    else this.observedRounds += row.observedRounds;
    this.partial ||= row.status === 'PARTIAL';
  }

  addMatch(value: number | null, ratio = false): void {
    this.add({
      numerator: value, denominator: value !== null && ratio ? 1 : null,
      status: value === null ? 'UNAVAILABLE' : 'AVAILABLE', expectedRounds: 0, observedRounds: null,
    }, ratio);
  }

  summary(totalMatches: number, ratio = false, scale = 1): ProfileAggregate {
    const available = this.observedMatches > 0 && (!ratio || this.denominator > 0);
    return {
      status: available
        ? this.partial || this.observedMatches < this.applicableMatches ? 'PARTIAL' : 'AVAILABLE'
        : this.applicableMatches === 0 ? 'NOT_APPLICABLE' : 'UNAVAILABLE',
      value: available ? ratio ? this.numerator / this.denominator * scale : this.numerator : null,
      numerator: available ? this.numerator : null, denominator: available && ratio ? this.denominator : null,
      observedMatches: this.observedMatches, applicableMatches: this.applicableMatches, totalMatches,
      expectedRounds: this.expectedRounds, observedRounds: this.scopeKnown && this.observedMatches > 0 ? this.observedRounds : null,
    };
  }
}

const ratios = new Set<ProfileMetricId>(['kd', 'adr', 'kast']);
type Specialization = NonNullable<ProfileMatch['player']['awards']['evp']>[number];
type Family = typeof h3FamilySchema.options[number];

export class ProfileAggregateBuilder {
  private readonly measured = counters(profileMetricIds);
  private readonly axes = counters(playerRadarAxisIds);
  private readonly awards = counters(['mvp', 'whoRuined', 'evp']);
  private readonly specializations: Partial<Record<Specialization, number>> = {};
  private readonly policies = new Map<string, { policy: ProfileMatch['policy']; ratings: Aggregate; families: Record<Family, Aggregate> }>();
  private readonly winRate = new Aggregate();
  private readonly outcomes = { wins: 0, losses: 0, draws: 0, unknown: 0 };
  private matchCount = 0;
  private displayName: string | null = null;

  constructor(private readonly steamId: string) {}

  add(match: Pick<ProfileMatch, 'player' | 'policy'>): void {
    const { player, policy } = match;
    this.matchCount += 1;
    this.displayName ??= player.displayName;
    const outcome = player.outcome;
    this.outcomes[outcome === 'WIN' ? 'wins' : outcome === 'LOSS' ? 'losses' : outcome === 'DRAW' ? 'draws' : 'unknown'] += 1;
    this.winRate.addMatch(outcome === 'UNKNOWN' ? null : Number(outcome === 'WIN'), true);
    for (const metric of profileMetricIds) this.measured[metric].add(player.measurements[metric], ratios.has(metric));
    for (const axis of playerRadarAxisIds) this.axes[axis].add(player.radar?.axes[axis] ?? {
      status: 'UNAVAILABLE', numerator: null, denominator: null, observedRounds: null,
      expectedRounds: player.measurements.verifiedRounds.expectedRounds,
    }, true);
    const scoring = this.policies.get(policy.digest) ?? { policy, ratings: new Aggregate(), families: counters(h3FamilySchema.options) };
    this.policies.set(policy.digest, scoring);
    scoring.ratings.addMatch(player.rating?.value ?? null, true);
    for (const key of h3FamilySchema.options) {
      scoring.families[key].addMatch(player.rating?.families.find(value => value.family === key)?.finalAttribution ?? null, true);
    }
    this.awards.mvp.addMatch(player.awards.mvp === null ? null : Number(player.awards.mvp));
    this.awards.whoRuined.addMatch(player.awards.whoRuined === null ? null : Number(player.awards.whoRuined));
    this.awards.evp.addMatch(player.awards.evp === null ? null : Number(player.awards.evp.length > 0));
    for (const id of new Set(player.awards.evp ?? [])) this.specializations[id] = (this.specializations[id] ?? 0) + 1;
  }

  build() {
    const matches = this.matchCount;
    if (!matches) return null;
    const axisSummary = (axis: PlayerRadarAxisId) => this.axes[axis].summary(matches, true, axis === 'FLASH' || axis === 'UTILITY' ? 1 : 10);
    return playerProfileSchema.parse({
      schemaVersion: 'player-profile@1', steamId: this.steamId, displayName: this.displayName, matchCount: matches,
      results: { ...this.outcomes, winRate: this.winRate.summary(matches, true, 100) },
      measurements: Object.fromEntries(profileMetricIds.map(key => [key, this.measured[key].summary(matches, ratios.has(key), key === 'kast' ? 100 : 1)])),
      ratings: [...this.policies.values()].map(({ policy, ratings, families }) => ({
        policy, rating: ratings.summary(matches, true),
        families: h3FamilySchema.options.map(family => ({ family, contribution: families[family].summary(matches, true) })),
      })),
      awards: {
        mvp: this.awards.mvp.summary(matches), whoRuined: this.awards.whoRuined.summary(matches),
        evp: this.awards.evp.summary(matches), evpSpecializations: this.specializations,
      },
      radar: { normalizationVersion: radarNormalizationVersion, axes: Object.fromEntries(playerRadarAxisIds.map(axis => [axis, axisSummary(axis)])) },
    });
  }
}
