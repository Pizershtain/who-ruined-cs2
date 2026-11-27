import { z } from 'zod';
import { evpEvidenceQualitySchema, evpSpecializationIdSchema } from './evp.js';
import { idSchema } from './internal.js';
import { h3ExplanationFamilySchema, h3FamilySchema, h3PolicySchema } from './h3.js';
import {
  participationExplanationFamilyRowSchema,
  participationExplanationFamilySchema,
} from './participation.js';

const finiteNumberSchema = z.number().finite();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const playerRadarSchemaVersion = 'player-radar@1' as const;
export const radarNormalizationVersion = 'radar-normalization@1' as const;
export const playerRadarAxisIds = [
  'MULTIKILL',
  'ASSISTS',
  'FLASH',
  'TRADES',
  'CLUTCH',
  'ENTRY',
  'UTILITY',
  'OBJECTIVES',
] as const;

export const playerRadarAxisIdSchema = z.enum(playerRadarAxisIds);
export const playerRadarAvailabilitySchema = z.enum(['AVAILABLE', 'UNAVAILABLE']);
export const playerRadarUnavailableReasonSchema = z.enum([
  'ANALYTICS_MISSING',
  'SOURCE_VALUE_UNAVAILABLE',
  'VERIFIED_ROUND_IDS_UNAVAILABLE',
  'INSUFFICIENT_VERIFIED_ROUNDS',
  'FLASH_DATA_UNAVAILABLE',
  'DAMAGE_DATA_UNAVAILABLE',
  'ALIVE_CONTEXT_UNAVAILABLE',
  'BOMB_SCENARIO_REQUIRED',
  'SCENARIO_UNKNOWN',
  'COMPARISON_POOL_EMPTY',
  'H2_UNAVAILABLE',
  'H2_PLAYER_RATING_UNAVAILABLE',
]);
export const playerRadarUnitSchema = z.enum([
  'COUNT',
  'POINTS',
  'SECONDS',
  'DAMAGE',
  'COUNT_PER_10_VERIFIED_ROUNDS',
  'SECONDS_PER_VERIFIED_ROUND',
  'DAMAGE_PER_VERIFIED_ROUND',
]);

const radarNormalizationSchema = z.object({
  kind: z.literal('LINEAR_FIXED_CAP'),
  minimum: z.literal(0),
  maximum: finiteNumberSchema.positive(),
}).strict();

export const playerRadarAxisDefinitionSchema = z.object({
  axisId: playerRadarAxisIdSchema,
  primaryMetricId: z.string().min(1).max(80),
  unit: playerRadarUnitSchema,
  direction: z.literal('HIGHER_IS_BETTER'),
  normalization: radarNormalizationSchema,
  comparisonPoolRule: z.literal('AVAILABLE_PLAYERS_WITH_SAME_METRIC_AND_DENOMINATOR'),
  limitationCodes: z.array(z.string().min(1).max(80)).max(8),
}).strict();

export const playerRadarComparisonSchema = z.object({
  axisId: playerRadarAxisIdSchema,
  availability: playerRadarAvailabilitySchema,
  reasonIfUnavailable: playerRadarUnavailableReasonSchema.nullable(),
  average: finiteNumberSchema.nullable(),
  comparisonPoolSize: z.number().int().nonnegative().max(64),
  incompleteCoverage: z.boolean(),
}).strict();

const radarSecondaryMetricSchema = z.object({
  metricId: z.string().min(1).max(80),
  value: finiteNumberSchema.nullable(),
  unit: playerRadarUnitSchema,
}).strict();

const radarEvpAttributionSchema = z.object({
  role: z.enum(['PRIMARY', 'SECONDARY']),
  reasonCode: z.literal('AWARDED_EVP_SPECIALIZATION'),
  specializationId: evpSpecializationIdSchema,
  achievementStrength: finiteNumberSchema.min(0).max(2),
  sourceMetrics: z.record(z.string().min(1).max(80), finiteNumberSchema.nullable()),
  thresholds: z.array(z.object({
    metric: z.string().min(1).max(80),
    actual: finiteNumberSchema.nullable(),
    minimum: finiteNumberSchema,
    passed: z.boolean(),
  }).strict()).max(16),
  evidenceQuality: evpEvidenceQualitySchema,
  evidenceEventIds: z.array(idSchema).max(512),
  evidenceRoundIds: z.array(idSchema).max(128),
}).strict();

const radarMvpAttributionSchema = z.object({
  reasonCode: z.literal('CONFIRMED_POSITIVE_H2_EVIDENCE'),
  terminologyCode: z.literal('POSITIVE_H2_FACTOR_NOT_DECISIVE_CAUSE'),
  families: z.array(z.object({
    family: participationExplanationFamilySchema,
    familyFinalAttribution: finiteNumberSchema.positive(),
  }).strict()).min(1).max(6),
  evidenceEventIds: z.array(idSchema).max(512),
  evidenceRoundIds: z.array(idSchema).max(128),
}).strict();

export const playerRadarAxisSchema = z.object({
  axisId: playerRadarAxisIdSchema,
  availability: playerRadarAvailabilitySchema,
  reasonIfUnavailable: playerRadarUnavailableReasonSchema.nullable(),
  rawValue: finiteNumberSchema.nonnegative().nullable(),
  unit: playerRadarUnitSchema,
  verifiedRounds: z.number().int().nonnegative(),
  geometryValue: finiteNumberSchema.min(0).max(1).nullable(),
  scaleExceeded: z.boolean(),
  matchAverage: finiteNumberSchema.nonnegative().nullable(),
  comparisonPoolSize: z.number().int().nonnegative().max(64),
  comparisonIncompleteCoverage: z.boolean(),
  secondaryMetrics: z.array(radarSecondaryMetricSchema).max(16),
  evpAttribution: radarEvpAttributionSchema.nullable(),
  mvpAttribution: radarMvpAttributionSchema.nullable(),
  evidenceEventIds: z.array(idSchema).max(512),
  evidenceRoundIds: z.array(idSchema).max(128),
  relatedH2Families: z.array(participationExplanationFamilySchema).max(6),
}).strict();

const playerRadarH2ExplanationSchema = z.object({
  availability: playerRadarAvailabilitySchema,
  reasonIfUnavailable: playerRadarUnavailableReasonSchema.nullable(),
  ratingValue: finiteNumberSchema.nullable(),
  families: z.array(participationExplanationFamilyRowSchema).max(6),
}).strict();

export const playerRadarPlayerSchema = z.object({
  playerId: idSchema,
  teamId: idSchema,
  awardState: z.enum(['MVP', 'EVP', 'NONE']),
  axes: z.array(playerRadarAxisSchema).length(playerRadarAxisIds.length),
  h2Explanation: playerRadarH2ExplanationSchema,
}).strict();

const historicalRadar = z.object({
  schemaVersion: z.literal(playerRadarSchemaVersion),
  matchId: idSchema,
  normalizationVersion: z.literal(radarNormalizationVersion),
  experimental: z.literal(true),
  sourceBinding: z.object({
    matchResultSchemaVersion: z.literal('match-result@1'),
    matchFileSha256: sha256Schema,
    h2ReportSchemaVersion: z.literal('m4.3-participation-rating@1').nullable(),
    evpReportSchemaVersion: z.literal('evp-report@1').nullable(),
    evpInputDigest: sha256Schema.nullable(),
  }).strict(),
  axisDefinitions: z.array(playerRadarAxisDefinitionSchema).length(playerRadarAxisIds.length),
  matchComparisons: z.array(playerRadarComparisonSchema).length(playerRadarAxisIds.length),
  players: z.array(playerRadarPlayerSchema).max(64),
}).strict();
const h3RadarAxis = playerRadarAxisSchema.omit({ relatedH2Families: true }).extend({
  relatedRatingFamilies: z.array(h3FamilySchema).max(7),
  mvpAttribution: radarMvpAttributionSchema.extend({
    reasonCode: z.literal('CONFIRMED_POSITIVE_H3_EVIDENCE'),
    terminologyCode: z.literal('POSITIVE_H3_FACTOR_NOT_DECISIVE_CAUSE'),
    families: z.array(radarMvpAttributionSchema.shape.families.element.extend({ family: h3FamilySchema })).min(1).max(7),
  }).nullable(),
});
const h3Radar = historicalRadar.extend({
  schemaVersion: z.literal('player-radar@2'),
  sourceBinding: historicalRadar.shape.sourceBinding.omit({ h2ReportSchemaVersion: true }).extend({
    matchResultSchemaVersion: z.literal('match-result@2'),
    ratingReportSchemaVersion: z.literal('m4.3-participation-rating@2'),
    ratingPolicy: h3PolicySchema,
  }),
  players: z.array(playerRadarPlayerSchema.omit({ h2Explanation: true }).extend({
    axes: z.array(h3RadarAxis).length(playerRadarAxisIds.length),
    ratingExplanation: playerRadarH2ExplanationSchema.extend({
      families: z.array(h3ExplanationFamilySchema).max(7),
      reasonIfUnavailable: z.literal('PLAYER_RATING_UNAVAILABLE').nullable(),
    }),
  })).max(64),
});

function checkRadar(report: z.infer<typeof historicalRadar> | z.infer<typeof h3Radar>, context: z.RefinementCtx) {
  const expected = playerRadarAxisIds.join('\u0000');
  if (report.axisDefinitions.map((row) => row.axisId).join('\u0000') !== expected) {
    context.addIssue({ code: 'custom', path: ['axisDefinitions'], message: 'radar axes must use the stable registry order' });
  }
  if (report.matchComparisons.map((row) => row.axisId).join('\u0000') !== expected) {
    context.addIssue({ code: 'custom', path: ['matchComparisons'], message: 'radar comparisons must use the stable registry order' });
  }
  for (let index = 0; index < report.matchComparisons.length; index += 1) {
    const comparison = report.matchComparisons[index]!;
    if (
      (comparison.availability === 'AVAILABLE' && (comparison.average === null || comparison.reasonIfUnavailable !== null || comparison.comparisonPoolSize === 0))
      || (comparison.availability === 'UNAVAILABLE' && (comparison.average !== null || comparison.reasonIfUnavailable === null || comparison.comparisonPoolSize !== 0))
    ) {
      context.addIssue({ code: 'custom', path: ['matchComparisons', index], message: 'comparison availability fields are inconsistent' });
    }
  }
  const playerIds = new Set<string>();
  for (let playerIndex = 0; playerIndex < report.players.length; playerIndex += 1) {
    const player = report.players[playerIndex]!;
    if (playerIds.has(player.playerId)) {
      context.addIssue({ code: 'custom', path: ['players', playerIndex, 'playerId'], message: 'duplicate radar player' });
    }
    playerIds.add(player.playerId);
    const historical = 'h2Explanation' in player;
    const explanation = historical ? player.h2Explanation : player.ratingExplanation;
    if (
      (explanation.availability === 'AVAILABLE' && (explanation.ratingValue === null || explanation.reasonIfUnavailable !== null || explanation.families.length !== (historical ? 6 : 7)))
      || (explanation.availability === 'UNAVAILABLE' && (explanation.ratingValue !== null || explanation.reasonIfUnavailable === null || explanation.families.length !== 0))
    ) {
      context.addIssue({ code: 'custom', path: ['players', playerIndex], message: 'Rating explanation availability fields are inconsistent' });
    }
    if (player.axes.map((row) => row.axisId).join('\u0000') !== expected) {
      context.addIssue({ code: 'custom', path: ['players', playerIndex, 'axes'], message: 'player axes must use the stable registry order' });
    }
    for (let axisIndex = 0; axisIndex < player.axes.length; axisIndex += 1) {
      const axis = player.axes[axisIndex]!;
      const comparison = report.matchComparisons[axisIndex]!;
      const definition = report.axisDefinitions[axisIndex]!;
      if (axis.unit !== definition.unit) {
        context.addIssue({ code: 'custom', path: ['players', playerIndex, 'axes', axisIndex, 'unit'], message: 'player axis unit does not match its definition' });
      }
      if (
        (axis.availability === 'AVAILABLE' && (axis.rawValue === null || axis.geometryValue === null || axis.reasonIfUnavailable !== null))
        || (axis.availability === 'UNAVAILABLE' && (axis.rawValue !== null || axis.geometryValue !== null || axis.reasonIfUnavailable === null || axis.scaleExceeded))
      ) {
        context.addIssue({ code: 'custom', path: ['players', playerIndex, 'axes', axisIndex, 'availability'], message: 'axis availability fields are inconsistent' });
      }
      if (axis.scaleExceeded && axis.geometryValue !== 1) {
        context.addIssue({ code: 'custom', path: ['players', playerIndex, 'axes', axisIndex, 'scaleExceeded'], message: 'an exceeded scale must use the outer geometry bound' });
      }
      if (axis.mvpAttribution !== null && player.awardState !== 'MVP') {
        context.addIssue({ code: 'custom', path: ['players', playerIndex, 'axes', axisIndex, 'mvpAttribution'], message: 'MVP attribution requires the MVP award state' });
      }
      if (axis.evpAttribution !== null && player.awardState !== 'EVP') {
        context.addIssue({ code: 'custom', path: ['players', playerIndex, 'axes', axisIndex, 'evpAttribution'], message: 'EVP attribution requires the EVP award state' });
      }
      if (
        axis.matchAverage !== comparison.average
        || axis.comparisonPoolSize !== comparison.comparisonPoolSize
        || axis.comparisonIncompleteCoverage !== comparison.incompleteCoverage
      ) {
        context.addIssue({ code: 'custom', path: ['players', playerIndex, 'axes', axisIndex], message: 'player comparison does not match the match projection' });
      }
    }
  }
  if ((report.sourceBinding.evpReportSchemaVersion === null) !== (report.sourceBinding.evpInputDigest === null)) {
    context.addIssue({ code: 'custom', path: ['sourceBinding'], message: 'EVP source binding must be complete or absent' });
  }
}

export const playerRadarReportSchema = historicalRadar.superRefine(checkRadar);
export const h3RadarReportSchema = h3Radar.superRefine(checkRadar);
export const storedPlayerRadarReportSchema = z.discriminatedUnion('schemaVersion', [playerRadarReportSchema, h3RadarReportSchema]);

const confirmedRadarValueSchema = z.object({
  axisId: z.enum(['FLASH', 'UTILITY']),
  rawValue: finiteNumberSchema.positive(),
  geometryValue: finiteNumberSchema.positive().max(1),
  evidenceEventIds: z.array(idSchema).min(1).max(512),
  evidenceRoundIds: z.array(idSchema).min(1).max(128),
}).strict();

const radarConfirmedEvidenceSchema = z.object({
  schemaVersion: z.literal('radar-confirmed-evidence@1'),
  players: z.array(z.object({
    playerId: idSchema,
    axes: z.array(confirmedRadarValueSchema).min(1).max(2),
  }).strict()).max(64),
}).strict();

export const playerRadarWithConfirmedEvidenceSchema = z.discriminatedUnion('schemaVersion', [
  historicalRadar.extend({ confirmedEvidence: radarConfirmedEvidenceSchema }),
  h3Radar.extend({ confirmedEvidence: radarConfirmedEvidenceSchema }),
]).superRefine((report, context) => {
  checkRadar(report, context);
  const players = new Map(report.players.map((player) => [player.playerId, player.axes]));
  for (const [index, player] of report.confirmedEvidence.players.entries()) {
    const axes = players.get(player.playerId);
    const ids = new Set<PlayerRadarAxisId>();
    for (const value of player.axes) {
      const axis = axes?.find((row) => row.axisId === value.axisId);
      const definition = report.axisDefinitions.find((row) => row.axisId === value.axisId);
      if (ids.has(value.axisId) || axis?.availability !== 'UNAVAILABLE' || axis.verifiedRounds === 0
        || !definition || value.geometryValue !== Math.min(1, value.rawValue / definition.normalization.maximum)) {
        context.addIssue({ code: 'custom', path: ['confirmedEvidence', 'players', index, 'axes'], message: 'confirmed evidence must bind to an unavailable axis with verified rounds' });
      }
      ids.add(value.axisId);
    }
    players.delete(player.playerId);
  }
});

export const playerRadarOpenApiSchema = z.toJSONSchema(playerRadarReportSchema, { target: 'openapi-3.0' });
export const storedPlayerRadarOpenApiSchema = z.toJSONSchema(storedPlayerRadarReportSchema, { target: 'openapi-3.0' });
export const playerRadarWithConfirmedEvidenceOpenApiSchema = z.toJSONSchema(playerRadarWithConfirmedEvidenceSchema, { target: 'openapi-3.0' });
export type PlayerRadarAxisId = z.infer<typeof playerRadarAxisIdSchema>;
export type PlayerRadarReport = z.infer<typeof playerRadarReportSchema>;
export type StoredPlayerRadarReport = z.infer<typeof storedPlayerRadarReportSchema>;
export type PlayerRadarAxis = z.infer<typeof playerRadarAxisSchema>;
export type PlayerRadarWithConfirmedEvidence = z.infer<typeof playerRadarWithConfirmedEvidenceSchema>;
export type RadarConfirmedValue = z.infer<typeof confirmedRadarValueSchema>;
