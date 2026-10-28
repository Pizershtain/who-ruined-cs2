import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from '@nestjs/common';
import { statfs } from 'node:fs/promises';
import type { Observable } from 'rxjs';
import { finalize } from 'rxjs';
import { ApiError } from './safe-exception.filter.js';
import { parseContentLength, type UploadConfig } from './upload-config.js';
import { resolveApiRuntimeConfig } from './runtime-config.js';

type RequestHeaders = Record<string, string | string[] | undefined>;
type FreeBytesReader = (directory: string) => Promise<number>;
let activeUploads = 0;

export function tryAcquireUploadSlot(maximum: number): (() => void) | null {
  if (activeUploads >= maximum) return null;
  activeUploads += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeUploads -= 1;
  };
}

export function activeUploadCount(): number { return activeUploads; }

async function filesystemFreeBytes(directory: string): Promise<number> {
  const stats = await statfs(directory);
  return stats.bavail * stats.bsize;
}

export async function assertUploadAdmission(
  headers: RequestHeaders,
  uploadDirectory: string,
  config: UploadConfig,
  readFreeBytes: FreeBytesReader = filesystemFreeBytes
): Promise<void> {
  let contentLength: number | null;
  try {
    contentLength = parseContentLength(headers['content-length']);
  } catch {
    throw new ApiError('INVALID_DEMO', 'Некорректный Content-Length запроса.', 422);
  }
  const maximumBodyBytes = config.maxUploadBytes + config.multipartOverheadAllowanceBytes;
  if (contentLength !== null && contentLength > maximumBodyBytes) {
    throw new ApiError('SIZE_LIMIT', 'Файл превышает допустимый размер.', 413, {
      maxBytes: config.maxUploadBytes,
      maxMiB: config.maxUploadBytes / (1024 * 1024)
    });
  }
  let freeBytes: number;
  try {
    freeBytes = await readFreeBytes(uploadDirectory);
  } catch {
    throw new ApiError('STORAGE_UNAVAILABLE', 'Хранилище загрузок временно недоступно.', 507);
  }
  const expectedUploadBytes = contentLength === null
    ? config.maxUploadBytes
    : Math.min(contentLength, config.maxUploadBytes);
  if (!Number.isSafeInteger(freeBytes) || freeBytes < expectedUploadBytes + config.minUploadFreeBytes) {
    throw new ApiError('STORAGE_UNAVAILABLE', 'Недостаточно свободного места для безопасной загрузки.', 507);
  }
}

@Injectable()
export class UploadAdmissionInterceptor implements NestInterceptor {
  constructor(
    private readonly uploadDirectory: string,
    private readonly config: UploadConfig
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<{ headers: RequestHeaders }>();
    const release = tryAcquireUploadSlot(resolveApiRuntimeConfig().maxConcurrentUploads);
    if (!release) throw new ApiError('UPLOAD_BUSY', 'Сервер уже принимает максимальное число загрузок.', 429);
    try {
      await assertUploadAdmission(request.headers, this.uploadDirectory, this.config);
      return next.handle().pipe(finalize(release));
    } catch (error) {
      release();
      throw error;
    }
  }
}
