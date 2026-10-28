import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { gunzip } from 'node:zlib';
import { resolveApiRuntimeConfig } from './runtime-config.js';
import { safeExistingDataPath } from './storage.js';

export class BoundedGzipError extends Error {
  constructor(public readonly reason: 'MISSING'|'NOT_FILE'|'COMPRESSED_LIMIT'|'CHECKSUM'|'DECOMPRESSED_LIMIT'|'DEPTH'|'INVALID') {
    super(`BOUNDED_GZIP_${reason}`);
  }
}

function assertJsonDepth(text: string, maximum: number): void {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const character of text) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{' || character === '[') {
      depth += 1;
      if (depth > maximum) throw new BoundedGzipError('DEPTH');
    } else if (character === '}' || character === ']') depth -= 1;
    if (depth < 0) throw new BoundedGzipError('INVALID');
  }
  if (inString || depth !== 0) throw new BoundedGzipError('INVALID');
}

function boundedGunzip(bytes: Buffer, maximum: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    gunzip(bytes, { maxOutputLength: maximum }, (error, output) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException).code;
        reject(new BoundedGzipError(code === 'ERR_BUFFER_TOO_LARGE' ? 'DECOMPRESSED_LIMIT' : 'INVALID'));
      } else resolve(output);
    });
  });
}

export async function readBoundedGzipJson(relativePath: string, expectedSha256?: string): Promise<unknown> {
  const config = resolveApiRuntimeConfig();
  let target: string;
  try { target = await safeExistingDataPath(relativePath); }
  catch { throw new BoundedGzipError('INVALID'); }
  let metadata;
  try { metadata = await stat(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BoundedGzipError('MISSING');
    throw new BoundedGzipError('INVALID');
  }
  if (!metadata.isFile()) throw new BoundedGzipError('NOT_FILE');
  if (metadata.size > config.maxResultCompressedBytes) throw new BoundedGzipError('COMPRESSED_LIMIT');
  let compressed: Buffer;
  try { compressed = await readFile(target); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new BoundedGzipError('MISSING');
    throw new BoundedGzipError('INVALID');
  }
  if (compressed.byteLength > config.maxResultCompressedBytes) throw new BoundedGzipError('COMPRESSED_LIMIT');
  if (expectedSha256 && createHash('sha256').update(compressed).digest('hex') !== expectedSha256) throw new BoundedGzipError('CHECKSUM');
  const raw = await boundedGunzip(compressed, config.maxResultJsonBytes);
  const text = raw.toString('utf8');
  assertJsonDepth(text, config.maxResultJsonDepth);
  try { return JSON.parse(text) as unknown; } catch { throw new BoundedGzipError('INVALID'); }
}

