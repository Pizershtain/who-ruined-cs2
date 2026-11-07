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
