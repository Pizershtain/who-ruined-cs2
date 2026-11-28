import { ArtifactError, FileArtifactStore } from '@who-ruined/artifacts';
import { resolveApiRuntimeConfig } from './runtime-config.js';
import { dataRoot } from './storage.js';

export class BoundedGzipError extends Error {
  constructor(public readonly reason: 'MISSING'|'NOT_FILE'|'COMPRESSED_LIMIT'|'CHECKSUM'|'DECOMPRESSED_LIMIT'|'DEPTH'|'INVALID') {
    super(`BOUNDED_GZIP_${reason}`);
  }
}

function compatibilityError(error: ArtifactError): BoundedGzipError {
  switch (error.reason) {
    case 'MISSING':
    case 'NOT_FILE':
    case 'COMPRESSED_LIMIT':
    case 'CHECKSUM':
    case 'DECOMPRESSED_LIMIT':
    case 'DEPTH':
      return new BoundedGzipError(error.reason);
    default:
      return new BoundedGzipError('INVALID');
  }
}

export async function readBoundedGzipJson(relativePath: string, expectedSha256?: string): Promise<unknown> {
  const config = resolveApiRuntimeConfig();
  const store = new FileArtifactStore(dataRoot, {
    compressedBytes: config.maxResultCompressedBytes,
    decompressedBytes: config.maxResultJsonBytes,
    jsonDepth: config.maxResultJsonDepth,
  });
  try {
    return await store.readGzipJson(relativePath, expectedSha256);
  } catch (error) {
    if (!(error instanceof ArtifactError)) throw error;
    throw compatibilityError(error);
  }
}

