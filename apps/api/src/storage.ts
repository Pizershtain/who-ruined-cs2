import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lstat } from 'node:fs/promises';

const configured = path.resolve(process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'));
export const dataRoot = configured;
export const dataDir = pathToFileURL(configured + path.sep);

export function safeDataPath(relativePath: string): string {
  const resolved = path.resolve(dataRoot, relativePath);
  const prefix = dataRoot.endsWith(path.sep) ? dataRoot : dataRoot + path.sep;
  if (resolved !== dataRoot && !resolved.startsWith(prefix)) throw new Error('Unsafe artifact path');
  return resolved;
}

export async function safeExistingDataPath(relativePath: string): Promise<string> {
  const target = safeDataPath(relativePath);
  const relative = path.relative(dataRoot, target);
  let current = dataRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('SYMLINK_DATA_PATH');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return target;
      throw error;
    }
  }
  return target;
}
