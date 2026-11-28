import type { StorageEngine } from 'multer';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const RETRY_DELAYS_MS = [0, 50, 250, 1_000] as const;

async function removePartialUpload(filePath: string): Promise<void> {
  for (const delay of RETRY_DELAYS_MS) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      await rm(filePath, { force: true });
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    }
  }
  console.error(JSON.stringify({ level: 'error', event: 'upload_cleanup_failed', code: 'TEMPORARY_FILE_REMOVE_FAILED' }));
}

export function createAbortSafeDiskStorage(directory: string): StorageEngine {
  return {
    _handleFile(request, file, callback) {
      const filename = `${randomUUID()}.dem`;
      const target = path.join(directory, filename);
      const abort = new AbortController();
      const cancel = () => abort.abort();
      const hash = createHash('sha256');
      const output = createWriteStream(target, { flags: 'wx' });
      let created = false;
      output.once('open', () => { created = true; });
      const digesting = new Transform({
        transform(chunk: Buffer, _encoding, next) {
          hash.update(chunk);
          next(null, chunk);
        },
      });
      request.once('aborted', cancel);
      request.once('error', cancel);
      if (request.aborted) cancel();
      const detach = () => {
        request.removeListener('aborted', cancel);
        request.removeListener('error', cancel);
      };
      void pipeline(file.stream, digesting, output, { signal: abort.signal }).then(
        () => {
          detach();
          const info = { destination: directory, filename, path: target, size: output.bytesWritten, fileSha256: hash.digest('hex') };
          callback(null, info);
        },
        async (error: unknown) => {
          if (created) await removePartialUpload(target);
          detach();
          callback(error);
        }
      );
    },
    _removeFile(_request, file, callback) {
      void rm(file.path, { force: true }).then(() => callback(null), callback);
    }
  };
}
