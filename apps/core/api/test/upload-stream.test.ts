import { createServer, request as httpRequest, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import multer from 'multer';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDemoUploadOptions } from '../src/modules/matches/matches.controller.js';
import type { ReceivedDemo } from '../src/application/use-cases/ingest-demo.js';

const limit = 64 * 1024;
let directory: string;
let server: Server;

function startServer(): Server {
  const options = createDemoUploadOptions(directory, {
    maxUploadBytes: limit,
    minUploadFreeBytes: 1,
    multipartOverheadAllowanceBytes: 1024
  });
  const middleware = multer({
    ...options,
    fileFilter(incoming, file, callback) {
      options.fileFilter(incoming, file, (error, accept) => {
        if (error) callback(error);
        else callback(null, accept);
      });
    },
  }).single('demo');
  return createServer((incoming, response) => {
    middleware(incoming as never, response as never, (error?: unknown) => {
      if (error) {
        const code = error instanceof Error && 'code' in error ? String(error.code) : 'UNKNOWN';
        response.statusCode = code === 'LIMIT_FILE_SIZE' ? 413 : 422;
        response.end(code);
        return;
      }
      const file = (incoming as typeof incoming & { file?: ReceivedDemo }).file;
      if (file) response.setHeader('X-Test-Stored-Sha256', file.fileSha256);
      response.statusCode = 204;
      response.end();
    });
  });
}

async function fileCount(): Promise<number> {
  return (await readdir(directory)).length;
}

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'wrc-upload-stream-'));
  server = startServer();
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

describe('bounded disk upload', () => {
  it('accepts exactly MAX_UPLOAD_BYTES without buffering the file in memory', async () => {
    const bytes = Buffer.alloc(limit, 0x59);
    await request(server).post('/').set('X-Content-SHA256', 'a'.repeat(64))
      .attach('demo', bytes, { filename: 'boundary.dem' })
      .expect('X-Test-Stored-Sha256', createHash('sha256').update(bytes).digest('hex')).expect(204);
    expect(await fileCount()).toBe(1);
  });

  it('rejects MAX_UPLOAD_BYTES + 1 and removes the partial file', async () => {
    await request(server).post('/').attach('demo', Buffer.alloc(limit + 1), { filename: 'too-large.dem' }).expect(413, 'LIMIT_FILE_SIZE');
    expect(await fileCount()).toBe(0);
  });

  it('rejects the wrong extension before creating a file', async () => {
    await request(server).post('/').attach('demo', Buffer.from('x'), { filename: 'wrong.bin' }).expect(422);
    expect(await fileCount()).toBe(0);
  });

  it('enforces the streaming limit when Content-Length is absent', async () => {
    const address = server.listen(0).address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const boundary = 'wrc-chunked-boundary';
    const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="demo"; filename="chunked.dem"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const status = await new Promise<number>((resolve, reject) => {
      const upload = request(`http://127.0.0.1:${address.port}`).post('/').set('Content-Type', `multipart/form-data; boundary=${boundary}`);
      upload.write(prefix);
      upload.write(Buffer.alloc(limit + 1));
      upload.write(suffix);
      upload.end((error, response) => error ? reject(error) : resolve(response.status));
    });
    expect(status).toBe(413);
    expect(await fileCount()).toBe(0);
  });

  it('removes its partial file when the client aborts mid-stream', async () => {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const boundary = 'wrc-abort-boundary';
    const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="demo"; filename="aborted.dem"\r\nContent-Type: application/octet-stream\r\n\r\n`);
    await new Promise<void>((resolve) => {
      const upload = httpRequest({
        host: '127.0.0.1', port: address.port, method: 'POST', path: '/',
        headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'transfer-encoding': 'chunked' }
      });
      upload.on('error', () => resolve());
      upload.write(prefix);
      upload.write(Buffer.alloc(1024));
      upload.destroy();
      setTimeout(resolve, 200);
    });
    await new Promise((resolve) => setTimeout(resolve, 1_400));
    expect(await fileCount()).toBe(0);
  });
});
