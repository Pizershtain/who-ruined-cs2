import { rm } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import type { ArtifactDeletionPort } from '../application/ports.js';
import { ApplicationError } from '../application/application-error.js';
import { safeExistingDataPath } from '../storage.js';

@Injectable()
export class LocalArtifactDeletion implements ArtifactDeletionPort {
  async deleteMatchFiles(matchId: string, relativeFiles: ReadonlySet<string>): Promise<void> {
    for (const relative of relativeFiles) {
      await rm(await safeExistingDataPath(relative), { force: true }).catch((error) => {
        throw new ApplicationError('STORAGE_FAILURE', 'Не удалось удалить принадлежащий матчу файл.', 503, {
          code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN',
        });
      });
    }
    for (const directory of [
      `results/${matchId}`,
      `reports/${matchId}`,
      `replays/${matchId}`,
      `experimental/c2s2/${matchId}`,
      `experimental/c2s2-participation/${matchId}`,
      `experimental/evp/${matchId}`,
    ]) {
      await rm(await safeExistingDataPath(directory), { recursive: true, force: true }).catch((error) => {
        throw new ApplicationError('STORAGE_FAILURE', 'Не удалось завершить очистку каталога матча.', 503, {
          code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN',
        });
      });
    }
  }
}
