import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { MatchUploadResult } from '@who-ruined/contracts';
import { ApplicationError } from '../application-error.js';
import {
  ApiSettingsPort,
  ArtifactReaderPort,
  AuditLogPort,
  ClockPort,
  DemoFilePort,
  type DuplicateMatch,
  type UploadAdmissionResult,
  type UploadIdentity,
  IdGeneratorPort,
  MatchCommandPort,
} from '../ports.js';

export type ReceivedDemo = Pick<Express.Multer.File, 'path' | 'originalname' | 'size'> & { fileSha256: string };

const MINIMUM_SOURCE2_PREFLIGHT_BYTES = 16;

@Injectable()
export class IngestDemo {
  constructor(
    @Inject(MatchCommandPort) private readonly matches: MatchCommandPort,
    @Inject(DemoFilePort) private readonly demoFiles: DemoFilePort,
    @Inject(ApiSettingsPort) private readonly settings: ApiSettingsPort,
    @Inject(ClockPort) private readonly clock: ClockPort,
    @Inject(IdGeneratorPort) private readonly ids: IdGeneratorPort,
    @Inject(AuditLogPort) private readonly auditLog: AuditLogPort,
    @Inject(ArtifactReaderPort) private readonly artifacts: ArtifactReaderPort,
  ) {}

  private async duplicateResult(duplicate: DuplicateMatch, identity: UploadIdentity): Promise<MatchUploadResult> {
    if (duplicate.deletionState !== null) throw this.deleting();
    const { id: matchId, parseJob } = duplicate;
    const recovery = { matchId, recovery: 'DELETE_AND_REUPLOAD' };
    if (!parseJob || parseJob.status === 'FAILED' || parseJob.status === 'CANCELLED') {
      throw new ApplicationError('REPORT_NOT_READY', 'Предыдущий анализ демки не завершился. Удалите старую загрузку и попробуйте снова.', 409, {
        ...recovery, reason: 'PREVIOUS_ANALYSIS_UNAVAILABLE',
      });
    }
    const response = { matchId, jobId: parseJob.id, duplicate: true };
    if (parseJob.status !== 'COMPLETED' && parseJob.status !== 'PARTIAL') {
      return { ...response, reuseStatus: 'ANALYSIS_IN_PROGRESS' };
    }
    let canonical;
    try {
      canonical = await this.artifacts.readCanonicalResult(duplicate);
    } catch (error) {
      if (!(error instanceof ApplicationError)) throw error;
      throw new ApplicationError(error.code, error.message, error.status, { ...error.details, ...recovery });
    }
    if (canonical.schemaVersion !== 'match-result@2') {
      throw new ApplicationError('REPORT_POLICY_MISMATCH', 'Сохранённый анализ нужно пересчитать в H3.', 409, {
        ...recovery, recovery: 'REBUILD_OR_DELETE_AND_REUPLOAD',
      });
    }
    // The canonical decoder checks H3 policy identity/digest and the internal
    // binding. Also compare its input identity to the bytes and versions of this upload.
    const binding = canonical.internal.recomputeSeed.binding;
    if (binding.fileSha256 !== identity.fileSha256 || binding.parserVersion !== identity.parserVersion
      || binding.normalizerVersion !== identity.normalizerVersion) {
      throw new ApplicationError('REPORT_CORRUPT', 'Сохранённый отчёт не соответствует загруженной демке.', 409, {
        ...recovery, reason: 'UPLOAD_BINDING_MISMATCH',
      });
    }
    return { ...response, reuseStatus: 'RESULT_READY' };
  }

  private deleting(): ApplicationError {
    return new ApplicationError('MATCH_ACTIVE', 'Совпадающий матч находится в процессе удаления.', 409);
  }

  async execute(file: ReceivedDemo): Promise<MatchUploadResult> {
    const startedAt = this.clock.nowMilliseconds();
    const temporaryPath = this.demoFiles.ownedUploadPath(file.path);
    let retainedByMatch = false;
    try {
      if (!file.originalname.toLowerCase().endsWith('.dem')) throw new ApplicationError('INVALID_DEMO', 'Поддерживаются только файлы .dem.', 415);
      if (file.size === 0) throw new ApplicationError('INVALID_DEMO', 'Файл пуст.', 422);
      if (
        file.size < MINIMUM_SOURCE2_PREFLIGHT_BYTES
        || !(await this.demoFiles.hasSource2Magic(temporaryPath))
      ) {
        throw new ApplicationError('INVALID_DEMO', 'Файл не содержит заголовок CS2 Source 2 demo.', 422);
      }
      if (!/^[a-f0-9]{64}$/.test(file.fileSha256)) {
        throw new ApplicationError('UPLOAD_STORAGE_INVALID', 'Не удалось подтвердить контрольную сумму загрузки.', 500);
      }
      const identity = {
        fileSha256: file.fileSha256,
        parserVersion: this.demoFiles.parserVersion(),
        normalizerVersion: this.demoFiles.normalizerVersion(),
      };
      let existing: DuplicateMatch | null;
      try {
        existing = await this.matches.findUploadDuplicate(identity);
      } catch {
        throw new ApplicationError('INGESTION_PERSISTENCE_FAILED', 'Не удалось проверить предыдущие загрузки.', 503);
      }
      if (existing) {
        const response = await this.duplicateResult(existing, identity);
        this.auditLog.uploadIngested(file.size, this.clock.nowMilliseconds() - startedAt, true);
        return response;
      }
      const headerStatus = await this.demoFiles.source2HeaderStatus(temporaryPath);
      if (headerStatus === 'UNREADABLE') {
        throw new ApplicationError('INVALID_DEMO', 'Не удалось прочитать заголовок демо.', 422);
      }
      if (headerStatus === 'INVALID') {
        throw new ApplicationError('INVALID_DEMO', 'Файл не подтверждён как CS2 Source 2 demo.', 422);
      }
      const matchId = this.ids.create();
      const jobId = this.ids.create();
      let admission: UploadAdmissionResult;
      try {
        admission = await this.matches.admitUploadedMatch(
          {
            matchId,
            jobId,
            originalFileName: path.basename(file.originalname).slice(0, 255),
            ...identity,
            rawFilePath: this.demoFiles.storedRelativePath(temporaryPath),
          },
          this.settings.maxQueuedJobs(),
        );
      } catch {
        throw new ApplicationError('INGESTION_PERSISTENCE_FAILED', 'Не удалось сохранить загрузку и поставить её в очередь.', 503);
      }

      if (admission.kind === 'DUPLICATE') {
        const response = await this.duplicateResult(admission.match, identity);
        this.auditLog.uploadIngested(file.size, this.clock.nowMilliseconds() - startedAt, true);
        return response;
      }
      if (admission.kind === 'DUPLICATE_DELETING') {
        throw this.deleting();
      }
      if (admission.kind === 'QUEUE_SATURATED') {
        throw new ApplicationError('QUEUE_SATURATED', 'Очередь анализа временно заполнена.', 503);
      }
      if (admission.kind === 'CONCURRENT_WRITE') {
        throw new ApplicationError('INGESTION_PERSISTENCE_FAILED', 'База данных временно занята другой операцией.', 503);
      }

      retainedByMatch = true;
      this.auditLog.uploadIngested(file.size, this.clock.nowMilliseconds() - startedAt, false);
      return { matchId, jobId, duplicate: false, reuseStatus: 'ACCEPTED' };
    } finally {
      if (!retainedByMatch) await this.demoFiles.remove(temporaryPath).catch(() => undefined);
    }
  }
}
