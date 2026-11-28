import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export function workspaceDirectories(root) {
  // Keep these roots aligned with pnpm-workspace.yaml. The Gateway is an
  // Nginx image and has no Node workspace manifest.
  return ['apps', 'apps/core', 'apps/services', 'packages'].flatMap((group) => {
    const groupPath = join(root, group);
    if (!existsSync(groupPath)) return [];
    return readdirSync(groupPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(groupPath, entry.name))
      .filter((directory) => existsSync(join(directory, 'package.json')));
  }).sort();
}
