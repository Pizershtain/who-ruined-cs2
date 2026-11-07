import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { pathToFileURL } from 'node:url';

export class GateBlockedError extends Error {}

const allowedTestHosts = new Set(['127.0.0.1', 'localhost', '::1', 'postgres']);

export function assertSafePostgresTestTarget(value) {
  if (!value) throw new GateBlockedError('PostgreSQL integration BLOCKED: TEST_DATABASE_URL is required.');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid URL.');
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//u, ''));
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !allowedTestHosts.has(url.hostname)
    || !/(?:^|[_-])test(?:$|[_-])/iu.test(database)) {
    throw new Error('TEST_DATABASE_URL must target a local PostgreSQL database whose name contains a standalone "test" segment.');
  }
  return url;
}

function goldenPaths(fixture, environment) {
  const legacyOffice = fixture.envPrefix === 'OFFICE';
  return {
    demo: environment[`GOLDEN_${fixture.envPrefix}_DEMO_PATH`]
      ?? (legacyOffice ? environment.GOLDEN_DEMO_PATH : undefined),
    info: environment[`GOLDEN_${fixture.envPrefix}_INFO_PATH`]
      ?? (legacyOffice ? environment.GOLDEN_INFO_PATH : undefined),
  };
}

export async function verifyGoldenFixtures(manifestPath, environment = process.env) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const missing = [];
  for (const fixture of manifest.fixtures ?? []) {
    const paths = goldenPaths(fixture, environment);
    if (!paths.demo || !paths.info) {
      missing.push(fixture.id);
      continue;
    }
    let demo;
    let info;
    try {
      [demo, info] = await Promise.all([readFile(paths.demo), readFile(paths.info)]);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        missing.push(fixture.id);
        continue;
      }
      throw error;
    }
    if (info.length === 0) throw new Error(`Golden fixture ${fixture.id} has an empty .info sidecar.`);
    const actual = createHash('sha256').update(demo).digest('hex');
    if (actual !== fixture.sha256) {
      throw new Error(`Golden fixture ${fixture.id} SHA-256 mismatch: expected ${fixture.sha256}, received ${actual}.`);
    }
  }
  if (missing.length > 0) {
    throw new GateBlockedError(`Golden verification BLOCKED: ${missing.length} fixture(s) unavailable (${missing.join(', ')}).`);
  }
  if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0) {
    throw new Error('Golden manifest contains no fixtures.');
  }
  return manifest.fixtures.length;
}

export function runCommands(commands, options = {}) {
  const baseEnvironment = options.environment ?? process.env;
  for (const command of commands) {
    const result = spawnSync(command.executable, command.arguments, {
      cwd: options.cwd,
      env: { ...baseEnvironment, ...command.environment },
      stdio: options.stdio ?? 'inherit',
      encoding: options.stdio === 'pipe' ? 'utf8' : undefined,
      shell: command.shell ?? false,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const error = new Error(`${command.label} failed with exit code ${result.status ?? 'unknown'}.`);
      error.exitCode = result.status ?? 1;
      error.stdout = result.stdout;
      error.stderr = result.stderr;
      throw error;
    }
  }
}

export function environmentForGate(name, environment = process.env) {
  const result = { ...environment };
  if (name === 'fast') {
    delete result.TEST_DATABASE_URL;
    delete result.REQUIRE_POSTGRES_INTEGRATION;
    return result;
  }
  if (name === 'integration') {
    const testUrl = environment.TEST_DATABASE_URL;
    assertSafePostgresTestTarget(testUrl);
    result.DATABASE_URL = testUrl;
    result.TEST_DATABASE_URL = testUrl;
    result.REQUIRE_POSTGRES_INTEGRATION = '1';
    return result;
  }
  return result;
}

const repositoryRoot = resolve(import.meta.dirname, '..');
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const step = (label, executable, ...args) => ({ label, executable, arguments: args });
const pnpmStep = (label, ...args) => ({
  ...step(label, pnpm, ...args),
  shell: process.platform === 'win32',
});

async function runGate(name) {
  if (name === 'fast') {
    runCommands([
      pnpmStep('architecture boundaries', 'architecture:check'),
      pnpmStep('quality gate regression tests', 'quality:guards'),
      pnpmStep('lint', 'lint', '--force'),
      pnpmStep('typecheck', 'typecheck', '--force'),
      pnpmStep('package and frontend tests', 'test:packages', '--force'),
      pnpmStep('build', 'build', '--force'),
      pnpmStep('localization consistency', 'i18n:check'),
      pnpmStep('design contrast', 'design:contrast'),
    ], { cwd: repositoryRoot, environment: environmentForGate('fast') });
    return;
  }
  if (name === 'integration') {
    runCommands([
      pnpmStep('Prisma migrate deploy', 'exec', 'prisma', 'migrate', 'deploy'),
      pnpmStep('Prisma migrate status', 'exec', 'prisma', 'migrate', 'status'),
      pnpmStep('required PostgreSQL integration tests', 'test:postgres', '--force'),
    ], { cwd: repositoryRoot, environment: environmentForGate('integration') });
    return;
  }
  if (name === 'golden') {
    try {
      loadEnvFile(resolve(repositoryRoot, 'tests/golden/.env.local'));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const count = await verifyGoldenFixtures(resolve(repositoryRoot, 'tests/golden/manifest.json'));
    console.log(`Golden preflight passed for ${count} fixture(s).`);
    runCommands([
      pnpmStep('native golden reconciliation', 'test:golden'),
    ], { cwd: repositoryRoot });
    return;
  }
  throw new Error('Usage: node scripts/quality-gate.mjs <fast|integration|golden>');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await runGate(process.argv[2]);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = error instanceof GateBlockedError ? 2 : (error?.exitCode ?? 1);
  }
}
