import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { ArtifactError } from './errors.js';
import { serializeJson, sha256Bytes } from './canonical.js';

const zip = promisify(gzip);

export interface ArtifactLimits {
  compressedBytes: number;
  decompressedBytes: number;
  jsonDepth: number;
}

export interface PublishedArtifact {
  relativePath: string;
  sha256: string;
  bytes: number;
  publication: 'CREATED' | 'REUSED';
}

export interface ArtifactSchema<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false };
}

export function resolveArtifactPath(rootDirectory: string, relativePath: string, allowRoot = false): string {
  const root = path.resolve(rootDirectory);
  if (path.isAbsolute(relativePath)) throw new ArtifactError('UNSAFE_PATH');
  const resolved = path.resolve(root, relativePath);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if ((!allowRoot && resolved === root) || (resolved !== root && !resolved.startsWith(prefix))) {
    throw new ArtifactError('UNSAFE_PATH');
  }
  return resolved;
}

export async function assertNoSymlinkPath(rootDirectory: string, targetPath: string): Promise<void> {
  const root = path.resolve(rootDirectory);
  const target = path.resolve(targetPath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new ArtifactError('UNSAFE_PATH');
  try {
    if ((await lstat(root)).isSymbolicLink()) throw new ArtifactError('SYMLINK');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new ArtifactError('SYMLINK');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

function assertJsonDepth(bytes: Buffer, maximum: number): void {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const byte of bytes) {
    if (inString) {
      if (escaped) escaped = false;
      else if (byte === 0x5c) escaped = true;
      else if (byte === 0x22) inString = false;
      continue;
    }
    if (byte === 0x22) inString = true;
    else if (byte === 0x7b || byte === 0x5b) {
      depth += 1;
      if (depth > maximum) throw new ArtifactError('DEPTH');
    } else if (byte === 0x7d || byte === 0x5d) {
      depth -= 1;
    }
    if (depth < 0) throw new ArtifactError('INVALID_JSON');
  }
  if (inString || depth !== 0) throw new ArtifactError('INVALID_JSON');
}

function boundedGunzip(bytes: Buffer, maximum: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    gunzip(bytes, { maxOutputLength: maximum }, (error, output) => {
      if (!error) {
        resolve(output);
        return;
      }
      const code = (error as NodeJS.ErrnoException).code;
      reject(new ArtifactError(code === 'ERR_BUFFER_TOO_LARGE' ? 'DECOMPRESSED_LIMIT' : 'INVALID_JSON', { cause: error }));
    });
  });
}

export class FileArtifactStore {
  readonly root: string;

  constructor(root: string, readonly limits: ArtifactLimits) {
    this.root = path.resolve(root);
  }

  resolve(relativePath: string): string {
    return resolveArtifactPath(this.root, relativePath);
  }

  async assertNoSymlink(relativePath: string): Promise<string> {
    const target = this.resolve(relativePath);
    await assertNoSymlinkPath(this.root, target);
    return target;
  }

  async readCompressed(relativePath: string, expectedSha256?: string): Promise<Buffer> {
    const target = await this.assertNoSymlink(relativePath);
    let metadata;
    try {
      metadata = await stat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ArtifactError('MISSING');
      throw new ArtifactError('INVALID_JSON', { cause: error });
    }
    if (!metadata.isFile()) throw new ArtifactError('NOT_FILE');
    if (metadata.size > this.limits.compressedBytes) throw new ArtifactError('COMPRESSED_LIMIT');
    let bytes: Buffer;
    try {
      bytes = await readFile(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new ArtifactError('MISSING');
      throw new ArtifactError('INVALID_JSON', { cause: error });
    }
    if (bytes.byteLength > this.limits.compressedBytes) throw new ArtifactError('COMPRESSED_LIMIT');
    if (expectedSha256 && sha256Bytes(bytes) !== expectedSha256) throw new ArtifactError('CHECKSUM');
    return bytes;
  }

  async readGzipJson(relativePath: string, expectedSha256?: string): Promise<unknown> {
    const raw = await this.readAndDecompress(relativePath, expectedSha256);
    assertJsonDepth(raw, this.limits.jsonDepth);
    const text = raw.toString('utf8');
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      throw new ArtifactError('INVALID_JSON', { cause: error });
    }
  }

  private async readAndDecompress(
    relativePath: string,
    expectedSha256?: string,
  ): Promise<Buffer> {
    const compressed = await this.readCompressed(relativePath, expectedSha256);
    return boundedGunzip(compressed, this.limits.decompressedBytes);
  }

  async publishImmutable(
    relativePath: string,
    bytes: Buffer,
    beforeCommit?: () => Promise<void>,
  ): Promise<PublishedArtifact> {
    const target = await this.assertNoSymlink(relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await assertNoSymlinkPath(this.root, target);
    const digest = sha256Bytes(bytes);
    try {
      const existing = await readFile(target);
      if (sha256Bytes(existing) === digest) {
        return { relativePath, sha256: digest, bytes: bytes.byteLength, publication: 'REUSED' };
      }
      throw new ArtifactError('IMMUTABLE_CONFLICT');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    const temporary = target + '.' + randomUUID() + '.tmp';
    const handle = await open(temporary, 'wx');
    try {
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await beforeCommit?.();
      await link(temporary, target);
      return { relativePath, sha256: digest, bytes: bytes.byteLength, publication: 'CREATED' };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await readFile(target);
      if (sha256Bytes(existing) === digest) {
        return { relativePath, sha256: digest, bytes: bytes.byteLength, publication: 'REUSED' };
      }
      throw new ArtifactError('IMMUTABLE_CONFLICT');
    } finally {
      await rm(temporary, { force: true });
    }
  }
}

export async function gzipJson(
  value: unknown,
  limits?: ArtifactLimits,
): Promise<Buffer> {
  const serialized = serializeJson(value);
  if (limits && serialized.byteLength > limits.decompressedBytes) {
    throw new ArtifactError('DECOMPRESSED_LIMIT');
  }
  if (limits) assertJsonDepth(serialized, limits.jsonDepth);
  const compressed = await zip(serialized);
  if (limits && compressed.byteLength > limits.compressedBytes) {
    throw new ArtifactError('COMPRESSED_LIMIT');
  }
  return compressed;
}

export function parseArtifact<T>(schema: ArtifactSchema<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ArtifactError('SCHEMA_MISMATCH');
  return parsed.data;
}
