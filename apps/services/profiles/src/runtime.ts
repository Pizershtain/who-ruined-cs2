import { PrismaClient } from '../generated/client/index.js';

export function connectToProfilesDatabase(environment: NodeJS.ProcessEnv = process.env): PrismaClient {
  const value = environment.PROFILES_DATABASE_URL;
  if (!value) throw new Error('PROFILES_DATABASE_URL_REQUIRED');
  const url = new URL(value);
  if (!['postgresql:', 'postgres:'].includes(url.protocol) || url.pathname === '/' || !url.username) {
    throw new Error('PROFILES_DATABASE_URL_INVALID');
  }
  return new PrismaClient({ datasourceUrl: value });
}

export function resolveProfilesRuntime(environment: NodeJS.ProcessEnv = process.env) {
  const origin = new URL(environment.PROFILES_CORE_URL ?? 'http://127.0.0.1:3000');
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password
    || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('PROFILES_CORE_URL_INVALID');
  const token = environment.MATCH_PUBLICATION_TOKEN;
  if (!token || !/^[a-f0-9]{64}$/u.test(token)) throw new Error('MATCH_PUBLICATION_TOKEN_INVALID');
  const port = Number(environment.PROFILES_PORT ?? '3001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PROFILES_PORT_INVALID');
  return { coreOrigin: origin, token, port, bindHost: environment.PROFILES_BIND_HOST ?? '127.0.0.1' };
}
