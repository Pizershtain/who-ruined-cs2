import { describe, expect, it } from 'vitest';
import {
  playerRadarAxisIds,
  playerRadarReportSchema,
  playerRadarWithConfirmedEvidenceSchema,
  radarNormalizationVersion,
} from '../src/player-radar.js';

function report() {
  const comparisons = playerRadarAxisIds.map((axisId) => ({
    axisId,
    availability: 'AVAILABLE' as const,
    reasonIfUnavailable: null,
    average: 1,
    comparisonPoolSize: 10,
    incompleteCoverage: false,
  }));
  return {
    schemaVersion: 'player-radar@1' as const,
    matchId: 'synthetic-match',
    normalizationVersion: radarNormalizationVersion,
    experimental: true as const,
    sourceBinding: {
      matchResultSchemaVersion: 'match-result@1' as const,
      matchFileSha256: 'a'.repeat(64),
      h2ReportSchemaVersion: 'm4.3-participation-rating@1' as const,
      evpReportSchemaVersion: null,
      evpInputDigest: null,
    },
    axisDefinitions: playerRadarAxisIds.map((axisId) => ({
      axisId,
      primaryMetricId: `${axisId}_METRIC`,
      unit: 'COUNT_PER_10_VERIFIED_ROUNDS' as const,
      direction: 'HIGHER_IS_BETTER' as const,
      normalization: { kind: 'LINEAR_FIXED_CAP' as const, minimum: 0 as const, maximum: 5 },
      comparisonPoolRule: 'AVAILABLE_PLAYERS_WITH_SAME_METRIC_AND_DENOMINATOR' as const,
      limitationCodes: [],
    })),
    matchComparisons: comparisons,
    players: [{
      playerId: 'player-1',
      teamId: 'team-1',
      awardState: 'NONE' as const,
      axes: playerRadarAxisIds.map((axisId) => ({
        axisId,
        availability: 'AVAILABLE' as const,
        reasonIfUnavailable: null,
        rawValue: 1,
        unit: 'COUNT_PER_10_VERIFIED_ROUNDS' as const,
        verifiedRounds: 10,
        geometryValue: 0.2,
        scaleExceeded: false,
        matchAverage: 1,
        comparisonPoolSize: 10,
        comparisonIncompleteCoverage: false,
        secondaryMetrics: [],
        evpAttribution: null,
        mvpAttribution: null,
        evidenceEventIds: [],
        evidenceRoundIds: [],
        relatedH2Families: [],
      })),
      h2Explanation: { availability: 'UNAVAILABLE' as const, reasonIfUnavailable: 'H2_PLAYER_RATING_UNAVAILABLE' as const, ratingValue: null, families: [] },
    }],
  };
}

describe('player-radar@1 contract', () => {
  it('accepts the stable eight-axis order and preserves confirmed zero values', () => {
    const value = report();
    value.players[0]!.axes[0]!.rawValue = 0;
    value.players[0]!.axes[0]!.geometryValue = 0;
    expect(playerRadarReportSchema.parse(value)).toEqual(value);
  });

  it('rejects reordered axes, non-finite values and inconsistent match averages', () => {
    const reordered = report();
    [reordered.players[0]!.axes[0], reordered.players[0]!.axes[1]] = [reordered.players[0]!.axes[1]!, reordered.players[0]!.axes[0]!];
    expect(playerRadarReportSchema.safeParse(reordered).success).toBe(false);

    const nonFinite = report();
    nonFinite.players[0]!.axes[0]!.rawValue = Number.POSITIVE_INFINITY;
    expect(playerRadarReportSchema.safeParse(nonFinite).success).toBe(false);

    const inconsistent = report();
    inconsistent.players[0]!.axes[0]!.matchAverage = 2;
    expect(playerRadarReportSchema.safeParse(inconsistent).success).toBe(false);
  });

  it('binds partial evidence to one unavailable axis without changing the historical response', () => {
    const base = report();
    const player = base.players[0]!;
    const value = {
      ...base,
      players: [{ ...player, axes: player.axes.map(axis => axis.axisId === 'FLASH' ? {
        ...axis, availability: 'UNAVAILABLE', reasonIfUnavailable: 'FLASH_DATA_UNAVAILABLE', rawValue: null, geometryValue: null,
      } : axis) }],
      confirmedEvidence: {
        schemaVersion: 'radar-confirmed-evidence@1',
        players: [{ playerId: player.playerId, axes: [{
          axisId: 'FLASH', rawValue: 2, geometryValue: .4, evidenceEventIds: ['blind'], evidenceRoundIds: ['round'],
        }] }],
      },
    };
    expect(playerRadarReportSchema.safeParse(base).success).toBe(true);
    expect(playerRadarReportSchema.safeParse(value).success).toBe(false);
    expect(playerRadarWithConfirmedEvidenceSchema.parse(value)).toEqual(value);
    expect(playerRadarWithConfirmedEvidenceSchema.safeParse({ ...value, players: base.players }).success).toBe(false);
    value.confirmedEvidence.players[0]!.axes[0]!.geometryValue = .9;
    expect(playerRadarWithConfirmedEvidenceSchema.safeParse(value).success).toBe(false);
  });
});
