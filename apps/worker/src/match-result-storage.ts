import { rm } from 'node:fs/promises';
import type { CanonicalMatchResult } from '@who-ruined/contracts';
import {
  FileArtifactStore,
  canonicalMatchResultRelativePath,
  encodeCanonicalMatchResult as encodeArtifact,
  readCanonicalMatchResultArtifact,
} from '@who-ruined/artifacts';
import { assertNoSymlinkComponents, publishImmutableBytes, resolveDataPath } from './storage.js';
import { resolveWorkerRuntimeConfig } from './runtime-config.js';

export type PublishedMatchResult = { relativePath: string; sha256: string; bytes: number; publication: 'CREATED'|'REUSED' };

export async function encodeCanonicalMatchResult(value: CanonicalMatchResult): Promise<{ bytes: Buffer; sha256: string }> {
  const config = resolveWorkerRuntimeConfig();
  return encodeArtifact(value, {
    compressedBytes: config.maxResultCompressedBytes,
    decompressedBytes: config.maxResultJsonBytes,
    jsonDepth: config.maxResultJsonDepth,
  });
}

export async function publishCanonicalMatchResult(
  dataRoot: string,
  value: CanonicalMatchResult,
  beforeCommit?: () => Promise<void>
): Promise<PublishedMatchResult> {
  const encoded = await encodeCanonicalMatchResult(value);
  const relativePath = canonicalMatchResultRelativePath(value.artifact.match.matchId, encoded.sha256);
  const target = resolveDataPath(dataRoot, relativePath);
  await assertNoSymlinkComponents(dataRoot, target);
  const publication = await publishImmutableBytes(dataRoot, target, encoded.bytes, beforeCommit);
  const verified = await readCanonicalMatchResult(dataRoot, relativePath, encoded.sha256);
  if (verified.artifact.match.matchId !== value.artifact.match.matchId) throw new Error('MATCH_RESULT_VERIFY_FAILED');
  return { relativePath, sha256: encoded.sha256, bytes: encoded.bytes.byteLength, publication };
}

export async function readCanonicalMatchResult(dataRoot: string, relativePath: string, expectedSha256?: string): Promise<CanonicalMatchResult> {
  const limits = resolveWorkerRuntimeConfig();
  try {
    const store = new FileArtifactStore(dataRoot, {
      compressedBytes: limits.maxResultCompressedBytes,
      decompressedBytes: limits.maxResultJsonBytes,
      jsonDepth: limits.maxResultJsonDepth,
    });
    return await readCanonicalMatchResultArtifact(store, relativePath, expectedSha256);
  } catch (error) {
    throw new Error('REPORT_CORRUPT', { cause: error });
  }
}

export async function removeOwnedResult(dataRoot: string, relativePath: string): Promise<void> {
  const target = resolveDataPath(dataRoot, relativePath);
  await assertNoSymlinkComponents(dataRoot, target);
  await rm(target, { force: true });
}
