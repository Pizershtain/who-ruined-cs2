import { Injectable } from '@nestjs/common';
import {
  type CanonicalMatchResult,
  evpPolicyId,
  evpReportSchemaVersion,
  assertMatchRelations,
  matchDataSchema,
  scoringReportSchema,
  type MatchArtifact,
} from '@who-ruined/contracts';
import {
  assertCanonicalMatchResultBinding,
  ArtifactError,
  evpReportBinding,
  parseEvpReport,
  parseMatchArtifact,
  parseCanonicalMatchResult,
} from '@who-ruined/artifacts';
import { H2_PARTICIPATION_RATING_POLICY } from '@who-ruined/scoring';
import type { ArtifactReaderPort, StoredMatch } from '../application/ports.js';
import { BoundedGzipError, readBoundedGzipJson } from '../bounded-gzip.js';
import { readParticipationSidecarForApi } from '../participation-rating.js';
import { ApplicationError } from '../application/application-error.js';

@Injectable()
export class StoredArtifactReader implements ArtifactReaderPort {
  async readMatchArtifact(stored: StoredMatch) {
    if (stored.resultFilePath) {
      const result = await this.readCanonicalResult(stored);
      return { match: result.artifact.match, analytics: result.artifact.analytics };
    }
    if (!stored.normalizedFilePath) throw new ApplicationError('INCOMPLETE_MATCH', 'Анализ матча ещё не завершён.', 409);
    let decoded: unknown;
    try {
      decoded = await readBoundedGzipJson(stored.normalizedFilePath);
    } catch {
      throw new ApplicationError('INCOMPLETE_MATCH', 'Сохранённый артефакт недоступен или повреждён.', 409);
    }
    try {
      const artifact = parseMatchArtifact(decoded);
      return { match: artifact.match, analytics: artifact.analytics };
    } catch {
      // A legacy matchData@1 fallback remains valid, but corrupt M2 relations do not.
    }
    const legacy = matchDataSchema.safeParse(decoded);
    if (legacy.success) {
      try {
        assertMatchRelations(legacy.data);
      } catch {
        throw new ApplicationError('REPORT_CORRUPT', 'Сохранённый Match содержит противоречивые связи.', 409);
      }
      return { match: legacy.data, analytics: null };
    }
    if (
      typeof decoded === 'object'
      && decoded !== null
      && 'schemaVersion' in decoded
      && decoded.schemaVersion === 'm2-artifact-1'
    ) {
      throw new ApplicationError('REPORT_CORRUPT', 'Сохранённый M2-артефакт повреждён.', 409);
    }
    throw new ApplicationError('INCOMPLETE_MATCH', 'Артефакт создан несовместимой версией; требуется повторный разбор исходного демо.', 409);
  }

  async readCanonicalResult(
    stored: StoredMatch,
    requireActivePolicy = false,
  ): Promise<CanonicalMatchResult> {
    if (!stored.resultFilePath || !stored.resultSha256) {
      throw new ApplicationError('REPORT_NOT_READY', 'Канонический отчёт ещё не готов.', 409);
    }

    let decoded: unknown;
    try {
      decoded = await readBoundedGzipJson(stored.resultFilePath, stored.resultSha256);
    } catch {
      throw new ApplicationError('REPORT_CORRUPT', 'Канонический отчёт не является корректным gzip JSON.', 409);
    }

    let result: CanonicalMatchResult;
    try {
      result = parseCanonicalMatchResult(decoded);
    } catch {
      throw new ApplicationError('REPORT_CORRUPT', 'Канонический отчёт не соответствует поддерживаемой схеме.', 409);
    }

    try {
      assertCanonicalMatchResultBinding(result, { matchId: stored.id });
    } catch {
      throw new ApplicationError('REPORT_CORRUPT', 'Канонический отчёт привязан к другому матчу.', 409);
    }
    try {
      assertCanonicalMatchResultBinding(result, {
        matchId: stored.id,
        policyId: stored.resultPolicyId,
        policyDigest: stored.resultPolicyDigest,
      });
    } catch {
      throw new ApplicationError('REPORT_CORRUPT', 'Policy binding канонического отчёта и БД не совпадает.', 409);
    }

    if (
      requireActivePolicy
      && result.schemaVersion === 'match-result@1'
      && (
        result.internal.selectedPolicySelector !== H2_PARTICIPATION_RATING_POLICY.selector
        || result.internal.selectedPolicyId !== H2_PARTICIPATION_RATING_POLICY.id
        || result.internal.selectedPolicyDigest !== H2_PARTICIPATION_RATING_POLICY.digest
      )
    ) {
      throw new ApplicationError('REPORT_POLICY_MISMATCH', 'Сохранённый отчёт создан не для H2; выполните локальный rating:rebuild.', 409);
    }
    return result;
  }

  async readEvpReport(stored: StoredMatch, canonical: CanonicalMatchResult) {
    const pointer = [
      stored.evpFilePath,
      stored.evpSchemaVersion,
      stored.evpSha256,
      stored.evpPolicyId,
      stored.evpBindingDigest,
    ];
    if (pointer.every((value) => value === null)) {
      throw new ApplicationError('REPORT_NOT_READY', 'EVP ещё не создан для этого матча.', 409, { resource: 'EVP', reason: 'NOT_CREATED' });
    }
    if (pointer.some((value) => value === null)) {
      throw new ApplicationError('REPORT_CORRUPT', 'Указатель EVP сохранён не полностью.', 409, { resource: 'EVP', reason: 'INCOMPLETE_POINTER' });
    }
    if (stored.evpPolicyId !== evpPolicyId) {
      throw new ApplicationError('REPORT_POLICY_MISMATCH', 'Сохранённый EVP создан несовместимой политикой.', 409, { resource: 'EVP', reason: 'POLICY_MISMATCH' });
    }
    if (stored.evpSchemaVersion !== evpReportSchemaVersion) {
      throw new ApplicationError('REPORT_CORRUPT', 'Сохранённый EVP имеет неподдерживаемую версию.', 409, { resource: 'EVP', reason: 'SCHEMA_MISMATCH' });
    }
    if (stored.evpBindingDigest !== evpReportBinding(canonical).inputDigest) {
      throw new ApplicationError('REPORT_CORRUPT', 'Сохранённый EVP устарел относительно canonical result.', 409, { resource: 'EVP', reason: 'BINDING_MISMATCH' });
    }

    let decoded: unknown;
    try {
      decoded = await readBoundedGzipJson(stored.evpFilePath!, stored.evpSha256!);
    } catch (error) {
      if (error instanceof BoundedGzipError && error.reason === 'MISSING') {
        throw new ApplicationError('REPORT_CORRUPT', 'Файл EVP отсутствует.', 409, { resource: 'EVP', reason: 'MISSING' });
      }
      throw new ApplicationError('REPORT_CORRUPT', 'Файл EVP повреждён или превышает допустимые лимиты.', 409, { resource: 'EVP', reason: 'CORRUPT' });
    }
    try {
      const report = parseEvpReport(decoded, canonical);
      if (report.binding.inputDigest !== stored.evpBindingDigest) {
        throw new ArtifactError('BINDING_MISMATCH');
      }
      return report;
    } catch (error) {
      if (error instanceof ArtifactError && error.reason === 'POLICY_MISMATCH') {
        throw new ApplicationError('REPORT_POLICY_MISMATCH', 'Сохранённый EVP создан несовместимой политикой.', 409, { resource: 'EVP', reason: 'POLICY_MISMATCH' });
      }
      throw new ApplicationError('REPORT_CORRUPT', 'EVP не прошёл проверку схемы, binding или ссылок evidence.', 409, { resource: 'EVP', reason: 'CORRUPT' });
    }
  }

  readParticipationSidecar(artifact: MatchArtifact, rawFilePath: string | null) {
    return readParticipationSidecarForApi(artifact, rawFilePath);
  }

  async readScoringReport(relativePath: string) {
    let decoded: unknown;
    try {
      decoded = await readBoundedGzipJson(relativePath);
    } catch (error) {
      if (!(error instanceof BoundedGzipError)) throw error;
      throw new ApplicationError('REPORT_CORRUPT', 'Scoring-отчёт недоступен или повреждён.', 409);
    }
    const report = scoringReportSchema.safeParse(decoded);
    if (!report.success) {
      throw new ApplicationError(
        'REPORT_CORRUPT',
        'Scoring-отчёт не соответствует поддерживаемой схеме.',
        409,
      );
    }
    return report.data;
  }
}
