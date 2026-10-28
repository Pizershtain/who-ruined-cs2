import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, readFile, rm } from 'node:fs/promises';

export function resolveDataPath(dataRoot: string, relativePath: string): string {
  const root = path.resolve(dataRoot);
  const resolved = path.resolve(root, relativePath);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved === root || !resolved.startsWith(prefix)) throw new Error('Unsafe artifact path');
  return resolved;
}

export async function assertNoSymlinkComponents(dataRoot: string, target: string): Promise<void> {
  const root = path.resolve(dataRoot);
  const resolved = path.resolve(target);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe artifact path');
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('SYMLINK_ARTIFACT_PATH');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
  }
}

const digest = (value: Buffer) => createHash('sha256').update(value).digest('hex');

export async function publishImmutableBytes(
  target: string,
  bytes: Buffer,
  beforeCommit?: () => Promise<void>
): Promise<'CREATED' | 'REUSED'> {
  await mkdir(path.dirname(target), { recursive: true });
  try {
    const existing = await readFile(target);
    if (digest(existing) === digest(bytes)) return 'REUSED';
    throw new Error('IMMUTABLE_ARTIFACT_CONFLICT');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await beforeCommit?.();
    await link(temporary, target);
    return 'CREATED';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const existing = await readFile(target);
    if (digest(existing) === digest(bytes)) return 'REUSED';
    throw new Error('IMMUTABLE_ARTIFACT_CONFLICT');
  } finally {
    await rm(temporary, { force: true });
  }
}
