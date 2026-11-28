import { readFile } from 'node:fs/promises';
import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import { Algorithm } from '@node-rs/argon2';

export function boundedInteger(environment: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
  const raw = environment[name];
  const value = raw === undefined ? fallback : Number(raw);
  if ((raw !== undefined && !/^\d+$/u.test(raw)) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Invalid Auth configuration: ${name}`);
  }
  return value;
}

export function passwordCost(env: NodeJS.ProcessEnv) {
  return {
    algorithm: Algorithm.Argon2id,
    memoryCost: boundedInteger(env, 'AUTH_ARGON2_MEMORY_KIB', 19_456, 19_456, 65_536),
    timeCost: boundedInteger(env, 'AUTH_ARGON2_ITERATIONS', 2, 2, 8),
    parallelism: boundedInteger(env, 'AUTH_ARGON2_PARALLELISM', 1, 1, 4),
  };
}

export function readAuthConfig(env: NodeJS.ProcessEnv) {
  const mode = env.AUTH_MODE ?? 'production';
  if (mode !== 'production' && mode !== 'local-dev') throw new Error('Invalid AUTH_MODE');
  const local = mode === 'local-dev';
  const trustGateway = env.AUTH_TRUST_GATEWAY === '1';
  if (env.AUTH_TRUST_GATEWAY !== undefined && !['0', '1'].includes(env.AUTH_TRUST_GATEWAY)) throw new Error('Invalid AUTH_TRUST_GATEWAY');
  let origin: URL;
  try { origin = new URL(env.AUTH_ORIGIN ?? ''); } catch { throw new Error('Invalid AUTH_ORIGIN'); }
  if (origin.origin !== env.AUTH_ORIGIN || origin.username || origin.password
    || (local ? origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1'
      : origin.protocol !== 'https:' || !trustGateway)) {
    throw new Error('AUTH_ORIGIN must be loopback HTTP in local-dev or HTTPS behind a trusted Gateway');
  }
  if (!env.AUTH_DATABASE_URL) throw new Error('AUTH_DATABASE_URL is required');
  if (!env.AUTH_SIGNING_KEY_FILE) throw new Error('AUTH_SIGNING_KEY_FILE is required');
  const bindHost = env.AUTH_BIND_HOST ?? '127.0.0.1';
  if (!trustGateway && bindHost !== '127.0.0.1') throw new Error('Native Auth must bind to loopback');
  const refreshSeconds = boundedInteger(env, 'AUTH_REFRESH_SECONDS', 30 * 86400, 900, 90 * 86400);
  const idleSeconds = boundedInteger(env, 'AUTH_REFRESH_IDLE_SECONDS', 7 * 86400, 60, refreshSeconds);
  return {
    local, trustGateway, origin, bindHost, port: boundedInteger(env, 'AUTH_PORT', 3002, 1, 65535),
    keyFile: env.AUTH_SIGNING_KEY_FILE,
    accessSeconds: boundedInteger(env, 'AUTH_ACCESS_SECONDS', 720, 60, 900),
    refreshSeconds, idleSeconds, passwordCost: passwordCost(env),
    argonSlots: boundedInteger(env, 'AUTH_ARGON2_SLOTS', 2, 1, 2),
    perIp: boundedInteger(env, 'AUTH_LOGIN_PER_IP', 20, 1, 100),
    perUsername: boundedInteger(env, 'AUTH_LOGIN_PER_USERNAME', 6, 1, 20),
  };
}

export type AuthConfig = ReturnType<typeof readAuthConfig>;

export async function loadSigningKeys(path: string): Promise<{ privateKey: KeyObject; publicKey: KeyObject }> {
  const privateKey = createPrivateKey(await readFile(path));
  if (privateKey.asymmetricKeyType !== 'ec' || privateKey.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('Auth signing requires a P-256 private key');
  }
  return { privateKey, publicKey: createPublicKey(privateKey) };
}
