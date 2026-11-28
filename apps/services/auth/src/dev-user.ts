import { authUsernameSchema } from '@who-ruined/contracts';
import { PrismaClient } from '../generated/client/index.js';
import { createLocalUser, maintainLocalUser } from './local-users.js';
import { passwordCost } from './runtime.js';

async function readSecret(): Promise<string> {
  if (process.stdin.isTTY) throw new Error('Use the masked PowerShell helper or a protected secret input on stdin');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    length += bytes.length;
    if (length > 1026) throw new Error('Secret input is too long');
    chunks.push(bytes);
  }
  const data = Buffer.concat(chunks);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/\r?\n$/u, '');
  } finally {
    data.fill(0);
    for (const chunk of chunks) chunk.fill(0);
  }
}

async function run() {
  const target = new URL(process.env.AUTH_DATABASE_URL ?? '');
  if (process.env.AUTH_MODE !== 'local-dev' || target.username !== 'wrc_auth' || target.pathname !== '/who_ruined_auth'
    || !['auth-postgres', '127.0.0.1'].includes(target.hostname)) throw new Error('Dev user operations require the isolated dev database');
  const [action, rawName, label, ...extra] = process.argv.slice(2);
  if (!['create', 'check', 'rotate-password', 'disable', 'revoke-sessions'].includes(action ?? '')
    || !rawName || extra.length || (action === 'create' ? !label : label !== undefined)) throw new Error('Invalid command');
  const username = authUsernameSchema.parse(rawName);
  const db = new PrismaClient();
  try {
    if (action === 'check' || action === 'create') {
      const existing = await db.authPassword.findUnique({ where: { username }, select: { userId: true } });
      if (existing) {
        console.info(JSON.stringify({ id: existing.userId, username, created: false }));
      } else if (action === 'create') {
        console.info(JSON.stringify(await createLocalUser(db, username, label!, await readSecret(), passwordCost(process.env))));
      } else {
        process.exitCode = 2;
      }
      return;
    }
    if (action === 'rotate-password' || action === 'disable' || action === 'revoke-sessions') {
      const done = await maintainLocalUser(db, username, action === 'rotate-password'
        ? { kind: action, password: await readSecret(), cost: passwordCost(process.env) } : { kind: action });
      if (!done) process.exitCode = 2;
      else console.info(JSON.stringify({ username, action }));
    }
  } finally {
    await db.$disconnect();
  }
}

try {
  await run();
} catch {
  console.error('AUTH_DEV_USER_FAILED: check the dev database, command arguments and secret input requirements.');
  process.exitCode = 1;
}
