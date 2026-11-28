import { z } from 'zod';
import { profileSteamIdSchema } from './player-profiles.js';

export const authContractVersion = 'auth@1';
export const authErrorCodeSchema = z.enum([
  'INVALID_CREDENTIALS', 'UNAUTHENTICATED', 'SESSION_EXPIRED', 'AUTH_ORIGIN_NOT_ALLOWED',
  'RATE_LIMITED', 'AUTH_UNAVAILABLE', 'INVALID_REQUEST', 'NOT_FOUND', 'SIZE_LIMIT',
  'REQUEST_TIMEOUT', 'REQUEST_URI_TOO_LONG', 'USERNAME_TAKEN',
]);
export type AuthErrorCode = z.infer<typeof authErrorCodeSchema>;
export const authErrorEnvelopeSchema = z.object({
  error: z.object({ code: authErrorCodeSchema, message: z.string() }),
  requestId: z.string(),
});
const usernameFormat = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/u);
export const authUsernameSchema = usernameFormat.transform(value => value.toLowerCase());
export const authLoginSchema = z.object({
  username: authUsernameSchema,
  password: z.string().min(1).max(1024),
}).strict();

export const authNewPasswordSchema = z.string().max(1024).refine(value =>
  !/[\r\n\0]/u.test(value) && Array.from(value).length >= 12 && new TextEncoder().encode(value).length <= 1024);

export const authRegistrationSchema = z.strictObject({
  username: usernameFormat,
  password: authNewPasswordSchema,
  steamId: profileSteamIdSchema.optional(),
});
export type AuthRegistrationInput = z.infer<typeof authRegistrationSchema>;

export const authUserSchema = z.object({
  id: z.uuid(),
  username: authUsernameSchema.nullable(),
  displayName: z.string().min(1).max(80),
}).strict();
export type AuthUserDto = z.infer<typeof authUserSchema>;

export const authTokensSchema = z.object({
  accessToken: z.string().min(1),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive(),
  user: authUserSchema,
}).strict();
export type AuthTokensDto = z.infer<typeof authTokensSchema>;

export const authPlayerLinkInputSchema = z.object({
  steamId: profileSteamIdSchema,
  nickname: z.string().trim().min(1).max(80).regex(/^[^\p{Cc}]+$/u),
}).strict();
export type AuthPlayerLinkInput = z.infer<typeof authPlayerLinkInputSchema>;

const playerLinkVersion = z.literal('auth-player-link@1');
export const authPlayerLinkSchema = z.discriminatedUnion('state', [
  z.object({ schemaVersion: playerLinkVersion, state: z.literal('UNLINKED') }).strict(),
  authPlayerLinkInputSchema.extend({
    schemaVersion: playerLinkVersion,
    state: z.literal('LINKED'),
    source: z.literal('MANUAL'),
    verificationStatus: z.literal('UNVERIFIED'),
  }),
]);
export type AuthPlayerLink = z.infer<typeof authPlayerLinkSchema>;
