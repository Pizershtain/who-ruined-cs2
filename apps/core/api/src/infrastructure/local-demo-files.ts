import { open, rm } from 'node:fs/promises';
import path from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  NORMALIZER_VERSION,
  PARSER_LIBRARY_VERSION,
  validateSource2HeaderInChild,
} from '@who-ruined/parser-adapter';
import type { DemoFilePort } from '../application/ports.js';
import { ApplicationError } from '../application/application-error.js';
import { resolveApiRuntimeConfig } from '../runtime-config.js';
import { dataRoot, safeDataPath } from '../storage.js';

@Injectable()
export class LocalDemoFiles implements DemoFilePort {
  parserVersion(): string {
    return PARSER_LIBRARY_VERSION;
  }

  normalizerVersion(): string {
    return NORMALIZER_VERSION;
  }

  ownedUploadPath(filePath: string): string {
    const resolved = path.resolve(filePath);
    const uploadRoot = safeDataPath('uploads');
    const prefix = uploadRoot.endsWith(path.sep) ? uploadRoot : uploadRoot + path.sep;
    if (!resolved.startsWith(prefix)) {
      throw new ApplicationError('UPLOAD_STORAGE_INVALID', 'Временный файл загрузки находится вне разрешённого хранилища.', 500);
    }
    return resolved;
  }

  async hasSource2Magic(filePath: string): Promise<boolean> {
    const handle = await open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(8);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return bytesRead === 8 && buffer.subarray(0, 7).toString('ascii') === 'PBDEMS2';
    } finally {
      await handle.close();
    }
  }

  async source2HeaderStatus(
    filePath: string,
  ): Promise<'VALID' | 'INVALID' | 'UNREADABLE'> {
    return validateSource2HeaderInChild(
      filePath,
      resolveApiRuntimeConfig().headersTimeoutMs,
    );
  }

  storedRelativePath(filePath: string): string {
    return path.relative(dataRoot, filePath).replaceAll('\\', '/');
  }

  async remove(filePath: string): Promise<void> {
    await rm(filePath, { force: true });
  }
}
