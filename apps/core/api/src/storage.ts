import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ArtifactError, assertNoSymlinkPath, resolveArtifactPath } from '@who-ruined/artifacts';

const configured = path.resolve(process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'));
export const dataRoot = configured;
export const dataDir = pathToFileURL(configured + path.sep);

export function safeDataPath(relativePath: string): string {
  try {
    return resolveArtifactPath(dataRoot, relativePath, true);
  } catch {
    throw new Error('Unsafe artifact path');
  }
}

export async function safeExistingDataPath(relativePath: string): Promise<string> {
  const target = safeDataPath(relativePath);
  if (target === dataRoot) return target;
  try {
    await assertNoSymlinkPath(dataRoot, target);
    return target;
  } catch (error) {
    if (error instanceof ArtifactError && error.reason === 'SYMLINK') throw new Error('SYMLINK_DATA_PATH');
    throw error;
  }
}
