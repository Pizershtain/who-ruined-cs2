import { generateKeyPairSync, randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { authLoginSchema } from '@who-ruined/contracts';
import type { PrismaClient } from '../generated/client/index.js';
import { assertBrowserOrigin, AuthController, clientAddress, readRefreshCookie } from '../src/http.js';
import { readAuthConfig } from '../src/runtime.js';
import type { AuthService, Issued } from '../src/service.js';
import { newRefreshToken, signAccess, tokenKeyId, verifyAccess } from '../src/tokens.js';

const env = {
  AUTH_ORIGIN: 'http://127.0.0.1:5173',
  AUTH_DATABASE_URL: 'postgresql://fixture@localhost/fixture',
  AUTH_SIGNING_KEY_FILE: 'fixture.pem',
};
const config = readAuthConfig({ ...env, AUTH_MODE: 'local-dev' });
const pair = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

describe('Auth trust boundaries', () => {
  it('requires HTTPS and trusted transport in production and only admits IP loopback in opt-in dev', () => {
    expect(() => readAuthConfig(env)).toThrow('HTTPS');
    expect(() => readAuthConfig({ ...env, AUTH_MODE: 'local-dev', AUTH_ORIGIN: 'http://192.168.1.1:5173' })).toThrow();
    expect(() => readAuthConfig({ ...env, AUTH_MODE: 'local-dev', AUTH_BIND_HOST: '0.0.0.0' })).toThrow();
    expect(readAuthConfig({ ...env, AUTH_TRUST_GATEWAY: '1', AUTH_ORIGIN: 'https://auth.example.test' }).local).toBe(false);
    expect(config.local).toBe(true);
    expect(authLoginSchema.parse({ username: 'DEV_User', password: 'fixture' }).username).toBe('dev_user');
    expect(authLoginSchema.safeParse({ username: 'ＤＥＶ', password: 'fixture' }).success).toBe(false);
  });

  it('requires exact Origin and Host for cookies and uses the socket address outside its trusted network', () => {
    const request = {
      headers: { host: '127.0.0.1:5173', origin: env.AUTH_ORIGIN, 'x-real-ip': '192.0.2.15', 'x-forwarded-for': '192.0.2.15' },
      socket: { remoteAddress: '::ffff:127.0.0.1' }, originalUrl: '/api/v1/auth/refresh',
    } as unknown as Request;
    expect(() => assertBrowserOrigin(request, config, true)).not.toThrow();
    expect(clientAddress(request, false)).toBe('127.0.0.1');
    request.headers['sec-fetch-site'] = 'cross-site';
    expect(() => assertBrowserOrigin(request, config, true)).toThrow(expect.objectContaining({ code: 'AUTH_ORIGIN_NOT_ALLOWED' }));
    request.headers['sec-fetch-site'] = 'same-origin';
    expect(() => assertBrowserOrigin(request, config, true)).not.toThrow();
    request.headers.origin = 'https://elsewhere.example.test';
    expect(() => assertBrowserOrigin(request, config, true)).toThrow(expect.objectContaining({ code: 'AUTH_ORIGIN_NOT_ALLOWED' }));
    request.headers.origin = undefined;
    expect(() => assertBrowserOrigin(request, config, true)).toThrow();
  });

  it('rejects duplicate, malformed and non-canonical refresh cookies', () => {
    const name = 'test_refresh';
    const token = newRefreshToken();
    expect(readRefreshCookie(`other=cookie; ${name}=${token}`, name)).toBe(token);
    for (const raw of [undefined, `${name}=abc`, `${name}=${token}; ${name}=${token}`, `${name}=${token}=`]) {
      expect(readRefreshCookie(raw, name)).toBeNull();
    }
  });

  it('sets and clears a host-only secure production refresh cookie while exposing only the access token', async () => {
    const httpsOrigin = 'https://auth.example.test';
    const production = readAuthConfig({ ...env, AUTH_TRUST_GATEWAY: '1', AUTH_ORIGIN: httpsOrigin });
    const issued: Issued = {
      body: {
        accessToken: 'fixture-access', tokenType: 'Bearer', expiresIn: 720,
        user: { id: randomUUID(), username: 'fixture', displayName: 'Fixture' },
      },
      refreshToken: newRefreshToken(), cookieUntil: new Date(1_800_000_000_000),
    };
    const refresh = vi.fn().mockResolvedValue(issued);
    const logout = vi.fn().mockResolvedValue(undefined);
    const controller = new AuthController({ refresh, logout } as unknown as AuthService, production, {} as PrismaClient);
    const request = {
      headers: {
        origin: httpsOrigin, 'x-forwarded-host': 'auth.example.test', 'x-forwarded-proto': 'https',
        'sec-fetch-site': 'same-origin', cookie: `__Host-wrc_refresh=${issued.refreshToken}`,
      },
      originalUrl: '/api/v1/auth/refresh',
    } as unknown as Request;
    const cookie = vi.fn();
    const clearCookie = vi.fn();
    const response = { cookie, clearCookie } as unknown as Response;
    const secureCookie = { httpOnly: true, secure: true, sameSite: 'strict', path: '/' };

    await expect(controller.refresh(request, response)).resolves.toEqual(issued.body);
    expect(refresh).toHaveBeenCalledWith(issued.refreshToken);
    expect(cookie).toHaveBeenCalledWith('__Host-wrc_refresh', issued.refreshToken, { ...secureCookie, expires: issued.cookieUntil });
    await controller.logout(request, response);
    expect(logout).toHaveBeenCalledWith(issued.refreshToken);
    expect(clearCookie).toHaveBeenCalledWith('__Host-wrc_refresh', secureCookie);
  });

  it('verifies a signed JWT independently and rejects foreign keys, claims, expiry and algorithms', async () => {
    const { privateKey, publicKey } = pair();
    const kid = await tokenKeyId(publicKey);
    const issuer = 'urn:wrc:auth:test';
    const sub = randomUUID();
    const sid = randomUUID();
    const issued = 1_800_000_000;
    const now = new Date(issued * 1000);
    const token = await signAccess(privateKey, issuer, kid, sub, sid, issued, issued + 720);
    await expect(verifyAccess(token, publicKey, issuer, kid, now)).resolves.toMatchObject({ sub, sid });
    await expect(verifyAccess(token, pair().publicKey, issuer, kid, now)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(verifyAccess(token, publicKey, 'wrong-issuer', kid, now)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(verifyAccess(token, publicKey, issuer, 'different-key-id', now)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(verifyAccess(token, publicKey, issuer, kid, new Date((issued + 720) * 1000))).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    const changedAudience = await new SignJWT({ sid }).setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid })
      .setSubject(sub).setIssuer(issuer).setAudience('another-app').setIssuedAt(issued).setExpirationTime(issued + 60).sign(privateKey);
    await expect(verifyAccess(changedAudience, publicKey, issuer, kid, now)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const wrongAlgorithm = await new SignJWT({ sid }).setProtectedHeader({ alg: 'HS256', typ: 'at+jwt', kid })
      .setSubject(sub).setIssuer(issuer).setAudience('who-ruined-api').setIssuedAt(issued).setExpirationTime(issued + 60)
      .sign(new Uint8Array(32));
    await expect(verifyAccess(wrongAlgorithm, publicKey, issuer, kid, now)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
