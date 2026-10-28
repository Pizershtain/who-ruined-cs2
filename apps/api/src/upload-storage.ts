import multer from 'multer';
import type { Request } from 'express';
import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import path from 'node:path';

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

export function createAbortSafeDiskStorage(directory: string): multer.StorageEngine {
  const pending = new WeakMap<object, { request: Request; listener: () => void }>();
  const base = multer.diskStorage({
    destination: directory,
    filename: (request, file, callback) => {
      const filename = `${randomUUID()}.dem`;
      const target = path.join(directory, filename);
      let handled = false;
      const listener = () => {
        if (handled) return;
        handled = true;
        void removePartialUpload(target);
      };
      request.once('aborted', listener);
      request.once('error', listener);
      pending.set(file, { request, listener });
      callback(null, filename);
    }
  });
  return {
    _handleFile(request, file, callback) {
      base._handleFile(request, file, (error, info) => {
        const tracked = pending.get(file);
        if (tracked) {
          tracked.request.removeListener('aborted', tracked.listener);
          tracked.request.removeListener('error', tracked.listener);
          pending.delete(file);
        }
        callback(error, info);
      });
    },
    _removeFile(request, file, callback) {
      base._removeFile(request, file, callback);
    }
  };
}
