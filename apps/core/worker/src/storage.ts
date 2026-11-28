import path from 'node:path';
import {
  ArtifactError,
  FileArtifactStore,
  assertNoSymlinkPath,
  resolveArtifactPath,
} from '@who-ruined/artifacts';

export function resolveDataPath(dataRoot: string, relativePath: string): string {
  try {
    return resolveArtifactPath(dataRoot, relativePath);
  } catch {
    throw new Error('Unsafe artifact path');
  }
}

export async function assertNoSymlinkComponents(dataRoot: string, target: string): Promise<void> {
  try {
    await assertNoSymlinkPath(dataRoot, target);
  } catch (error) {
    if (error instanceof ArtifactError && error.reason === 'SYMLINK') throw new Error('SYMLINK_ARTIFACT_PATH');
    if (error instanceof ArtifactError && error.reason === 'UNSAFE_PATH') throw new Error('Unsafe artifact path');
    throw error;
  }
}

export async function publishImmutableBytes(
  dataRoot: string,
  target: string,
  bytes: Buffer,
  beforeCommit?: () => Promise<void>
): Promise<'CREATED' | 'REUSED'> {
  try {
    const relativePath = path.relative(path.resolve(dataRoot), path.resolve(target));
    const store = new FileArtifactStore(dataRoot, {
      compressedBytes: Number.MAX_SAFE_INTEGER,
      decompressedBytes: Number.MAX_SAFE_INTEGER,
      jsonDepth: Number.MAX_SAFE_INTEGER,
    });
    return (await store.publishImmutable(relativePath, bytes, beforeCommit)).publication;
  } catch (error) {
    if (error instanceof ArtifactError && error.reason === 'IMMUTABLE_CONFLICT') {
      throw new Error('IMMUTABLE_ARTIFACT_CONFLICT');
    }
    throw error;
  }
}
