import { z } from 'zod';
import { idSchema as id } from './internal.js';
import { h3FamilySchema, h3PolicySchema } from './h3.js';
import { evpSpecializationIdSchema } from './evp.js';
import { playerRadarAxisIdSchema, radarNormalizationVersion } from './player-radar.js';
import { availabilitySchema } from './analytics.js';

const count = z.number().int().nonnegative();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const date = z.string().datetime();
export const profileSteamIdSchema = z.string().refine(value => {
  if (!/^\d{17}$/u.test(value)) return false;
  const id64 = BigInt(value);
  return id64 > 76561197960265728n && id64 <= 76561202255233023n;
});
export const publicationRevisionSchema = z.string().refine(value =>
  /^(?:0|[1-9]\d{0,18})$/u.test(value) && BigInt(value) <= 9223372036854775807n);
export const matchPublicationsSchema = z.object({
  schemaVersion: z.literal('match-publications@1'),
  events: z.array(z.object({
    revision: publicationRevisionSchema, matchId: id,
    kind: z.enum(['RESULT_PUBLISHED', 'RESULT_UPDATED', 'MATCH_DELETED']),
  }).strict()).max(100),
}).strict();

export const profileAvailabilitySchema = availabilitySchema.or(z.literal('NOT_APPLICABLE'));
const measurementFields = {
  status: profileAvailabilitySchema,
  numerator: z.number().nullable(),
  denominator: z.number().nonnegative().nullable(),
  observedRounds: count.nullable(),
  expectedRounds: count,
};
const checkMeasurement = (row: z.infer<z.ZodObject<typeof measurementFields>>) => {
  const measured = row.status === 'AVAILABLE' || row.status === 'PARTIAL';
  return (row.numerator !== null) === measured && (measured || row.denominator === null)
    && (row.observedRounds === null || row.observedRounds <= row.expectedRounds);
};
export const playerMeasurementSchema = z.object(measurementFields).strict().refine(checkMeasurement);
export type PlayerMeasurement = z.infer<typeof playerMeasurementSchema>;
export const profileMetricIds = [
  'verifiedRounds', 'kills', 'deaths', 'assists', 'kd', 'damage', 'adr', 'kast',
  'openingKills', 'openingDeaths', 'tradeKills', 'doubleKills', 'tripleKills', 'quadKills', 'aces',
  'clutchWins', 'enemiesFlashed', 'enemyBlindSeconds', 'heDamage', 'fireDamage',
  'bombPlants', 'bombDefuses', 'hostageRescues',
] as const;
export type ProfileMetricId = typeof profileMetricIds[number];
const profileMetricId = z.enum(profileMetricIds);
const measurements = z.record(profileMetricId, playerMeasurementSchema);
const radarMeasurements = z.object({
  normalizationVersion: z.literal(radarNormalizationVersion),
  axes: z.record(playerRadarAxisIdSchema, playerMeasurementSchema),
}).strict();

export const profilePlayerMatchSchema = z.object({
  playerId: id, steamId: profileSteamIdSchema, displayName: z.string().max(512).nullable(),
  teamId: id, teamLabel: z.string().max(512).nullable(),
  outcome: z.enum(['WIN', 'LOSS', 'DRAW', 'UNKNOWN']),
  measurements,
  radar: radarMeasurements.nullable(),
  rating: z.object({
    value: z.number(),
    families: z.array(z.object({
      family: h3FamilySchema, finalAttribution: z.number().nullable(),
    }).strict()).length(7),
  }).strict().nullable(),
  awards: z.object({
    mvp: z.boolean().nullable(),
    whoRuined: z.boolean().nullable(),
    evp: z.array(evpSpecializationIdSchema).max(2).nullable(),
  }).strict(),
}).strict();
export type ProfilePlayerMatch = z.infer<typeof profilePlayerMatchSchema>;

const publishedMatchHeader = {
  fileSha256: hash, uploadedAt: date, playedAt: date.nullable(), map: z.string().max(512).nullable(),
  quality: z.enum(['VALID', 'PARTIAL', 'UNSUPPORTED']), policy: h3PolicySchema,
};
const publicationIdentity = {
  schemaVersion: z.literal('match-publication-state@1'), matchId: id, revision: publicationRevisionSchema,
};
export const matchPublicationStateSchema = z.discriminatedUnion('state', [
  z.object({ ...publicationIdentity, state: z.literal('EXCLUDED') }).strict(),
  z.object({
    ...publicationIdentity, ...publishedMatchHeader, state: z.literal('PUBLISHED'),
    players: z.array(profilePlayerMatchSchema).max(64),
  }).strict(),
]).superRefine((state, ctx) => {
  if (state.state === 'EXCLUDED') return;
  for (const field of ['playerId', 'steamId'] as const) {
    if (new Set(state.players.map(player => player[field])).size !== state.players.length) {
      ctx.addIssue({ code: 'custom', path: ['players'], message: 'duplicate projected identities' });
    }
  }
});
export type MatchPublicationState = z.infer<typeof matchPublicationStateSchema>;
export type MatchPublications = z.infer<typeof matchPublicationsSchema>;

const aggregate = z.object({
  ...measurementFields,
  value: z.number().nullable(), observedMatches: count, applicableMatches: count, totalMatches: count,
}).strict().refine(row => checkMeasurement(row)
  && row.observedMatches <= row.applicableMatches && row.applicableMatches <= row.totalMatches
  && (row.value !== null) === (row.numerator !== null));
export type ProfileAggregate = z.infer<typeof aggregate>;
const h3Summary = z.object({
  policy: h3PolicySchema,
  rating: aggregate,
  families: z.array(z.object({ family: h3FamilySchema, contribution: aggregate }).strict()).length(7),
}).strict();
export const playerProfileSchema = z.object({
  schemaVersion: z.literal('player-profile@1'),
  steamId: profileSteamIdSchema, displayName: z.string().max(512).nullable(),
  matchCount: count,
  results: z.object({ wins: count, losses: count, draws: count, unknown: count, winRate: aggregate }).strict(),
  measurements: z.record(profileMetricId, aggregate),
  ratings: z.array(h3Summary),
  awards: z.object({
    mvp: aggregate, whoRuined: aggregate, evp: aggregate,
    evpSpecializations: z.partialRecord(evpSpecializationIdSchema, count),
  }).strict(),
  radar: z.object({ normalizationVersion: z.literal(radarNormalizationVersion), axes: z.record(playerRadarAxisIdSchema, aggregate) }).strict(),
}).strict();
export const playerProfileHistorySchema = z.object({
  schemaVersion: z.literal('player-profile-history@1'), steamId: profileSteamIdSchema,
  matches: z.array(z.object({ ...publishedMatchHeader, matchId: id, player: profilePlayerMatchSchema }).strict()).max(50),
  nextCursor: z.string().max(512).nullable(),
}).strict();
