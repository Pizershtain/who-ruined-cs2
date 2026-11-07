import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  assertSafePostgresTestTarget,
  environmentForGate,
  GateBlockedError,
  runCommands,
  verifyGoldenFixtures,
} from './quality-gate.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');

test('command runner propagates a nested non-zero exit code', () => {
  assert.throws(() => runCommands([{
    label: 'deliberate failure',
    executable: process.execPath,
    arguments: ['-e', 'process.exit(7)'],
  }], { stdio: 'pipe' }), (error) => error.exitCode === 7);
});

test('PostgreSQL preflight blocks missing and production-like targets', () => {
  assert.throws(() => assertSafePostgresTestTarget(undefined), GateBlockedError);
  assert.throws(
    () => assertSafePostgresTestTarget('postgresql://owner:secret@db.example.com/who_ruined_cs2'),
    /local PostgreSQL database/u,
  );
  assert.doesNotThrow(() => assertSafePostgresTestTarget(
    'postgresql://tester:secret@127.0.0.1:54329/wrc_test?schema=public',
  ));
});

test('fast gate removes PostgreSQL integration opt-in while integration preserves it', () => {
  const testUrl = 'postgresql://tester:secret@127.0.0.1:54329/wrc_test?schema=public';
  const inherited = {
    PATH: process.env.PATH,
    TEST_DATABASE_URL: testUrl,
    REQUIRE_POSTGRES_INTEGRATION: '1',
  };

  const fast = environmentForGate('fast', inherited);
  assert.equal(fast.TEST_DATABASE_URL, undefined);
  assert.equal(fast.REQUIRE_POSTGRES_INTEGRATION, undefined);
  assert.equal(fast.PATH, inherited.PATH);

  const integration = environmentForGate('integration', inherited);
  assert.equal(integration.DATABASE_URL, testUrl);
  assert.equal(integration.TEST_DATABASE_URL, testUrl);
  assert.equal(integration.REQUIRE_POSTGRES_INTEGRATION, '1');
});

test('golden preflight distinguishes missing fixtures from a SHA failure', async () => {
  const root = join(repositoryRoot, `.quality-gate-${randomUUID()}`);
  try {
    await mkdir(root, { recursive: true });
    const demo = join(root, 'fixture.dem');
    const info = join(root, 'fixture.dem.info');
    const manifest = join(root, 'manifest.json');
    await writeFile(demo, 'demo-bytes');
    await writeFile(info, 'info-bytes');
    const sha256 = createHash('sha256').update('demo-bytes').digest('hex');
    await writeFile(manifest, JSON.stringify({ fixtures: [{
      id: 'fixture', envPrefix: 'FIXTURE', sha256,
    }] }));

    await assert.rejects(() => verifyGoldenFixtures(manifest, {}), GateBlockedError);
    await assert.rejects(() => verifyGoldenFixtures(manifest, {
      GOLDEN_FIXTURE_DEMO_PATH: join(root, 'missing.dem'),
      GOLDEN_FIXTURE_INFO_PATH: info,
    }), GateBlockedError);
    await assert.doesNotReject(() => verifyGoldenFixtures(manifest, {
      GOLDEN_FIXTURE_DEMO_PATH: demo,
      GOLDEN_FIXTURE_INFO_PATH: info,
    }));
    await writeFile(demo, 'changed');
    await assert.rejects(() => verifyGoldenFixtures(manifest, {
      GOLDEN_FIXTURE_DEMO_PATH: demo,
      GOLDEN_FIXTURE_INFO_PATH: info,
    }), /SHA-256 mismatch/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('toolchain returns non-zero for a type error and a failing unit test', async () => {
  const root = join(repositoryRoot, `.quality-gate-${randomUUID()}`);
  try {
    await mkdir(root, { recursive: true });
    const typeError = join(root, 'type-error.ts');
    const failingTest = join(root, 'deliberate.test.ts');
    await writeFile(typeError, "const value: string = 1;\nvoid value;\n");
    await writeFile(failingTest, "import { expect, it } from 'vitest';\nit('fails deliberately', () => expect(1).toBe(2));\n");

    const typeResult = spawnSync(process.execPath, [
      join(repositoryRoot, 'node_modules/typescript/bin/tsc'),
      '--noEmit', '--strict', '--skipLibCheck', typeError,
    ], { cwd: repositoryRoot, encoding: 'utf8' });
    const unitResult = spawnSync(process.execPath, [
      join(repositoryRoot, 'node_modules/vitest/vitest.mjs'),
      'run', failingTest,
    ], { cwd: repositoryRoot, encoding: 'utf8' });
    assert.equal(typeResult.error, undefined);
    assert.equal(unitResult.error, undefined);
    assert.equal(typeof typeResult.status, 'number');
    assert.equal(typeof unitResult.status, 'number');
    assert.notEqual(typeResult.status, 0, 'type error unexpectedly passed');
    assert.notEqual(unitResult.status, 0, 'failing unit test unexpectedly passed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
