import { createHash } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { canonicalMatchResultSchema, type CanonicalMatchResult } from '@who-ruined/contracts';
import { assertNoSymlinkComponents, publishImmutableBytes, resolveDataPath } from './storage.js';
import { resolveWorkerRuntimeConfig } from './runtime-config.js';

const zip = promisify(gzip);
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

export type PublishedMatchResult = { relativePath: string; sha256: string; bytes: number; publication: 'CREATED'|'REUSED' };

function assertJsonDepth(text: string, maximum: number): void {
  let depth = 0; let inString = false; let escaped = false;
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{' || character === '[') { depth += 1; if (depth > maximum) throw new Error('REPORT_CORRUPT'); }
    else if (character === '}' || character === ']') depth -= 1;
    if (depth < 0) throw new Error('REPORT_CORRUPT');
  }
  if (inString || depth !== 0) throw new Error('REPORT_CORRUPT');
}

function boundedUnzip(bytes: Buffer, maximum: number): Promise<Buffer> {
  return new Promise((resolve, reject) => gunzip(bytes, { maxOutputLength: maximum }, (error, output) => error ? reject(error) : resolve(output)));
}

export async function encodeCanonicalMatchResult(value: CanonicalMatchResult): Promise<{ bytes: Buffer; sha256: string }> {
  const parsed = canonicalMatchResultSchema.parse(value);
  const bytes = await zip(Buffer.from(JSON.stringify(parsed)));
  return { bytes, sha256: sha256(bytes) };
}

export async function publishCanonicalMatchResult(
  dataRoot: string,
  value: CanonicalMatchResult,
  beforeCommit?: () => Promise<void>
): Promise<PublishedMatchResult> {
  const encoded = await encodeCanonicalMatchResult(value);
  const relativePath = `results/${value.artifact.match.matchId}/${encoded.sha256}.match-result@1.json.gz`;
  const target = resolveDataPath(dataRoot, relativePath);
  await assertNoSymlinkComponents(dataRoot, target);
  const publication = await publishImmutableBytes(target, encoded.bytes, beforeCommit);
  const verified = await readCanonicalMatchResult(dataRoot, relativePath, encoded.sha256);
  if (verified.artifact.match.matchId !== value.artifact.match.matchId) throw new Error('MATCH_RESULT_VERIFY_FAILED');
  return { relativePath, sha256: encoded.sha256, bytes: encoded.bytes.byteLength, publication };
}

export async function readCanonicalMatchResult(dataRoot: string, relativePath: string, expectedSha256?: string): Promise<CanonicalMatchResult> {
  const target = resolveDataPath(dataRoot, relativePath);
  await assertNoSymlinkComponents(dataRoot, target);
  const limits = resolveWorkerRuntimeConfig();
  const metadata = await stat(target);
  if (!metadata.isFile() || metadata.size > limits.maxResultCompressedBytes) throw new Error('REPORT_CORRUPT');
  const bytes = await readFile(target);
  if (bytes.byteLength > limits.maxResultCompressedBytes) throw new Error('REPORT_CORRUPT');
  if (expectedSha256 && sha256(bytes) !== expectedSha256) throw new Error('REPORT_CORRUPT');
  try {
    const text = (await boundedUnzip(bytes, limits.maxResultJsonBytes)).toString('utf8');
    assertJsonDepth(text, limits.maxResultJsonDepth);
    return canonicalMatchResultSchema.parse(JSON.parse(text) as unknown);
  } catch (error) {
    throw new Error('REPORT_CORRUPT', { cause: error });
  }
}

export async function removeOwnedResult(dataRoot: string, relativePath: string): Promise<void> {
  const target = resolveDataPath(dataRoot, relativePath);
  await assertNoSymlinkComponents(dataRoot, target);
  await rm(target, { force: true });
}
