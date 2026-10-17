import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const run = (args) => {
  // All arguments below are fixed, repository-owned strings.
  const result = process.platform === 'win32'
    ? spawnSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'corepack ' + args.join(' ')], { stdio: 'inherit' })
    : spawnSync('corepack', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};
run(['pnpm', 'install', '--frozen-lockfile']);
mkdirSync('node_modules/.bin', { recursive: true });
run(['enable', '--install-directory', 'node_modules/.bin', 'pnpm']);
console.log('Ready. Run npm.cmd run dev:web on Windows (npm run dev:web elsewhere). No system PATH settings were changed.');
