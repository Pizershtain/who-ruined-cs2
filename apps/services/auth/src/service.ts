import { hash, verify } from '@node-rs/argon2';
import { authUsernameSchema, type AuthPlayerLink, type AuthPlayerLinkInput, type AuthRegistrationInput, type AuthTokensDto, type AuthUserDto } from '@who-ruined/contracts';
import { Prisma, type PrismaClient } from '../generated/client/index.js';
import { AuthFault } from './fault.js';
import type { AuthConfig } from './runtime.js';
import { newRefreshToken, secretDigest, signAccess, tokenKeyId, verifyAccess } from './tokens.js';
import type { KeyObject } from 'node:crypto';

const userInclude = { password: { select: { username: true } } } as const;
type User = Prisma.AuthUserGetPayload<{ include: typeof userInclude }>;
type Session = Pick<Prisma.AuthSessionGetPayload<object>, 'id' | 'expiresAt' | 'idleExpiresAt' | 'revokedAt'>;
type Keys = { privateKey: KeyObject; publicKey: KeyObject };
const inSeconds = (date: Date) => Math.floor(date.getTime() / 1000);
const later = (date: Date, seconds: number) => new Date(date.getTime() + seconds * 1000);
const usable = (session: Session, now: Date) => !session.revokedAt && session.expiresAt > now && session.idleExpiresAt > now;

function publicUser(user: User): AuthUserDto {
  return { id: user.id, displayName: user.displayName, username: user.password?.username ?? null };
}

const unlinkedPlayer = { schemaVersion: 'auth-player-link@1', state: 'UNLINKED' } as const;
const playerLinkFields = { steamId: true, nickname: true, source: true, verificationStatus: true } as const;
const registrationsPerIpPerMinute = 5;

export type Issued = { body: AuthTokensDto; refreshToken: string; cookieUntil: Date };

async function countAttempt(tx: Prisma.TransactionClient, key: string) {
  const [row] = await tx.$queryRaw<Array<{ attempts: number; retryAfter: number }>>`
    INSERT INTO "AuthLoginLimit" AS limits ("key", "attempts", "expiresAt")
    VALUES (${secretDigest(key)}, 1, date_trunc('minute', now()) + interval '1 minute')
    ON CONFLICT ("key") DO UPDATE SET
      "attempts" = CASE WHEN limits."expiresAt" < EXCLUDED."expiresAt" THEN 1 ELSE LEAST(limits."attempts" + 1, 101) END,
      "expiresAt" = GREATEST(limits."expiresAt", EXCLUDED."expiresAt")
    RETURNING "attempts", GREATEST(1, CEIL(extract(epoch from ("expiresAt" - now()))))::int AS "retryAfter"`;
  if (!row) throw new AuthFault('AUTH_UNAVAILABLE');
  return row;
}

export class AuthService {
  private argonInUse = 0;
  private readonly issuer: string;

  private constructor(
    private readonly db: PrismaClient, private readonly config: AuthConfig, private readonly keys: Keys,
    private readonly kid: string, private readonly dummyHash: string, private readonly now: () => Date,
  ) {
    this.issuer = new URL('/api/v1/auth', config.origin).href;
  }

  static async create(db: PrismaClient, config: AuthConfig, keys: Keys, now = () => new Date()): Promise<AuthService> {
    return new AuthService(db, config, keys, await tokenKeyId(keys.publicKey), await hash(newRefreshToken(), config.passwordCost), now);
  }

  async authenticateWithPassword(username: string, password: string, ip: string): Promise<Issued> {
    const limit = await this.db.$transaction(async tx => {
      const source = await countAttempt(tx, 'ip:' + ip);
      if (source.attempts > this.config.perIp) return source.retryAfter;
      const account = await countAttempt(tx, 'username:' + username);
      return account.attempts > this.config.perUsername ? account.retryAfter : null;
    });
    if (limit !== null) throw new AuthFault('RATE_LIMITED', limit);
    if (this.argonInUse >= this.config.argonSlots) throw new AuthFault('RATE_LIMITED', 1);
    this.argonInUse++;
    try {
      const credential = await this.db.authPassword.findUnique({ where: { username }, include: { user: true } });
      const valid = await verify(credential?.passwordHash ?? this.dummyHash, password);
      if (!valid || credential?.user.status !== 'ACTIVE') throw new AuthFault('INVALID_CREDENTIALS');
      return await this.issueTokens(credential.userId, credential.passwordHash);
    } finally {
      this.argonInUse--;
    }
  }

  async register(input: AuthRegistrationInput, ip: string): Promise<Issued> {
    const source = await countAttempt(this.db, 'register:ip:' + ip);
    if (source.attempts > Math.min(registrationsPerIpPerMinute, this.config.perIp)) {
      throw new AuthFault('RATE_LIMITED', source.retryAfter);
    }
    if (this.argonInUse >= this.config.argonSlots) throw new AuthFault('RATE_LIMITED', 1);
    this.argonInUse++;
    try {
      const username = authUsernameSchema.parse(input.username);
      const passwordHash = await hash(input.password, this.config.passwordCost);
      const steamId = input.steamId;
      return await this.db.$transaction(async tx => {
        const user = await tx.authUser.create({
          data: {
            displayName: input.username,
            password: { create: { username, passwordHash } },
            ...(steamId ? { playerLink: { create: { steamId, nickname: input.username } } } : {}),
          },
          include: userInclude,
        });
        return this.startSession(tx, user);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
        && Array.isArray(error.meta?.target) && error.meta.target.includes('username')) {
        throw new AuthFault('USERNAME_TAKEN');
      }
      throw error;
    } finally {
      this.argonInUse--;
    }
  }

  // A trusted authentication method supplies a verified UUID. The optional
  // password-generation check closes a race with operator password changes.
  private issueTokens(userId: string, passwordHash?: string): Promise<Issued> {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "AuthUser" WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.authUser.findUnique({ where: { id: userId }, include: userInclude });
      if (!user || user.status !== 'ACTIVE') throw new AuthFault('INVALID_CREDENTIALS');
      if (passwordHash !== undefined) {
        const current = await tx.authPassword.findUnique({ where: { userId }, select: { passwordHash: true } });
        if (current?.passwordHash !== passwordHash) throw new AuthFault('INVALID_CREDENTIALS');
      }
      return this.startSession(tx, user);
    });
  }

  private async startSession(tx: Prisma.TransactionClient, user: User): Promise<Issued> {
    const now = this.now();
    const session = await tx.authSession.create({ data: {
      userId: user.id, expiresAt: later(now, this.config.refreshSeconds), idleExpiresAt: later(now, this.config.idleSeconds),
    } });
    return this.mint(tx, user, session, now);
  }

  private async mint(tx: Prisma.TransactionClient, user: User, session: Session, now: Date): Promise<Issued> {
    const refreshToken = newRefreshToken();
    await tx.authRefreshToken.create({ data: { digest: secretDigest(refreshToken), sessionId: session.id } });
    const issued = inSeconds(now);
    const expires = Math.min(issued + this.config.accessSeconds, inSeconds(session.expiresAt), inSeconds(session.idleExpiresAt));
    if (expires <= issued) throw new AuthFault('SESSION_EXPIRED');
    const accessToken = await signAccess(this.keys.privateKey, this.issuer, this.kid, user.id, session.id, issued, expires);
    return {
      body: { accessToken, tokenType: 'Bearer', expiresIn: expires - issued, user: publicUser(user) },
      refreshToken, cookieUntil: session.idleExpiresAt,
    };
  }

  private async lockRefresh(tx: Prisma.TransactionClient, digest: string) {
    const first = await tx.authRefreshToken.findUnique({ where: { digest }, select: { sessionId: true } });
    if (!first) return null;
    await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id = ${first.sessionId}::uuid FOR UPDATE`;
    return tx.authRefreshToken.findUnique({
      where: { digest }, include: { session: { include: { user: { include: userInclude } } } },
    });
  }

  async refresh(refreshToken: string): Promise<Issued> {
    const result = await this.db.$transaction(async tx => {
      const row = await this.lockRefresh(tx, secretDigest(refreshToken));
      const now = this.now();
      if (!row || row.session.revokedAt || row.session.user.status !== 'ACTIVE') return 'UNAUTHENTICATED' as const;
      if (!usable(row.session, now)) return 'SESSION_EXPIRED' as const;
      if (row.usedAt) {
        await tx.authSession.update({ where: { id: row.sessionId }, data: { revokedAt: now } });
        return 'UNAUTHENTICATED' as const;
      }
      await tx.authRefreshToken.update({ where: { digest: row.digest }, data: { usedAt: now } });
      const idleExpiresAt = new Date(Math.min(later(now, this.config.idleSeconds).getTime(), row.session.expiresAt.getTime()));
      const renewed = await tx.authSession.update({ where: { id: row.sessionId }, data: { idleExpiresAt } });
      return this.mint(tx, row.session.user, renewed, now);
    });
    if (typeof result === 'string') throw new AuthFault(result);
    return result;
  }

  async logout(refreshToken: string | null): Promise<void> {
    if (!refreshToken) return;
    await this.db.$transaction(async tx => {
      const row = await this.lockRefresh(tx, secretDigest(refreshToken));
      if (row && !row.session.revokedAt) {
        await tx.authSession.update({ where: { id: row.sessionId }, data: { revokedAt: this.now() } });
      }
    });
  }

  private async activeSession(accessToken: string, tx?: Prisma.TransactionClient) {
    const claims = await verifyAccess(accessToken, this.keys.publicKey, this.issuer, this.kid, this.now());
    if (tx) {
      // Take the user lock first, matching account disable and password rotation.
      await tx.$queryRaw`SELECT id FROM "AuthUser" WHERE id = ${claims.sub}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM "AuthSession" WHERE id = ${claims.sid}::uuid AND "userId" = ${claims.sub}::uuid FOR SHARE`;
    }
    const session = await (tx ?? this.db).authSession.findUnique({
      where: { id: claims.sid }, include: { user: { include: userInclude } },
    });
    if (!session || session.userId !== claims.sub || session.user.status !== 'ACTIVE' || session.revokedAt) {
      throw new AuthFault('UNAUTHENTICATED');
    }
    const now = this.now();
    if (!usable(session, now) || claims.exp <= inSeconds(now)) throw new AuthFault('SESSION_EXPIRED');
    return session;
  }

  async me(accessToken: string): Promise<AuthUserDto> {
    return publicUser((await this.activeSession(accessToken)).user);
  }

  async readPlayerLink(accessToken: string): Promise<AuthPlayerLink> {
    const { userId } = await this.activeSession(accessToken);
    const link = await this.db.authPlayerLink.findUnique({ where: { userId }, select: playerLinkFields });
    return link ? { schemaVersion: 'auth-player-link@1', state: 'LINKED', ...link } : unlinkedPlayer;
  }

  savePlayerLink(accessToken: string, input: AuthPlayerLinkInput): Promise<AuthPlayerLink> {
    return this.db.$transaction(async tx => {
      const { userId } = await this.activeSession(accessToken, tx);
      const link = await tx.authPlayerLink.upsert({
        where: { userId }, create: { userId, steamId: input.steamId, nickname: input.nickname },
        update: { steamId: input.steamId, nickname: input.nickname }, select: playerLinkFields,
      });
      return { schemaVersion: 'auth-player-link@1', state: 'LINKED', ...link };
    });
  }

  deletePlayerLink(accessToken: string): Promise<AuthPlayerLink> {
    return this.db.$transaction(async tx => {
      const { userId } = await this.activeSession(accessToken, tx);
      await tx.authPlayerLink.deleteMany({ where: { userId, source: 'MANUAL' } });
      return unlinkedPlayer;
    });
  }

  async prune(): Promise<void> {
    // Bounded batches. A used refresh row stays available for replay detection
    // until its family passes its absolute expiry.
    await this.db.$executeRaw`DELETE FROM "AuthLoginLimit" WHERE "key" IN (
      SELECT "key" FROM "AuthLoginLimit" WHERE "expiresAt" <= now() ORDER BY "expiresAt" LIMIT 200
    ) AND "expiresAt" <= now()`;
    await this.db.$executeRaw`DELETE FROM "AuthSession" WHERE id IN (
      SELECT id FROM "AuthSession" WHERE "expiresAt" <= now() ORDER BY "expiresAt" LIMIT 200
    )`;
  }
}
