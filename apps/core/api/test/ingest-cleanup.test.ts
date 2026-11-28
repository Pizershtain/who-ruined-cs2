import { randomUUID } from 'node:crypto';
import { access, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const database = vi.hoisted(() => ({
  findUnique: vi.fn(),
  createMatch: vi.fn(),
  createJob: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  countJobs: vi.fn()
}));

vi.mock('@who-ruined/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@who-ruined/database')>()),
  prisma: {
    match: { findUnique: database.findUnique, create: database.createMatch },
    job: { create: database.createJob, count: database.countJobs },
    $transaction: database.transaction,
    $disconnect: vi.fn(),
  }
}));

vi.mock('@who-ruined/parser-adapter', () => ({
  PARSER_LIBRARY_VERSION: 'test-parser',
  NORMALIZER_VERSION: 'test-normalizer',
  validateSource2HeaderInChild: vi.fn(async () => 'VALID'),
}));

const { createTestApiFacade } = await import('./test-api-facade.js');
const { safeDataPath, dataRoot } = await import('../src/storage.js');
const { validateSource2HeaderInChild } = await import('@who-ruined/parser-adapter');

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
  database.transaction.mockImplementation(async (action) => action({
    $queryRaw: database.queryRaw,
    match: { findUnique: database.findUnique, create: database.createMatch },
    job: { create: database.createJob, count: database.countJobs },
  }));
});

describe('ingest ownership and persistence cleanup', () => {
  it('removes the owned upload and creates no retained state after a transaction failure', async () => {
    const upload = await validTemporaryUpload();
    database.transaction.mockRejectedValue(new Error('controlled database failure'));
    await expect(createTestApiFacade().ingest(upload.file)).rejects.toMatchObject({ code: 'INGESTION_PERSISTENCE_FAILED', status: 503 });
    await expect(access(upload.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(database.transaction).toHaveBeenCalledOnce();
  });

  it('does not misreport a database unique violation as a confirmed duplicate', async () => {
    const upload = await validTemporaryUpload();
    database.createMatch.mockRejectedValueOnce(Object.assign(
      new Error('synthetic unique violation'),
      { code: 'P2002' },
    ));

    await expect(createTestApiFacade().ingest(upload.file)).rejects.toMatchObject({
      code: 'INGESTION_PERSISTENCE_FAILED',
      status: 503,
    });
    await expect(access(upload.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(database.transaction).toHaveBeenCalledOnce();
  });

  it('bounds PostgreSQL serialization retries and maps exhaustion to a typed 503', async () => {
    const upload = await validTemporaryUpload();
    database.transaction.mockRejectedValue(Object.assign(
      new Error('transaction write conflict'),
      { code: 'P2034' },
    ));

    await expect(createTestApiFacade().ingest(upload.file)).rejects.toMatchObject({
      code: 'INGESTION_PERSISTENCE_FAILED',
      status: 503,
    });
    await expect(access(upload.path)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(database.transaction).toHaveBeenCalledTimes(3);
  });

  it('returns an atomically observed duplicate and removes only the competing upload', async () => {
    const upload = await validTemporaryUpload();
    database.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce({
      id: 'existing-match',
      deletionState: null,
      jobs: [{ id: 'existing-job', status: 'QUEUED' }],
    });
    await expect(createTestApiFacade().ingest(upload.file)).resolves.toEqual({
      matchId: 'existing-match', jobId: 'existing-job', duplicate: true, reuseStatus: 'ANALYSIS_IN_PROGRESS',
    });
    await expect(access(upload.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('reuses a verified queued match before starting the header parser or a write transaction', async () => {
    const upload = await validTemporaryUpload();
    database.findUnique.mockResolvedValue({ id: 'existing-match', deletionState: null, jobs: [{ id: 'parse-job', status: 'PARSING' }] });
    await expect(createTestApiFacade().ingest(upload.file)).resolves.toMatchObject({
      matchId: 'existing-match', jobId: 'parse-job', reuseStatus: 'ANALYSIS_IN_PROGRESS',
    });
    expect(validateSource2HeaderInChild).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
    await expect(access(upload.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each([
    ['FAILED', null, 'REPORT_NOT_READY'],
    ['CANCELLED', null, 'REPORT_NOT_READY'],
    ['COMPLETED', null, 'REPORT_NOT_READY'],
    ['COMPLETED', 'REQUESTED', 'MATCH_ACTIVE'],
  ])('fails closed when existing PARSE is %s and deletion is %s', async (status, deletionState, code) => {
    const upload = await validTemporaryUpload();
    database.findUnique.mockResolvedValue({
      id: 'existing-match', deletionState, resultFilePath: null, resultSha256: null, jobs: [{ id: 'parse-job', status }],
    });
    await expect(createTestApiFacade().ingest(upload.file)).rejects.toMatchObject({ code, status: 409 });
    expect(validateSource2HeaderInChild).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
    await expect(access(upload.path)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('checks the canonical file even when a matching PARSE completed', async () => {
    const upload = await validTemporaryUpload();
    const published = await validTemporaryUpload();
    try {
      database.findUnique.mockResolvedValue({
        id: 'existing-match', deletionState: null, jobs: [{ id: 'parse-job', status: 'COMPLETED' }],
        resultFilePath: path.relative(dataRoot, published.path).replaceAll('\\', '/'),
        resultSha256: '0'.repeat(64),
      });
      await expect(createTestApiFacade().ingest(upload.file)).rejects.toMatchObject({
        code: 'REPORT_CORRUPT', status: 409,
        details: { matchId: 'existing-match', recovery: 'DELETE_AND_REUPLOAD' },
      });
      expect(validateSource2HeaderInChild).not.toHaveBeenCalled();
      await expect(access(upload.path)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(access(published.path)).resolves.toBeUndefined();
    } finally {
      await rm(published.path, { force: true });
    }
  });

  it('retains the accepted upload owned by the newly committed match', async () => {
    const upload = await validTemporaryUpload();
    try {
      await expect(createTestApiFacade().ingest(upload.file)).resolves.toMatchObject({
        duplicate: false,
      });
      await expect(access(upload.path)).resolves.toBeUndefined();
      expect(database.createMatch).toHaveBeenCalledOnce();
      expect(database.createJob).toHaveBeenCalledOnce();
    } finally {
      await rm(upload.path, { force: true });
    }
  });

  it('refuses an out-of-root path and never deletes that external file', async () => {
    const external = path.join(os.tmpdir(), `${randomUUID()}.dem`);
    await writeFile(external, Buffer.concat([Buffer.from('PBDEMS2'), Buffer.alloc(32)]));
    const file = { path: external, originalname: 'external.dem', size: 40 } as Express.Multer.File;
    await expect(createTestApiFacade().ingest(file)).rejects.toMatchObject({ code: 'UPLOAD_STORAGE_INVALID', status: 500 });
    await expect(access(external)).resolves.toBeUndefined();
    await rm(external, { force: true });
  });

  it('returns typed queue backpressure after dedup and removes the unowned upload', async () => {
    const previous = process.env.MAX_QUEUED_JOBS;
    process.env.MAX_QUEUED_JOBS = '1';
    database.countJobs.mockResolvedValue(1);
    const upload = await validTemporaryUpload();
    try {
      await expect(createTestApiFacade().ingest(upload.file)).rejects.toMatchObject({ code: 'QUEUE_SATURATED', status: 503 });
      await expect(access(upload.path)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(database.transaction).toHaveBeenCalledOnce();
      expect(database.createMatch).not.toHaveBeenCalled();
    } finally {
      if (previous === undefined) delete process.env.MAX_QUEUED_JOBS; else process.env.MAX_QUEUED_JOBS = previous;
    }
  });
});
