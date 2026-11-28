import { existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { workspaceDirectories } from './workspace-directories.mjs';

const require = createRequire(import.meta.url);
const root = join(import.meta.dirname, '..');
const projects = ['tests'];
for (const workspace of workspaceDirectories(root)) {
  const directory = join(workspace, 'test');
  if (existsSync(directory)) projects.push(relative(root, directory));
}

const compiler = require.resolve('typescript/lib/tsc.js');
let failed = false;
for (const directory of projects) {
  const config = join(directory, 'tsconfig.json');
  if (!existsSync(join(root, config))) {
    console.error(`${config}: add a discoverable strict TypeScript project for these tests`);
    failed = true;
    continue;
  }
  const result = spawnSync(process.execPath, [compiler, '-p', config, '--pretty', 'false'], { cwd: root, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) { console.error(`${config}: test typecheck failed`); failed = true; }
}
if (failed) process.exitCode = 1;
else console.log(`Typechecked ${projects.length} configured test projects.`);
