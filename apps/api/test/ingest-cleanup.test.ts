import { randomUUID } from 'node:crypto';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  findUnique: vi.fn(),
  createMatch: vi.fn(() => ({ kind: 'match-create' })),
  createJob: vi.fn(() => ({ kind: 'job-create' })),
  transaction: vi.fn(),
  countJobs: vi.fn()
}));

vi.mock('@who-ruined/database', () => ({
  prisma: {
    match: { findUnique: database.findUnique, create: database.createMatch },
    job: { create: database.createJob, count: database.countJobs },
    $transaction: database.transaction
  }
}));

vi.mock('@who-ruined/parser-adapter', () => ({
  PARSER_LIBRARY_VERSION: 'test-parser',
  NORMALIZER_VERSION: 'test-normalizer',
  loadNativeParser: () => ({ parseHeader: () => ({ magic: 'PBDEMS2' }) }),
  isSource2Header: () => true
}));

const { MatchesService } = await import('../src/matches.service.js');
const { safeDataPath } = await import('../src/storage.js');

async function validTemporaryUpload(): Promise<{ path: string; file: Express.Multer.File }> {
  const directory = safeDataPath('uploads');
  await mkdir(directory, { recursive: true });
  const filePath = path.join(directory, `${randomUUID()}.dem`);
  const bytes = Buffer.concat([Buffer.from('PBDEMS2'), Buffer.alloc(32)]);
  await writeFile(filePath, bytes);
  return { path: filePath, file: { path: filePath, originalname: '..\\private-name.dem', size: bytes.length } as Express.Multer.File };
}

beforeEach(() => {
  vi.clearAllMocks();
  database.findUnique.mockResolvedValue(null);
  database.countJobs.mockResolvedValue(0);
});

describe('ingest ownership and persistence cleanup', () => {
  it('removes the owned upload and creates no retained state after a transaction failure', async () => {
    const upload = await validTemporaryUpload();
    database.transaction.mockRejectedValue(new Error('controlled database failure'));
    await expect(new MatchesService().ingest(upload.file)).rejects.toMatchObject({ code: 'INGESTION_PERSISTENCE_FAILED', status: 503 });
    await expect(access(upload.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(database.transaction).toHaveBeenCalledOnce();
  });

  it('resolves a concurrent same-digest create as a duplicate without deleting the existing upload', async () => {
    const upload = await validTemporaryUpload();
    database.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'existing-match', jobs: [{ id: 'existing-job' }] });
    database.transaction.mockRejectedValue(new Error('unique race'));
    await expect(new MatchesService().ingest(upload.file)).resolves.toEqual({ matchId: 'existing-match', jobId: 'existing-job', duplicate: true });
    await expect(access(upload.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses an out-of-root path and never deletes that external file', async () => {
    const external = path.join(os.tmpdir(), `${randomUUID()}.dem`);
    await writeFile(external, Buffer.concat([Buffer.from('PBDEMS2'), Buffer.alloc(32)]));
    const file = { path: external, originalname: 'external.dem', size: 40 } as Express.Multer.File;
    await expect(new MatchesService().ingest(file)).rejects.toMatchObject({ code: 'UPLOAD_STORAGE_INVALID', status: 500 });
    await expect(access(external)).resolves.toBeUndefined();
    await rm(external, { force: true });
  });

  it('returns typed queue backpressure after dedup and removes the unowned upload', async () => {
    const previous = process.env.MAX_QUEUED_JOBS;
    process.env.MAX_QUEUED_JOBS = '1';
    database.countJobs.mockResolvedValue(1);
    const upload = await validTemporaryUpload();
    try {
      await expect(new MatchesService().ingest(upload.file)).rejects.toMatchObject({ code: 'QUEUE_SATURATED', status: 503 });
      await expect(access(upload.path)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(database.transaction).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.MAX_QUEUED_JOBS; else process.env.MAX_QUEUED_JOBS = previous;
    }
  });
});
