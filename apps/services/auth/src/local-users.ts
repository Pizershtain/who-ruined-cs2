import { hash } from '@node-rs/argon2';
import { authNewPasswordSchema, authUsernameSchema } from '@who-ruined/contracts';
import { Prisma, type PrismaClient } from '../generated/client/index.js';
import type { passwordCost } from './runtime.js';

type Cost = ReturnType<typeof passwordCost>;

export function localDisplayName(value: string): string {
  const name = value.trim().normalize('NFC');
  if (!name || name.length > 80 || /\p{C}/u.test(name)) throw new Error('Invalid display name');
  return name;
}

function checkPassword(value: string): void {
  if (!authNewPasswordSchema.safeParse(value).success) {
    throw new Error('A password must have at least 12 characters and at most 1024 UTF-8 bytes');
  }
}

export async function createLocalUser(db: PrismaClient, name: string, label: string, password: string, cost: Cost) {
  const username = authUsernameSchema.parse(name);
  const displayName = localDisplayName(label);
  const before = await db.authPassword.findUnique({ where: { username }, select: { userId: true } });
  if (before) return { id: before.userId, username, created: false };
  checkPassword(password);
  const passwordHash = await hash(password, cost);
  try {
    const row = await db.authPassword.create({
      data: { username, passwordHash, user: { create: { displayName } } }, select: { userId: true },
    });
    return { id: row.userId, username, created: true };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
    const existing = await db.authPassword.findUniqueOrThrow({ where: { username }, select: { userId: true } });
    return { id: existing.userId, username, created: false };
  }
}

export async function maintainLocalUser(
  db: PrismaClient, name: string,
  action: { kind: 'rotate-password'; password: string; cost: Cost } | { kind: 'disable' | 'revoke-sessions' },
) {
  const username = authUsernameSchema.parse(name);
  if (action.kind === 'rotate-password') checkPassword(action.password);
  const passwordHash = action.kind === 'rotate-password' ? await hash(action.password, action.cost) : null;
  return db.$transaction(async tx => {
    const row = await tx.authPassword.findUnique({ where: { username }, select: { userId: true } });
    if (!row) return false;
    await tx.$queryRaw`SELECT id FROM "AuthUser" WHERE id = ${row.userId}::uuid FOR UPDATE`;
    if (action.kind === 'disable') await tx.authUser.update({ where: { id: row.userId }, data: { status: 'DISABLED' } });
    if (passwordHash) await tx.authPassword.update({ where: { userId: row.userId }, data: { passwordHash } });
    await tx.authSession.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return true;
  });
}
