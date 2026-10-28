import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { prisma } from '@who-ruined/database';
import { isSource2Header, loadNativeParser, NORMALIZER_VERSION, PARSER_LIBRARY_VERSION } from '@who-ruined/parser-adapter';
import { activeParticipationRatingReportSchema, matchAnalyticsSchema, matchArtifactSchema, matchDataSchema, rescoreRequestSchema, scoringReportSchema, type ActiveParticipationRatingReport, type MatchAnalytics, type MatchData, type ScoringConfig, type ScoringReport } from '@who-ruined/contracts';
import { buildActiveParticipationRating, SCORING_CONFIGS, scoringConfigHash, SUCCESSOR_75_25_CONFIG } from '@who-ruined/scoring';
import { ApiError } from './safe-exception.filter.js';
import { dataRoot, safeDataPath, safeExistingDataPath } from './storage.js';
import { readParticipationSidecarForApi } from './participation-rating.js';
import { readCanonicalResult } from './match-result-storage.js';
import { resolveActiveRatingPolicy } from './runtime-config.js';
import path from 'node:path';
import { readBoundedGzipJson } from './bounded-gzip.js';
import { assertOpaqueId, assertPlainObjectWithKeys } from './http-validation.js';
import { resolveApiRuntimeConfig } from './runtime-config.js';

async function sha256(filePath: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

async function hasSource2Magic(filePath: string): Promise<boolean> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(8);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return bytesRead === 8 && buffer.subarray(0, 7).toString('ascii') === 'PBDEMS2';
  } finally { await handle.close(); }
}

function ownedUploadPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  const uploadRoot = safeDataPath('uploads');
  const prefix = uploadRoot.endsWith(path.sep) ? uploadRoot : uploadRoot + path.sep;
  if (!resolved.startsWith(prefix)) throw new ApiError('UPLOAD_STORAGE_INVALID', 'Временный файл загрузки находится вне разрешённого хранилища.', 500);
  return resolved;
}

@Injectable()
export class MatchesService {
  private async artifact(id: string): Promise<{ match: MatchData; analytics: MatchAnalytics | null }> {
    assertOpaqueId(id, 'MATCH_NOT_FOUND');
    const stored = await prisma.match.findUnique({ where: { id } });
    if (!stored || stored.deletionState) throw new ApiError('MATCH_NOT_FOUND', 'Матч не найден.', 404);
    if (stored.resultFilePath) {
      const result = await readCanonicalResult(stored);
      return { match: result.artifact.match, analytics: result.artifact.analytics };
    }
    if (!stored.normalizedFilePath) throw new ApiError('INCOMPLETE_MATCH', 'Анализ матча ещё не завершён.', 409);
    let decoded: unknown;
    try { decoded = await readBoundedGzipJson(stored.normalizedFilePath); }
    catch { throw new ApiError('INCOMPLETE_MATCH', 'Сохранённый артефакт недоступен или повреждён.', 409); }
    const artifact = matchArtifactSchema.safeParse(decoded);
    if (artifact.success) return { match: artifact.data.match, analytics: artifact.data.analytics };
    const legacy = matchDataSchema.safeParse(decoded);
    if (legacy.success) return { match: legacy.data, analytics: null };
    throw new ApiError('INCOMPLETE_MATCH', 'Артефакт создан несовместимой версией; требуется повторный разбор исходного демо.', 409);
  }
  async ingest(file: Express.Multer.File): Promise<{ matchId: string; jobId: string; duplicate: boolean }> {
    const startedAt = Date.now();
    const temporaryPath = ownedUploadPath(file.path);
    let retainedByMatch = false;
    try {
      if (!file.originalname.toLowerCase().endsWith('.dem')) throw new ApiError('INVALID_DEMO', 'Поддерживаются только файлы .dem.', 415);
      if (file.size === 0) throw new ApiError('INVALID_DEMO', 'Файл пуст.', 422);
      if (file.size < 16 || !(await hasSource2Magic(temporaryPath))) throw new ApiError('INVALID_DEMO', 'Файл не содержит заголовок CS2 Source 2 demo.', 422);
      let header: unknown;
      try { header = loadNativeParser().parseHeader(temporaryPath); }
      catch { throw new ApiError('INVALID_DEMO', 'Не удалось прочитать заголовок демо.', 422); }
      if (!isSource2Header(header)) throw new ApiError('INVALID_DEMO', 'Файл не подтверждён как CS2 Source 2 demo.', 422);
      const fileHash = await sha256(temporaryPath);
      const duplicateKey = { fileSha256: fileHash, parserVersion: PARSER_LIBRARY_VERSION, normalizerVersion: NORMALIZER_VERSION };
      const findDuplicate = () => prisma.match.findUnique({ where: { fileSha256_parserVersion_normalizerVersion: duplicateKey }, include: { jobs: { orderBy: { createdAt: 'desc' as const }, take: 1 } } });
      const duplicate = await findDuplicate();
      if (duplicate) {
        console.info(JSON.stringify({ level: 'info', event: 'upload_ingested', bytes: file.size, durationMs: Date.now() - startedAt, duplicate: true }));
        return { matchId: duplicate.id, jobId: duplicate.jobs[0]?.id ?? '', duplicate: true };
      }
      const pendingJobs = await prisma.job.count({ where: { status: { in: ['QUEUED','PARSING','NORMALIZING','VALIDATING','FEATURIZING','SCORING'] } } });
      if (pendingJobs >= resolveApiRuntimeConfig().maxQueuedJobs) throw new ApiError('QUEUE_SATURATED', 'Очередь анализа временно заполнена.', 503);
      const matchId = randomUUID(); const jobId = randomUUID();
      const relativeRaw = path.relative(dataRoot, temporaryPath).replaceAll('\\', '/');
      try {
        await prisma.$transaction([
          prisma.match.create({ data: { id: matchId, originalFileName: path.basename(file.originalname).slice(0, 255), fileSha256: fileHash, status: 'QUEUED', parserVersion: PARSER_LIBRARY_VERSION, normalizerVersion: NORMALIZER_VERSION, rawFilePath: relativeRaw } }),
          prisma.job.create({ data: { id: jobId, matchId, type: 'PARSE', status: 'QUEUED', stage: 'QUEUED' } })
        ]);
      } catch {
        const concurrentDuplicate = await findDuplicate().catch(() => null);
        if (concurrentDuplicate) {
          console.info(JSON.stringify({ level: 'info', event: 'upload_ingested', bytes: file.size, durationMs: Date.now() - startedAt, duplicate: true }));
          return { matchId: concurrentDuplicate.id, jobId: concurrentDuplicate.jobs[0]?.id ?? '', duplicate: true };
        }
        throw new ApiError('INGESTION_PERSISTENCE_FAILED', 'Не удалось сохранить загрузку и поставить её в очередь.', 503);
      }
      retainedByMatch = true;
      console.info(JSON.stringify({ level: 'info', event: 'upload_ingested', bytes: file.size, durationMs: Date.now() - startedAt, duplicate: false }));
      return { matchId, jobId, duplicate: false };
    } finally {
      if (!retainedByMatch) await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async job(id: string) {
    assertOpaqueId(id, 'JOB_NOT_FOUND');
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) throw new ApiError('JOB_NOT_FOUND', 'Задача не найдена.', 404);
    return { id: job.id, matchId: job.matchId, status: job.status, stage: job.stage, createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(), ...(job.errorCode ? { errorCode: job.errorCode } : {}), ...(job.errorMessage ? { message: job.errorMessage } : {}) };
  }

  async list(cursor?: string) {
    if (cursor !== undefined) assertOpaqueId(cursor, 'MATCH_NOT_FOUND');
    const rows = await prisma.match.findMany({ take: 21, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
    const items = rows.slice(0, 20).map((match) => ({ id: match.id, map: match.map, score: null, status: match.status, quality: match.quality, createdAt: match.createdAt.toISOString() }));
    return { items, ...(rows.length > 20 ? { nextCursor: rows[19]?.id } : {}) };
  }

  async match(id: string): Promise<MatchData> {
    return (await this.artifact(id)).match;
  }

  async rounds(id: string) { return { items: (await this.match(id)).rounds }; }
  async analytics(id: string): Promise<MatchAnalytics> {
    const analytics = (await this.artifact(id)).analytics;
    if (!analytics) throw new ApiError('INCOMPLETE_MATCH', 'M2-аналитика для этого артефакта отсутствует; требуется повторный разбор.', 409);
    return matchAnalyticsSchema.parse(analytics);
  }
  async playerAnalytics(id: string, playerId: string) {
    assertOpaqueId(playerId, 'PLAYER_NOT_FOUND');
    const analytics = await this.analytics(id);
    const player = analytics.players.find((item) => item.playerId === playerId);
    if (!player) throw new ApiError('PLAYER_NOT_FOUND', 'Игрок не найден в матче.', 404);
    return { schemaVersion: analytics.schemaVersion, featureVersion: analytics.featureVersion, matchId: id, player };
  }

  async participationRating(id: string, policy?: string): Promise<ActiveParticipationRatingReport> {
    if (process.env.ENABLE_EXPERIMENTAL_PARTICIPATION_RATING !== '1') {
      throw new ApiError('EXPERIMENTAL_PARTICIPATION_RATING_DISABLED', 'Экспериментальный participation rating отключён конфигурацией сервера.', 404);
    }
    if (policy !== undefined) throw new ApiError('INVALID_POLICY_SELECTOR', 'Выбор rating policy через HTTP запрещён; policy задаётся только владельцем backend.', 422);
    const databaseMatch = await prisma.match.findUnique({ where: { id } });
    if (!databaseMatch || databaseMatch.deletionState) throw new ApiError('MATCH_NOT_FOUND', 'Матч не найден.', 404);
    if (databaseMatch.resultFilePath) return activeParticipationRatingReportSchema.parse((await readCanonicalResult(databaseMatch, true)).activeRating);
    const stored = await this.artifact(id);
    if (stored.match.matchId !== id) throw new ApiError('PARTICIPATION_SIDECAR_STALE', 'Идентификатор матча в артефакте не совпадает с запросом.', 409);
    if (!stored.analytics) throw new ApiError('INCOMPLETE_MATCH', 'Для participation rating нужен совместимый M2-артефакт.', 409);
    const artifact = matchArtifactSchema.parse({ schemaVersion: 'm2-artifact-1', match: stored.match, analytics: stored.analytics });
    const sidecar = await readParticipationSidecarForApi(artifact, databaseMatch.rawFilePath);
    return buildActiveParticipationRating(artifact, sidecar, resolveActiveRatingPolicy());
  }

  private scoringConfig(version?: string, configHash?: string): ScoringConfig {
    const selectedVersion = version ?? SUCCESSOR_75_25_CONFIG.version;
    const config = SCORING_CONFIGS.find((candidate) => candidate.version === selectedVersion && (configHash === undefined || scoringConfigHash(candidate) === configHash));
    if (!config) throw new ApiError('UNSUPPORTED_MODE', 'Запрошенная версия scoring-конфигурации не поддерживается.', 422);
    return config;
  }

  async report(id: string, version?: string, configHash?: string): Promise<ScoringReport> {
    const match = await prisma.match.findUnique({ where: { id } });
    if (!match || match.deletionState) throw new ApiError('MATCH_NOT_FOUND', 'Матч не найден.', 404);
    const config = this.scoringConfig(version, configHash);
    const hash = scoringConfigHash(config);
    if (match.resultFilePath) {
      const result = await readCanonicalResult(match);
      const report = result.productionReports.find((item) => item.scorerVersion === config.version && item.configHash === hash);
      if (!report) throw new ApiError('REPORT_NOT_READY', 'Запрошенный production report отсутствует в каноническом результате.', 409);
      return scoringReportSchema.parse(report);
    }
    const stored = await prisma.report.findUnique({ where: { matchId_scoringVersion_configHash: { matchId: id, scoringVersion: config.version, configHash: hash } } });
    if (!stored) throw new ApiError('INCOMPLETE_MATCH', 'Scoring-отчёт ещё не построен; запросите rescore для сохранённого M2-артефакта.', 409);
    let decoded: unknown;
    try { decoded = await readBoundedGzipJson(stored.jsonFilePath); }
    catch { throw new ApiError('REPORT_CORRUPT', 'Scoring-отчёт недоступен или повреждён.', 409); }
    return scoringReportSchema.parse(decoded);
  }

  async playerReport(id: string, playerId: string, version?: string, configHash?: string) {
    assertOpaqueId(playerId, 'PLAYER_NOT_FOUND');
    const report = await this.report(id, version, configHash);
    const player = report.players.find((item) => item.playerId === playerId);
    if (!player) throw new ApiError('PLAYER_NOT_FOUND', 'Игрок не найден в scoring-отчёте.', 404);
    const episodeIds = new Set(player.episodeIds);
    return { schemaVersion: report.schemaVersion, matchId: id, scorerVersion: report.scorerVersion, configHash: report.configHash, model: report.model, experimental: report.experimental, player, episodes: report.episodes.filter((episode) => episodeIds.has(episode.id)), rounds: report.rounds.map((round) => ({ roundId: round.roundId, ordinal: round.ordinal, player: round.players.find((item) => item.playerId === playerId)! })), warnings: report.warnings, limitations: report.limitations };
  }

  async rescore(id: string, body: unknown): Promise<{ matchId: string; jobId: string; scoringVersion: string; configHash: string }> {
    assertOpaqueId(id, 'MATCH_NOT_FOUND');
    assertPlainObjectWithKeys(body, ['scoringVersion','configHash']);
    const parsed = rescoreRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError('UNSUPPORTED_MODE', 'Некорректный запрос rescore.', 422);
    const config = this.scoringConfig(parsed.data.scoringVersion, parsed.data.configHash);
    const match = await prisma.match.findUnique({ where: { id } });
    if (!match) throw new ApiError('MATCH_NOT_FOUND', 'Матч не найден.', 404);
    if (!match.normalizedFilePath && !match.resultFilePath) throw new ApiError('SOURCE_DEMO_UNAVAILABLE', 'Для rescore нужен сохранённый M2-артефакт или канонический результат.', 409);
    const artifact = await this.artifact(id);
    if (!artifact.analytics) throw new ApiError('INCOMPLETE_MATCH', 'Старый артефакт не содержит M2-аналитику; требуется повторный разбор демо.', 409);
    const jobId = randomUUID();
    const configHash = scoringConfigHash(config);
    await prisma.job.create({ data: { id: jobId, matchId: id, type: 'RESCORE', status: 'QUEUED', stage: 'QUEUED', requestedScoringVersion: config.version, requestedConfigHash: configHash } });
    return { matchId: id, jobId, scoringVersion: config.version, configHash };
  }

  async deleteMatch(id: string): Promise<void> {
    assertOpaqueId(id, 'MATCH_NOT_FOUND');
    const match = await prisma.match.findUnique({ where: { id }, include: { jobs: true, reports: true } });
    if (!match) throw new ApiError('MATCH_NOT_FOUND', 'Матч не найден.', 404);
    if (match.jobs.some((job) => ['QUEUED','PARSING','NORMALIZING','VALIDATING','FEATURIZING','SCORING'].includes(job.status))) {
      throw new ApiError('MATCH_ACTIVE', 'Активный анализ необходимо завершить перед удалением матча.', 409);
    }
    await prisma.match.update({ where: { id }, data: { deletionState: 'DELETING', deletionRequestedAt: match.deletionRequestedAt ?? new Date() } });
    const files = new Set<string>();
    for (const candidate of [match.rawFilePath, match.normalizedFilePath, match.resultFilePath, ...match.reports.map((report) => report.jsonFilePath)]) if (candidate) files.add(candidate);
    for (const relative of files) await rm(await safeExistingDataPath(relative), { force: true }).catch((error) => { throw new ApiError('STORAGE_FAILURE', 'Не удалось удалить принадлежащий матчу файл.', 503, { code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' }); });
    for (const directory of [`results/${id}`,`reports/${id}`,`experimental/c2s2/${id}`,`experimental/c2s2-participation/${id}`]) {
      await rm(await safeExistingDataPath(directory), { recursive: true, force: true }).catch((error) => { throw new ApiError('STORAGE_FAILURE', 'Не удалось завершить очистку каталога матча.', 503, { code: (error as NodeJS.ErrnoException).code ?? 'UNKNOWN' }); });
    }
    await prisma.match.delete({ where: { id } });
  }
}
