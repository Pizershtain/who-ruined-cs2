import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, readFile, rm } from 'node:fs/promises';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { Injectable } from '@nestjs/common';
import { prisma } from '@who-ruined/database';
import { isSource2Header, loadNativeParser, NORMALIZER_VERSION, PARSER_LIBRARY_VERSION } from '@who-ruined/parser-adapter';
import { experimentalRatingReportSchema, matchAnalyticsSchema, matchArtifactSchema, matchDataSchema, rescoreRequestSchema, scoringReportSchema, type ExperimentalRatingReport, type MatchAnalytics, type MatchArtifact, type MatchData, type ScoringConfig, type ScoringReport } from '@who-ruined/contracts';
import { buildExperimentalRatingReport, SCORING_CONFIGS, scoringConfigHash, SUCCESSOR_75_25_CONFIG } from '@who-ruined/scoring';
import { ApiError } from './safe-exception.filter.js';
import { dataRoot, safeDataPath } from './storage.js';
import path from 'node:path';

const unzip = promisify(gunzip);

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

@Injectable()
export class MatchesService {
  private async artifact(id: string): Promise<{ match: MatchData; analytics: MatchAnalytics | null }> {
    const stored = await prisma.match.findUnique({ where: { id } });
    if (!stored) throw new ApiError('MATCH_NOT_FOUND', 'Матч не найден.', 404);
    if (!stored.normalizedFilePath) throw new ApiError('INCOMPLETE_MATCH', 'Анализ матча ещё не завершён.', 409);
    const raw = await unzip(await readFile(safeDataPath(stored.normalizedFilePath)));
    const decoded: unknown = JSON.parse(raw.toString('utf8'));
    const artifact = matchArtifactSchema.safeParse(decoded);
    if (artifact.success) return { match: artifact.data.match, analytics: artifact.data.analytics };
    const legacy = matchDataSchema.safeParse(decoded);
    if (legacy.success) return { match: legacy.data, analytics: null };
    throw new ApiError('INCOMPLETE_MATCH', 'Артефакт создан несовместимой версией; требуется повторный разбор исходного демо.', 409);
  }
  async ingest(file: Express.Multer.File): Promise<{ matchId: string; jobId: string; duplicate: boolean }> {
    if (!file.originalname.toLowerCase().endsWith('.dem')) { await rm(file.path, { force: true }); throw new ApiError('INVALID_DEMO', 'Поддерживаются только файлы .dem.', 415); }
    if (file.size === 0) { await rm(file.path, { force: true }); throw new ApiError('INVALID_DEMO', 'Файл пуст.', 422); }
    if (file.size < 16 || !(await hasSource2Magic(file.path))) { await rm(file.path, { force: true }); throw new ApiError('INVALID_DEMO', 'Файл не содержит заголовок CS2 Source 2 demo.', 422); }
    let header: unknown;
    try { header = loadNativeParser().parseHeader(file.path); } catch { await rm(file.path, { force: true }); throw new ApiError('INVALID_DEMO', 'Не удалось прочитать заголовок демо.', 422); }
    if (!isSource2Header(header)) { await rm(file.path, { force: true }); throw new ApiError('INVALID_DEMO', 'Файл не подтверждён как CS2 Source 2 demo.', 422); }
    const fileHash = await sha256(file.path);
    const duplicate = await prisma.match.findUnique({ where: { fileSha256_parserVersion_normalizerVersion: { fileSha256: fileHash, parserVersion: PARSER_LIBRARY_VERSION, normalizerVersion: NORMALIZER_VERSION } }, include: { jobs: { orderBy: { createdAt: 'desc' }, take: 1 } } });
    if (duplicate) { await rm(file.path, { force: true }); return { matchId: duplicate.id, jobId: duplicate.jobs[0]?.id ?? '', duplicate: true }; }
    const matchId = randomUUID(); const jobId = randomUUID();
    const relativeRaw = path.relative(dataRoot, file.path).replaceAll('\\', '/');
    await prisma.$transaction([
      prisma.match.create({ data: { id: matchId, originalFileName: file.originalname.slice(0, 255), fileSha256: fileHash, status: 'QUEUED', parserVersion: PARSER_LIBRARY_VERSION, normalizerVersion: NORMALIZER_VERSION, rawFilePath: relativeRaw } }),
      prisma.job.create({ data: { id: jobId, matchId, type: 'PARSE', status: 'QUEUED', stage: 'QUEUED' } })
    ]);
    return { matchId, jobId, duplicate: false };
  }

  async job(id: string) {
    const job = await prisma.job.findUnique({ where: { id } });
    if (!job) throw new ApiError('JOB_NOT_FOUND', 'Задача не найдена.', 404);
    return { id: job.id, matchId: job.matchId, status: job.status, stage: job.stage, createdAt: job.createdAt.toISOString(), updatedAt: job.updatedAt.toISOString(), ...(job.errorCode ? { errorCode: job.errorCode } : {}), ...(job.errorMessage ? { message: job.errorMessage } : {}) };
  }

  async list(cursor?: string) {
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
    const analytics = await this.analytics(id);
    const player = analytics.players.find((item) => item.playerId === playerId);
    if (!player) throw new ApiError('PLAYER_NOT_FOUND', 'Игрок не найден в матче.', 404);
    return { schemaVersion: analytics.schemaVersion, featureVersion: analytics.featureVersion, matchId: id, player };
  }

  async experimentalRating(id: string): Promise<ExperimentalRatingReport> {
    if (process.env.ENABLE_EXPERIMENTAL_RATING !== '1') throw new ApiError('EXPERIMENTAL_RATING_DISABLED', 'Экспериментальный рейтинг отключён конфигурацией сервера.', 404);
    const stored = await this.artifact(id);
    if (!stored.analytics) throw new ApiError('INCOMPLETE_MATCH', 'Для экспериментального рейтинга нужен совместимый M2-артефакт.', 409);
    if (stored.match.players.length !== 10 || stored.match.teams.length !== 2 || stored.match.teams.some((team) => team.playerIds.length !== 5)) throw new ApiError('UNSUPPORTED_ROSTER_SIZE', 'Экспериментальная политика M3-C8/P2 применима только к матчам 5v5.', 422);
    const artifact: MatchArtifact = matchArtifactSchema.parse({ schemaVersion: 'm2-artifact-1', match: stored.match, analytics: stored.analytics });
    return experimentalRatingReportSchema.parse(buildExperimentalRatingReport(artifact));
  }

  private scoringConfig(version?: string, configHash?: string): ScoringConfig {
    const selectedVersion = version ?? SUCCESSOR_75_25_CONFIG.version;
    const config = SCORING_CONFIGS.find((candidate) => candidate.version === selectedVersion && (configHash === undefined || scoringConfigHash(candidate) === configHash));
    if (!config) throw new ApiError('UNSUPPORTED_MODE', 'Запрошенная версия scoring-конфигурации не поддерживается.', 422);
    return config;
  }

  async report(id: string, version?: string, configHash?: string): Promise<ScoringReport> {
    const match = await prisma.match.findUnique({ where: { id } });
    if (!match) throw new ApiError('MATCH_NOT_FOUND', 'Матч не найден.', 404);
    const config = this.scoringConfig(version, configHash);
    const hash = scoringConfigHash(config);
    const stored = await prisma.report.findUnique({ where: { matchId_scoringVersion_configHash: { matchId: id, scoringVersion: config.version, configHash: hash } } });
    if (!stored) throw new ApiError('INCOMPLETE_MATCH', 'Scoring-отчёт ещё не построен; запросите rescore для сохранённого M2-артефакта.', 409);
    const raw = await unzip(await readFile(safeDataPath(stored.jsonFilePath)));
    return scoringReportSchema.parse(JSON.parse(raw.toString('utf8')) as unknown);
  }

  async playerReport(id: string, playerId: string, version?: string, configHash?: string) {
    const report = await this.report(id, version, configHash);
    const player = report.players.find((item) => item.playerId === playerId);
    if (!player) throw new ApiError('PLAYER_NOT_FOUND', 'Игрок не найден в scoring-отчёте.', 404);
    const episodeIds = new Set(player.episodeIds);
    return { schemaVersion: report.schemaVersion, matchId: id, scorerVersion: report.scorerVersion, configHash: report.configHash, model: report.model, experimental: report.experimental, player, episodes: report.episodes.filter((episode) => episodeIds.has(episode.id)), rounds: report.rounds.map((round) => ({ roundId: round.roundId, ordinal: round.ordinal, player: round.players.find((item) => item.playerId === playerId)! })), warnings: report.warnings, limitations: report.limitations };
  }

  async rescore(id: string, body: unknown): Promise<{ matchId: string; jobId: string; scoringVersion: string; configHash: string }> {
    const parsed = rescoreRequestSchema.safeParse(body);
    if (!parsed.success) throw new ApiError('UNSUPPORTED_MODE', 'Некорректный запрос rescore.', 422);
    const config = this.scoringConfig(parsed.data.scoringVersion, parsed.data.configHash);
    const match = await prisma.match.findUnique({ where: { id } });
    if (!match) throw new ApiError('MATCH_NOT_FOUND', 'Матч не найден.', 404);
    if (!match.normalizedFilePath) throw new ApiError('INCOMPLETE_MATCH', 'Для rescore нужен сохранённый M2-артефакт.', 409);
    const artifact = await this.artifact(id);
    if (!artifact.analytics) throw new ApiError('INCOMPLETE_MATCH', 'Старый артефакт не содержит M2-аналитику; требуется повторный разбор демо.', 409);
    const jobId = randomUUID();
    const configHash = scoringConfigHash(config);
    await prisma.job.create({ data: { id: jobId, matchId: id, type: 'RESCORE', status: 'QUEUED', stage: 'QUEUED', requestedScoringVersion: config.version, requestedConfigHash: configHash } });
    return { matchId: id, jobId, scoringVersion: config.version, configHash };
  }
}
