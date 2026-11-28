import { createHash, randomBytes, type KeyObject } from 'node:crypto';
import { calculateJwkThumbprint, errors, jwtVerify, SignJWT } from 'jose';
import { z } from 'zod';
import { AuthFault } from './fault.js';

export const accessAlgorithm = 'ES256';
export const accessAudience = 'who-ruined-api';
const accessClaims = z.object({ sub: z.uuid(), sid: z.uuid(), iat: z.number().int(), exp: z.number().int() });

export async function tokenKeyId(publicKey: KeyObject): Promise<string> {
  return calculateJwkThumbprint(publicKey);
}

/** Verifies the portable token without a DB or a call to Auth. Use only a locally trusted public key. */
export async function verifyAccess(value: string, publicKey: KeyObject, issuer: string, keyId: string, now: Date) {
  try {
    const verified = await jwtVerify(value, publicKey, {
      algorithms: [accessAlgorithm], issuer, audience: accessAudience, typ: 'at+jwt',
      requiredClaims: ['sub', 'sid', 'iat', 'exp'], maxTokenAge: 900, currentDate: now,
    });
    const parsed = accessClaims.safeParse(verified.payload);
    if (verified.protectedHeader.kid !== keyId || !parsed.success) throw new AuthFault('UNAUTHENTICATED');
    return parsed.data;
  } catch (error) {
    throw new AuthFault(error instanceof errors.JWTExpired ? 'SESSION_EXPIRED' : 'UNAUTHENTICATED');
  }
}

export function signAccess(privateKey: KeyObject, issuer: string, keyId: string, userId: string, sessionId: string, issued: number, expires: number) {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: accessAlgorithm, typ: 'at+jwt', kid: keyId })
    .setIssuer(issuer).setAudience(accessAudience).setSubject(userId)
    .setIssuedAt(issued).setExpirationTime(expires).sign(privateKey);
}

export function secretDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}
