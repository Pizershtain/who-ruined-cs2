import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '../generated/client/index.js';
import { createLocalUser, maintainLocalUser } from '../src/local-users.js';
import { readAuthConfig } from '../src/runtime.js';
import { AuthService } from '../src/service.js';
import { newRefreshToken, secretDigest } from '../src/tokens.js';

const target = process.env.TEST_AUTH_DATABASE_URL ?? process.env.TEST_DATABASE_URL;
if (!target && process.env.REQUIRE_POSTGRES_INTEGRATION === '1') throw new Error('AUTH_TEST_DATABASE_REQUIRED');
if (target) {
  const url = new URL(target);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || !/(?:^|[_-])test(?:$|[_-])/iu.test(decodeURIComponent(url.pathname).slice(1))) {
    throw new Error('AUTH_TEST_DATABASE_MUST_BE_LOCAL_AND_DISPOSABLE');
  }
}

describe.skipIf(!target)('Auth transactions on PostgreSQL', () => {
  const schema = 'wrc_auth_test_' + randomUUID().replaceAll('-', '');
  const fixturePassword = 'Only a PostgreSQL API test passphrase';
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const config = readAuthConfig({
    AUTH_DATABASE_URL: target ?? 'postgresql://fixture@127.0.0.1/wrc_auth_test', AUTH_MODE: 'local-dev', AUTH_ORIGIN: 'http://127.0.0.1:5173',
    AUTH_SIGNING_KEY_FILE: 'not-a-real-file.pem', AUTH_LOGIN_PER_IP: '100', AUTH_LOGIN_PER_USERNAME: '20',
  });
  let db: PrismaClient;
  let second: PrismaClient;
  let auth: AuthService;
  let other: AuthService;
  const login = (username: string, password = fixturePassword) => auth.authenticateWithPassword(username, password, '192.0.2.1');
  const create = (username: string) => createLocalUser(db, username, 'Synthetic test account', fixturePassword, config.passwordCost);

  beforeAll(async () => {
    const url = new URL(target!);
    url.searchParams.set('schema', schema);
    db = new PrismaClient({ datasourceUrl: url.href });
    second = new PrismaClient({ datasourceUrl: url.href });
    await db.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    for (const migration of ['20261127220000_auth_initial', '20261128123000_auth_player_link']) {
      const sql = await readFile(new URL(`../prisma/migrations/${migration}/migration.sql`, import.meta.url), 'utf8');
      for (const part of sql.split(';').map(value => value.trim()).filter(Boolean)) await db.$executeRawUnsafe(part);
    }
    [auth, other] = await Promise.all([AuthService.create(db, config, keys), AuthService.create(second, config, keys)]);
  }, 20_000);

  afterAll(async () => {
    await second?.$disconnect();
    if (db) {
      try { await db.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
      finally { await db.$disconnect(); }
    }
  }, 20_000);

  it('creates one account for duplicate concurrent normalized usernames and stores Argon2id', async () => {
    const [first, duplicate] = await Promise.all([create('Fixture-One'), create('FIXTURE-ONE')]);
    expect(first.id).toBe(duplicate.id);
    expect([first.created, duplicate.created].sort()).toEqual([false, true]);
    const stored = await db.authPassword.findUniqueOrThrow({ where: { username: 'fixture-one' } });
    expect(stored.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/u);
    expect(stored.passwordHash.includes(fixturePassword)).toBe(false);
    expect(await db.authUser.count({ where: { id: first.id } })).toBe(1);
  });

  it('issues a portable UUID, keeps secrets out of DTOs and survives a service restart', async () => {
    const user = await create('fixture-login');
    const issued = await login('fixture-login');
    expect(issued.body.user).toEqual({ id: user.id, username: 'fixture-login', displayName: 'Synthetic test account' });
    expect(issued.body).toMatchObject({ tokenType: 'Bearer', expiresIn: 720 });
    expect(JSON.stringify(issued.body)).not.toContain(issued.refreshToken);
    const stored = await db.authRefreshToken.findUniqueOrThrow({ where: { digest: secretDigest(issued.refreshToken) } });
    expect(stored.digest).not.toBe(issued.refreshToken);
    const replacement = await AuthService.create(second, config, keys);
    await expect(replacement.me(issued.body.accessToken)).resolves.toEqual(issued.body.user);
    await expect(replacement.refresh(issued.refreshToken)).resolves.toHaveProperty('body.user.id', user.id);
  });

  it('rejects invalid, unknown and disabled users with the same login error', async () => {
    await create('fixture-disabled');
    const issued = await login('fixture-disabled');
    await maintainLocalUser(db, 'fixture-disabled', { kind: 'disable' });
    for (const result of [
      () => login('fixture-disabled'), () => login('not-present'), () => login('fixture-login', 'wrong-password'),
    ]) await expect(result()).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'Invalid username or password.' });
    await expect(auth.me(issued.body.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(auth.refresh(issued.refreshToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rotates once under concurrent use on two connections, and revokes the family on reuse', async () => {
    await create('fixture-race');
    const issued = await login('fixture-race');
    const outcomes = await Promise.allSettled([auth.refresh(issued.refreshToken), other.refresh(issued.refreshToken)]);
    const success = outcomes.find(result => result.status === 'fulfilled');
    expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.find(result => result.status === 'rejected')).toMatchObject({ reason: { code: 'UNAUTHENTICATED' } });
    expect(success?.value.refreshToken).not.toBe(issued.refreshToken);
    await expect(auth.refresh(success!.value.refreshToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(auth.me(success!.value.body.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('supports logout, repeated logout, explicit session revoke, and rejects an unknown refresh value', async () => {
    await create('fixture-logout');
    const issued = await login('fixture-logout');
    await auth.logout(issued.refreshToken);
    await auth.logout(issued.refreshToken);
    await expect(auth.refresh(issued.refreshToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(auth.me(issued.body.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(auth.refresh(newRefreshToken())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const restored = await login('fixture-logout');
    await maintainLocalUser(db, 'fixture-logout', { kind: 'revoke-sessions' });
    await expect(auth.me(restored.body.accessToken)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('enforces access, refresh idle and absolute expiration without a real wait', async () => {
    await create('fixture-expiration');
    const base = Date.now();
    let now = new Date(base);
    const timed = await AuthService.create(second, { ...config, accessSeconds: 60, idleSeconds: 120, refreshSeconds: 180 }, keys, () => now);
    const first = await timed.authenticateWithPassword('fixture-expiration', fixturePassword, '192.0.2.1');
    now = new Date(base + 80_000);
    await expect(timed.me(first.body.accessToken)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    await expect(timed.readPlayerLink(first.body.accessToken)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    await expect(timed.savePlayerLink(first.body.accessToken, { steamId: '76561197960265729', nickname: 'Synthetic' }))
      .rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    await expect(timed.deletePlayerLink(first.body.accessToken)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    const secondIssue = await timed.refresh(first.refreshToken);
    now = new Date(base + 181_000);
    await expect(timed.refresh(secondIssue.refreshToken)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    const idle = await timed.authenticateWithPassword('fixture-expiration', fixturePassword, '192.0.2.1');
    now = new Date(base + 302_000);
    await expect(timed.refresh(idle.refreshToken)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('stores one unverified link per account through updates, restarts and logout', async () => {
    const a = await create('fixture-link-a');
    const b = await create('fixture-link-b');
    const issue = await login('fixture-link-a');
    const token = issue.body.accessToken;
    const otherToken = (await login('fixture-link-b')).body.accessToken;
    const first = { steamId: '76561197960265729', nickname: 'Synthetic Alpha' };
    const replacement = { steamId: '76561197960265730', nickname: 'Synthetic New' };

    await expect(auth.readPlayerLink(token)).resolves.toMatchObject({ state: 'UNLINKED' });
    await expect(auth.savePlayerLink(token, first)).resolves.toMatchObject({
      schemaVersion: 'auth-player-link@1', state: 'LINKED', ...first, source: 'MANUAL', verificationStatus: 'UNVERIFIED',
    });
    await other.savePlayerLink(token, first);
    expect(await db.authPlayerLink.count({ where: { userId: a.id } })).toBe(1);
    await expect(auth.readPlayerLink(otherToken)).resolves.toMatchObject({ state: 'UNLINKED' });
    await auth.savePlayerLink(otherToken, { ...first, nickname: 'Independent choice' });
    await auth.savePlayerLink(token, replacement);
    const restarted = await AuthService.create(second, config, keys);
    await expect(restarted.readPlayerLink(token)).resolves.toMatchObject(replacement);
    await expect(restarted.readPlayerLink(otherToken)).resolves.toMatchObject({ ...first, nickname: 'Independent choice' });
    expect(await db.authExternalIdentity.count({ where: { userId: { in: [a.id, b.id] } } })).toBe(0);

    await auth.logout(issue.refreshToken);
    for (const result of [() => auth.readPlayerLink(token), () => auth.savePlayerLink(token, first), () => auth.deletePlayerLink(token)]) {
      await expect(result()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
    const activeAgain = (await login('fixture-link-a')).body.accessToken;
    await expect(auth.readPlayerLink(activeAgain)).resolves.toMatchObject(replacement);
    await expect(auth.deletePlayerLink(activeAgain)).resolves.toMatchObject({ state: 'UNLINKED' });
    await expect(auth.readPlayerLink(activeAgain)).resolves.toMatchObject({ state: 'UNLINKED' });
    await expect(auth.readPlayerLink(otherToken)).resolves.toMatchObject({ ...first, nickname: 'Independent choice' });
  });

  it('shares name and source login limits across connections and bounds concurrent Argon2 checks', async () => {
    const limit = { ...config, perIp: 2, perUsername: 2, argonSlots: 1 };
    const [a, b] = await Promise.all([AuthService.create(db, limit, keys), AuthService.create(second, limit, keys)]);
    for (const ip of ['192.0.2.44', '192.0.2.45']) {
      await expect(a.authenticateWithPassword('rate-target', fixturePassword, ip)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    }
    await expect(b.authenticateWithPassword('rate-target', fixturePassword, '192.0.2.46')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    for (const username of ['other-user-a', 'other-user-b']) {
      await expect(a.authenticateWithPassword(username, fixturePassword, '192.0.2.50')).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    }
    await expect(b.authenticateWithPassword('other-user-c', fixturePassword, '192.0.2.50')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    await create('fixture-parallel');
    const attempts = await Promise.allSettled([
      a.authenticateWithPassword('fixture-parallel', fixturePassword, '192.0.2.60'),
      a.authenticateWithPassword('fixture-parallel', fixturePassword, '192.0.2.61'),
    ]);
    expect(attempts.some(result => result.status === 'fulfilled')).toBe(true);
    expect(attempts.filter(result => result.status === 'rejected').every(result => result.reason.code === 'RATE_LIMITED')).toBe(true);
    const crossProcess = await Promise.all([
      auth.authenticateWithPassword('fixture-parallel', fixturePassword, '192.0.2.70'),
      other.authenticateWithPassword('fixture-parallel', fixturePassword, '192.0.2.71'),
    ]);
    expect(crossProcess[0]?.refreshToken).not.toBe(crossProcess[1]?.refreshToken);
  });
});
