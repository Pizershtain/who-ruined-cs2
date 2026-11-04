import { z } from 'zod';
import { idSchema as id } from './internal.js';
import { teamSchema } from './matches.js';

export const replayEventKindSchema = z.enum(['KILL', 'BOMB_PLANTED', 'BOMB_DEFUSED']);
export type ReplayEventKind = z.infer<typeof replayEventKindSchema>;
export const replayCoverageSchema = z.enum(['COMPLETE', 'PARTIAL']);
export const replayAvailabilitySchema = z.enum(['AVAILABLE', 'REPLAY_UNAVAILABLE', 'UNSUPPORTED_MAP']);
export const replayPlayerStateSchema = z.tuple([
  z.number().int().nonnegative(),
  z.number().nullable(), z.number().nullable(), z.number().nullable(),
  z.number().nullable(), z.number().nullable(), z.boolean()
]);
export const replayFrameSchema = z.object({
  tick: z.number().int().nonnegative(),
  states: z.array(replayPlayerStateSchema).max(64)
});
export const replayEventSchema = z.object({
  id,
  kind: replayEventKindSchema,
  tick: z.number().int().nonnegative(),
  actorId: id.nullable(),
  targetId: id.nullable(),
  assisterId: id.nullable()
});
export const replayMapCalibrationSchema = z.object({
  id: z.string().min(1).max(160),
  map: z.literal('de_dust2'),
  imageWidth: z.number().int().positive().max(8192),
  imageHeight: z.number().int().positive().max(8192),
  posX: z.number(),
  posY: z.number(),
  scale: z.number().positive(),
  rotate: z.number().int(),
  source: z.literal('VALVE_OVERVIEW_METADATA'),
  sourceVersion: z.string().min(1).max(160),
  imageUrl: z.string().max(512).nullable()
});
export type ReplayMapCalibration = z.infer<typeof replayMapCalibrationSchema>;

const radarImageUrl = z.string().regex(/^\/maps\/[a-f0-9]{40}\/[a-z0-9_]+\.png$/);
export const replayRadarLayerSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/).max(64),
  imageUrl: radarImageUrl,
  minZ: z.number().finite().nullable(),
  maxZ: z.number().finite().nullable(),
}).refine(layer => (layer.minZ === null && layer.maxZ === null) ||
  (layer.minZ !== null && layer.maxZ !== null && layer.minZ < layer.maxZ), 'Invalid altitude interval');
export type ReplayRadarLayer = z.infer<typeof replayRadarLayerSchema>;
export const replayRadarCalibrationSchema = replayMapCalibrationSchema.extend({
  map: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/),
  imageUrl: radarImageUrl,
  layers: z.array(replayRadarLayerSchema).min(1).max(16),
}).refine(value => {
  if (new Set(value.layers.map(layer => layer.id)).size !== value.layers.length) return false;
  if (!value.layers.some(layer => layer.id === 'default' && layer.imageUrl === value.imageUrl)) return false;
  if (value.layers.length === 1) return true;
  const sorted = [...value.layers].sort((a, b) => (a.minZ ?? 0) - (b.minZ ?? 0));
  return sorted.every((layer, index) => layer.minZ !== null && layer.maxZ !== null &&
    (index === 0 || sorted[index - 1]!.maxZ! <= layer.minZ));
}, 'Invalid radar layers');
export type ReplayRadarCalibration = z.infer<typeof replayRadarCalibrationSchema>;

const replayBindingSchema = z.object({
  matchId: id,
  fileSha256: z.string().regex(/^[a-f0-9]{64}$/),
  parserVersion: z.string().min(1).max(80),
  normalizerVersion: z.string().min(1).max(80)
});
export const replayRoundArtifactSchema = z.object({
  schemaVersion: z.literal('m4.7-replay-round@1'),
  binding: replayBindingSchema,
  round: z.object({
    id, ordinal: z.number().int().positive(),
    startTick: z.number().int().nonnegative(),
    freezeEndTick: z.number().int().nonnegative().nullable(),
    endTick: z.number().int().nonnegative()
  }),
  tickRate: z.number().positive(),
  sampleRateHz: z.number().positive().max(32),
  coverage: replayCoverageSchema,
  frames: z.array(replayFrameSchema).max(20_000),
  events: z.array(replayEventSchema).max(5_000),
  warnings: z.array(z.string().max(160)).max(100)
});
export type ReplayRoundArtifact = z.infer<typeof replayRoundArtifactSchema>;

export const replayIndexArtifactSchema = z.object({
  schemaVersion: z.literal('m4.7-replay-index@1'),
  binding: replayBindingSchema,
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  map: z.string().nullable(),
  tickRate: z.number().positive(),
  sampleRateHz: z.number().positive().max(32),
  calibration: replayMapCalibrationSchema.nullable(),
  players: z.array(z.object({ id, displayName: z.string().max(160), teamId: id })).max(64),
  teams: z.array(teamSchema).max(8),
  rounds: z.array(z.object({
    id, ordinal: z.number().int().positive(),
    startTick: z.number().int().nonnegative(),
    freezeEndTick: z.number().int().nonnegative().nullable(),
    endTick: z.number().int().nonnegative(),
    sampleCount: z.number().int().nonnegative(),
    eventCount: z.number().int().nonnegative(),
    coverage: replayCoverageSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    compressedBytes: z.number().int().positive()
  })).max(256),
  totalFrames: z.number().int().nonnegative(),
  totalCompressedBytes: z.number().int().nonnegative(),
  warnings: z.array(z.string().max(160)).max(100)
});
export type ReplayIndexArtifact = z.infer<typeof replayIndexArtifactSchema>;

export const replayMetadataV1Schema = z.object({
  schemaVersion: z.literal('m4.7-replay-metadata@1'),
  matchId: id,
  availability: replayAvailabilitySchema,
  reason: z.enum(['REPLAY_UNAVAILABLE', 'UNSUPPORTED_MAP']).nullable(),
  map: z.string().nullable(),
  tickRate: z.number().positive().nullable(),
  sampleRateHz: z.number().positive().max(32).nullable(),
  calibration: replayMapCalibrationSchema.nullable(),
  players: z.array(z.object({ id, displayName: z.string().max(160), teamId: id })).max(64),
  teams: z.array(teamSchema).max(8),
  rounds: z.array(z.object({
    id, ordinal: z.number().int().positive(),
    startTick: z.number().int().nonnegative(),
    freezeEndTick: z.number().int().nonnegative().nullable(),
    endTick: z.number().int().nonnegative(),
    sampleCount: z.number().int().nonnegative(),
    eventCount: z.number().int().nonnegative(),
    coverage: replayCoverageSchema.nullable()
  })).max(256),
  totalFrames: z.number().int().nonnegative(),
  totalCompressedBytes: z.number().int().nonnegative(),
  warnings: z.array(z.string().max(160)).max(100)
});
export const replayMetadataV2Schema = replayMetadataV1Schema.extend({
  schemaVersion: z.literal('m4.7-replay-metadata@2'),
  calibration: replayRadarCalibrationSchema.nullable(),
}).refine(value => value.calibration === null || value.calibration.map === value.map, 'Radar map mismatch')
  .refine(value => value.availability !== 'AVAILABLE' || (value.calibration !== null && value.reason === null), 'Available replay needs a radar');
export const replayMetadataSchema = z.union([replayMetadataV1Schema, replayMetadataV2Schema]);
export type ReplayMetadata = z.infer<typeof replayMetadataSchema>;
export const replayMetadataOpenApiSchema = z.toJSONSchema(replayMetadataSchema, { target: 'openapi-3.0' });
export const replayRoundOpenApiSchema = z.toJSONSchema(replayRoundArtifactSchema, { target: 'openapi-3.0' });

