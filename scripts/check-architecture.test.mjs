import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const repositoryRoot = resolve(import.meta.dirname, '..');

async function packageFixture(root, location, name, dependencies = {}) {
  const directory = join(root, location);
  await mkdir(join(directory, 'src'), { recursive: true });
  await writeFile(join(directory, 'package.json'), JSON.stringify({
    name,
    private: true,
    type: 'module',
    dependencies,
  }));
  await writeFile(join(directory, 'src', 'index.ts'), 'export const value = 1;\n');
}

async function runFixture(configure) {
  const root = join(repositoryRoot, `.architecture-check-${randomUUID()}`);
  try {
    await mkdir(join(root, 'scripts'), { recursive: true });
    await mkdir(join(root, 'apps'), { recursive: true });
    await cp(join(repositoryRoot, 'scripts', 'check-architecture.mjs'), join(root, 'scripts', 'check-architecture.mjs'));
    await cp(join(repositoryRoot, 'scripts', 'workspace-directories.mjs'), join(root, 'scripts', 'workspace-directories.mjs'));
    await packageFixture(root, 'packages/contracts', '@who-ruined/contracts');
    await packageFixture(root, 'packages/match-domain', '@who-ruined/match-domain', {
      '@who-ruined/contracts': 'workspace:*',
    });
    await configure(root);
    return spawnSync(process.execPath, [join(root, 'scripts', 'check-architecture.mjs')], {
      cwd: root,
      encoding: 'utf8',
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('architecture gate accepts imports parsed from code and ignores comment text', async () => {
  const result = await runFixture(async (root) => {
    await writeFile(join(root, 'packages/match-domain/src/index.ts'), [
      "import { value } from '@who-ruined/contracts';",
      "// import '@who-ruined/parser-adapter';",
      "export const text = \"import '@who-ruined/parser-adapter'\";",
      'export const domainValue = value;',
    ].join('\n'));
  });
  assert.equal(result.status, 0, result.stderr);
});

test('architecture gate rejects a workspace package deep import', async () => {
  const result = await runFixture(async (root) => {
    await writeFile(join(root, 'packages/match-domain/src/index.ts'),
      "import '@who-ruined/contracts/src/internal.js';\n");
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /deep import bypasses the public package entry point/u);
});

test('architecture gate rejects a relative cross-workspace import', async () => {
  const result = await runFixture(async (root) => {
    await writeFile(join(root, 'packages/match-domain/src/index.ts'),
      "import '../../contracts/src/index.js';\n");
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /relative import crosses a workspace boundary/u);
});

test('H3 entry point is limited to the offline CLI and tests', async () => {
  const result = await runFixture(async (root) => {
    await packageFixture(root, 'packages/scoring', '@who-ruined/scoring');
    await writeFile(join(root, 'packages/scoring/package.json'), JSON.stringify({ name: '@who-ruined/scoring', exports: { './h3': './dist/h3/index.js' } }));
    await packageFixture(root, 'apps/core/worker', '@who-ruined/worker', { '@who-ruined/scoring': 'workspace:*' });
    await mkdir(join(root, 'apps/core/worker/src/rating-comparison'));
    await writeFile(join(root, 'apps/core/worker/src/rating-comparison/cli.ts'), "import '@who-ruined/scoring/h3';\n");
    await writeFile(join(root, 'apps/core/worker/src/index.ts'), "import './rating-comparison/cli.js';\nimport '@who-ruined/scoring/h3';\n");
  });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.match(/H3 calculation is owned by the worker scoring pipeline/gu)?.length, 2);
  assert.doesNotMatch(result.stderr, /deep import/u);
});

test('architecture gate rejects runtime imports of test implementations', async () => {
  const result = await runFixture(async (root) => {
    await writeFile(join(root, 'packages/match-domain/src/index.ts'), "import '../test/example.js';\n");
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /runtime code depends on test implementation/u);
});

test('architecture gate rejects forbidden dependencies and manifest cycles', async () => {
  const result = await runFixture(async (root) => {
    await packageFixture(root, 'packages/parser-adapter', '@who-ruined/parser-adapter', {
      '@who-ruined/match-domain': 'workspace:*',
    });
    await writeFile(join(root, 'packages/match-domain/package.json'), JSON.stringify({
      name: '@who-ruined/match-domain',
      private: true,
      type: 'module',
      dependencies: {
        '@who-ruined/contracts': 'workspace:*',
        '@who-ruined/parser-adapter': 'workspace:*',
      },
    }));
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /forbidden production dependency/u);
  assert.match(result.stderr, /production dependency cycle/u);
});

test('architecture gate enforces nested Core and Profiles boundaries in both directions', async () => {
  const result = await runFixture(async (root) => {
    await packageFixture(root, 'apps/core/api', '@who-ruined/api');
    await packageFixture(root, 'apps/services/profiles', '@who-ruined/profiles');
    await packageFixture(root, 'packages/database', '@who-ruined/database');
    await writeFile(join(root, 'apps/core/api/src/index.ts'), "import '../../../services/profiles/src/index.js';\n");
    await writeFile(join(root, 'apps/services/profiles/src/index.ts'),
      "import '../../../core/api/src/index.js';\nimport '@who-ruined/database';\n");
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /apps\/core\/api\/src\/index.ts: relative import crosses a workspace boundary/u);
  assert.match(result.stderr, /apps\/services\/profiles\/src\/index.ts: relative import crosses a workspace boundary/u);
  assert.match(result.stderr, /Profiles must only access its own PostgreSQL client and schema/u);
});

test('architecture gate keeps Auth imports and PostgreSQL ownership separate', async () => {
  const result = await runFixture(async (root) => {
    await packageFixture(root, 'apps/core/api', '@who-ruined/api');
    await packageFixture(root, 'apps/services/profiles', '@who-ruined/profiles');
    await packageFixture(root, 'apps/services/auth', '@who-ruined/auth', { '@who-ruined/contracts': 'workspace:*' });
    await packageFixture(root, 'packages/database', '@who-ruined/database');
    await writeFile(join(root, 'apps/core/api/src/index.ts'), "import '../../../services/auth/src/index.js';\n");
    await writeFile(join(root, 'apps/services/profiles/src/index.ts'), "import '../../auth/src/index.js';\n");
    await writeFile(join(root, 'apps/services/auth/src/index.ts'), [
      "import '@who-ruined/contracts';",
      "import '@who-ruined/database';",
      "import '../../../core/prisma/generated/client/index.js';",
    ].join('\n'));
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /apps\/core\/api\/src\/index.ts: relative import crosses a workspace boundary/u);
  assert.match(result.stderr, /apps\/services\/profiles\/src\/index.ts: relative import crosses a workspace boundary/u);
  assert.equal(result.stderr.match(/Auth must only access its own PostgreSQL client and schema/gu)?.length, 2);
});

test('architecture gate rejects gateway application imports and browser upstream origins', async () => {
  const result = await runFixture(async (root) => {
    await mkdir(join(root, 'apps/gateway'));
    await writeFile(join(root, 'apps/gateway/index.ts'), "import '@who-ruined/scoring';\n");
    await packageFixture(root, 'apps/web', '@who-ruined/web');
    await writeFile(join(root, 'apps/web/src/index.ts'), [
      "fetch('/api/v1/matches');",
      "fetch('http://profiles:3001/api/v1/players/example/profile');",
      "fetch('http://auth:3002/api/v1/auth/me');",
      "fetch(`http://127.0.0.1:3000/api/v1/matches/${id}`);",
    ].join('\n'));
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Gateway is HTTP infrastructure/u);
  assert.equal(result.stderr.match(/browser API requests must use a relative path through Gateway/gu)?.length, 3);
});
