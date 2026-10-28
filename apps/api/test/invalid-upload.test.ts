import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MatchesService } from '../src/matches.service.js';
import { safeDataPath } from '../src/storage.js';

async function temporaryUpload(extension: string, contents: Buffer): Promise<string> {
  const directory = safeDataPath('uploads');
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${randomUUID()}${extension}`);
  await writeFile(filePath, contents);
  return filePath;
}

describe('upload validation', () => {
  it('rejects a malformed .dem before creating database state', async () => {
    const filePath = await temporaryUpload('.dem', Buffer.from('not a demo'));
    const file = { path: filePath, originalname: 'broken.dem', size: 10 } as Express.Multer.File;
    await expect(new MatchesService().ingest(file)).rejects.toMatchObject({ code: 'INVALID_DEMO', status: 422 });
    await expect(import('node:fs/promises').then(({ access }) => access(filePath))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects a wrong extension without invoking the parser', async () => {
    const filePath = await temporaryUpload('.bin', Buffer.from('x'));
    const file = { path: filePath, originalname: 'unsafe.exe', size: 1 } as Express.Multer.File;
    await expect(new MatchesService().ingest(file)).rejects.toMatchObject({ code: 'INVALID_DEMO', status: 415 });
    await expect(import('node:fs/promises').then(({ access }) => access(filePath))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects a truncated Source 2-looking file and removes it', async () => {
    const filePath = await temporaryUpload('.dem', Buffer.concat([Buffer.from('PBDEMS2'), Buffer.alloc(24)]));
    const file = { path: filePath, originalname: 'truncated.dem', size: 31 } as Express.Multer.File;
    await expect(new MatchesService().ingest(file)).rejects.toMatchObject({ code: 'INVALID_DEMO', status: 422 });
    await expect(import('node:fs/promises').then(({ access }) => access(filePath))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
