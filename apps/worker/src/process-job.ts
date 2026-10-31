import { randomUUID } from 'node:crypto';
import { readFile, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { assertJobLease, advanceJobStage, ACTIVE_JOB_STAGES, prisma } from '@who-ruined/database';
import { canonicalMatchResultSchema, matchArtifactSchema, matchDataSchema, participationSidecarSchema, scoringReportSchema, type MatchArtifact, type ScoringConfig, type ScoringReport } from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import { normalizeSnapshot } from '@who-ruined/match-domain';
import { NORMALIZER_VERSION, PARSER_LIBRARY_VERSION, type ParsedReplaySnapshot } from '@who-ruined/parser-adapter';
import { SCORING_CONFIGS, scoreMatch, scoringConfigHash, SUCCESSOR_75_25_CONFIG, V1_CONFIG } from '@who-ruined/scoring';
import { parseInKillableProcess, parseReplayInKillableProcess } from './parser-boundary.js';
import { buildParticipationSidecar } from './participation-sidecar.js';
import { resolveWorkerRuntimeConfig, type WorkerRuntimeConfig } from './runtime-config.js';
import { assertNoSymlinkComponents, publishImmutableBytes, resolveDataPath } from './storage.js';
import { buildCanonicalMatchResult } from '@who-ruined/scoring';
import { publishCanonicalMatchResult, readCanonicalMatchResult, removeOwnedResult } from './match-result-storage.js';
import { persistReplayArtifacts, REPLAY_SAMPLE_RATE_HZ } from './replay-artifact.js';

const zip = promisify(gzip);
const unzip = promisify(gunzip);
const dataRoot = path.resolve(process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'));
const safePath = (relativePath: string) => resolveDataPath(dataRoot, relativePath);

export interface JobFaultHooks {
  afterStage?: (stage: string) => Promise<void> | void;
}

async function reached(jobId: string, leaseToken: string, stage: string, config: WorkerRuntimeConfig, hooks?: JobFaultHooks): Promise<void> {
  await advanceJobStage(jobId, leaseToken, stage, config.leaseMs);
  await hooks?.afterStage?.(stage);
}

async function fileExists(relative: string): Promise<boolean> {
  try { await access(safePath(relative)); return true; } catch { return false; }
}

async function writeGzipJson(relative: string, value: unknown, assertOwned: () => Promise<void>): Promise<'CREATED' | 'REUSED'> {
  const bytes = await zip(Buffer.from(JSON.stringify(value)));
  await assertOwned();
  const result = await publishImmutableBytes(safePath(relative), bytes, assertOwned);
  await assertOwned();
  return result;
}

async function loadArtifact(relativePath: string): Promise<MatchArtifact> {
  const raw = await unzip(await readFile(safePath(relativePath)));
  return matchArtifactSchema.parse(JSON.parse(raw.toString('utf8')) as unknown);
}

export async function scoreStoredArtifact(relativePath: string, config: ScoringConfig): Promise<ScoringReport> {
  return scoreMatch(await loadArtifact(relativePath), config);
}

async function persistReport(matchId: string, report: ScoringReport, assertOwned: () => Promise<void>): Promise<'CREATED' | 'REUSED'> {
  const relative = `reports/${matchId}/${report.scorerVersion}-${report.configHash}.json.gz`;
  let publication: 'CREATED' | 'REUSED';
  if (await fileExists(relative)) {
    const existing = scoringReportSchema.parse(JSON.parse((await unzip(await readFile(safePath(relative)))).toString('utf8')) as unknown);
    if (existing.matchId !== matchId || existing.scorerVersion !== report.scorerVersion || existing.configHash !== report.configHash) {
      throw new Error('IMMUTABLE_REPORT_CONFLICT');
    }
    publication = 'REUSED';
  } else {
    publication = await writeGzipJson(relative, report, assertOwned);
  }
  await assertOwned();
  await prisma.report.upsert({
    where: { matchId_scoringVersion_configHash: { matchId, scoringVersion: report.scorerVersion, configHash: report.configHash } },
    create: { id: randomUUID(), matchId, scoringVersion: report.scorerVersion, configHash: report.configHash, jsonFilePath: relative, quality: report.quality },
    update: { jsonFilePath: relative, quality: report.quality }
  });
  await assertOwned();
  return publication;
}

function requestedConfig(version: string | null, hash: string | null): ScoringConfig {
  const config = SCORING_CONFIGS.find((candidate) => candidate.version === version && scoringConfigHash(candidate) === hash);
  if (!config) throw new Error('UNSUPPORTED_SCORING_CONFIG');
  return config;
}

async function completeOwned(options: {
  jobId: string;
  matchId: string;
  leaseToken: string;
  terminal: 'COMPLETED' | 'PARTIAL';
  matchData: Record<string, unknown>;
}): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const now = new Date();
    const owned = await transaction.job.count({
      where: { id: options.jobId, leaseToken: options.leaseToken, status: { in: [...ACTIVE_JOB_STAGES] }, leaseUntil: { gte: now } }
    });
    if (owned !== 1) throw new Error('STALE_JOB_OWNER');
    await transaction.match.update({ where: { id: options.matchId }, data: options.matchData });
    const terminal = await transaction.job.updateMany({
      where: { id: options.jobId, leaseToken: options.leaseToken, status: { in: [...ACTIVE_JOB_STAGES] }, leaseUntil: { gte: now } },
      data: { status: options.terminal, stage: options.terminal, leaseUntil: null, leaseToken: null }
    });
    if (terminal.count !== 1) throw new Error('STALE_JOB_OWNER');
  });
}

async function cleanupRawAfterPublication(matchId: string, rawFilePath: string, hooks?: JobFaultHooks): Promise<boolean> {
  const ready = await prisma.match.findUnique({ where: { id: matchId }, select: { resultFilePath: true, resultSha256: true, rawFilePath: true, status: true } });
  if (!ready?.resultFilePath || !ready.resultSha256 || ready.rawFilePath !== rawFilePath || !['COMPLETED','PARTIAL'].includes(ready.status)) return false;
  const activeJobs = await prisma.job.count({ where: { matchId, status: { in: [...ACTIVE_JOB_STAGES] } } });
  const shared = await prisma.match.count({ where: { rawFilePath, id: { not: matchId } } });
  if (activeJobs > 0 || shared > 0) return false;
  const rawTarget = safePath(rawFilePath);
  await assertNoSymlinkComponents(dataRoot, rawTarget);
  await rm(rawTarget, { force: true });
  await hooks?.afterStage?.('RAW_DELETED');
  await prisma.match.updateMany({
    where: { id: matchId, rawFilePath, resultFilePath: ready.resultFilePath, resultSha256: ready.resultSha256 },
    data: { rawFilePath: null, sourceDeletedAt: new Date() }
  });
  return true;
}

async function failOwned(jobId: string, matchId: string, leaseToken: string, type: string, errorCode: string, errorMessage: string): Promise<void> {
  await prisma.$transaction(async (transaction) => {
    const failed = await transaction.job.updateMany({
      where: { id: jobId, leaseToken, status: { in: [...ACTIVE_JOB_STAGES] } },
      data: { status: 'FAILED', stage: 'FAILED', leaseUntil: null, leaseToken: null, errorCode, errorMessage }
    });
    if (failed.count !== 1) return;
    if (type === 'PARSE') await transaction.match.update({ where: { id: matchId }, data: { status: 'FAILED', quality: 'UNSUPPORTED' } });
  });
}

export async function processJob(
  jobId: string,
  matchId: string,
  leaseToken: string,
  options: { signal?: AbortSignal; config?: WorkerRuntimeConfig; hooks?: JobFaultHooks } = {}
): Promise<void> {
  const config = options.config ?? resolveWorkerRuntimeConfig();
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!job || !match || job.leaseToken !== leaseToken) throw new Error('STALE_JOB_OWNER');
  const assertOwned = async () => {
    if (options.signal?.aborted) throw new Error('STALE_JOB_OWNER');
    await assertJobLease(jobId, leaseToken);
  };
  let currentStage = job.type === 'RESCORE' ? 'SCORING' : 'PARSING';
  try {
    await assertOwned();
    if (job.type === 'RESCORE') {
      await reached(jobId, leaseToken, 'SCORING', config, options.hooks);
      const selected = requestedConfig(job.requestedScoringVersion, job.requestedConfigHash);
      if (match.resultFilePath && match.resultSha256) {
        const current = await readCanonicalMatchResult(dataRoot, match.resultFilePath, match.resultSha256);
        const report = scoreMatch(current.artifact, selected);
        const productionReports = [...current.productionReports.filter((item) => !(item.scorerVersion === report.scorerVersion && item.configHash === report.configHash)), report];
        const next = canonicalMatchResultSchema.parse({ ...current, createdAt: new Date().toISOString(), productionReports });
        const published = await publishCanonicalMatchResult(dataRoot, next, assertOwned);
        await completeOwned({
          jobId, matchId, leaseToken, terminal: 'COMPLETED',
          matchData: { resultFilePath: published.relativePath, resultSha256: published.sha256, resultSchemaVersion: next.schemaVersion, winningTeamId: report.winningTeamId, losingTeamId: report.losingTeamId }
        });
        if (match.resultFilePath !== published.relativePath) await removeOwnedResult(dataRoot, match.resultFilePath);
        return;
      }
      if (!match.normalizedFilePath) throw new Error('SOURCE_DEMO_UNAVAILABLE');
      const report = await scoreStoredArtifact(match.normalizedFilePath, selected);
      await persistReport(matchId, report, assertOwned);
      await completeOwned({
        jobId, matchId, leaseToken, terminal: 'COMPLETED',
        matchData: { winningTeamId: report.winningTeamId, losingTeamId: report.losingTeamId }
      });
      return;
    }
    if (job.type !== 'PARSE' || !match.rawFilePath) throw new Error('RAW_DEMO_UNAVAILABLE');
    let artifact: MatchArtifact | null = null;
    let preparedSidecar = null;
    let replaySnapshot: ParsedReplaySnapshot | null = null;
    {
      await reached(jobId, leaseToken, 'PARSING', config, options.hooks);
      const outputRelative = `worker-tmp/${jobId}/${leaseToken}.snapshot.json.gz`;
      const snapshot = await parseInKillableProcess({
        dataRoot, rawRelative: match.rawFilePath, outputRelative, config,
        ...(options.signal ? { signal: options.signal } : {})
      });
      await assertOwned();
      currentStage = 'NORMALIZING';
      await reached(jobId, leaseToken, currentStage, config, options.hooks);
      const normalized = normalizeSnapshot({ matchId, fileSha256: match.fileSha256, snapshot });
      currentStage = 'VALIDATING';
      await reached(jobId, leaseToken, currentStage, config, options.hooks);
      const validated = matchDataSchema.parse(normalized);
      await assertOwned();
      if (validated.tickRate !== null && validated.rounds.length > 0) {
        try {
          const replayOutputRelative = `worker-tmp/${jobId}/${leaseToken}.replay-snapshot.json.gz`;
          replaySnapshot = await parseReplayInKillableProcess({
            dataRoot,
            rawRelative: match.rawFilePath,
            outputRelative: replayOutputRelative,
            replay: {
              tickRate: validated.tickRate,
              sampleRateHz: REPLAY_SAMPLE_RATE_HZ,
              rounds: validated.rounds.map(({ id, ordinal, startTick, freezeEndTick, endTick }) => ({ id, ordinal, startTick, freezeEndTick, endTick }))
            },
            config,
            ...(options.signal ? { signal: options.signal } : {})
          });
          await assertOwned();
        } catch (error) {
          replaySnapshot = null;
          console.warn(JSON.stringify({ level: 'warn', event: 'replay_parse_unavailable', code: error instanceof Error ? error.message : 'REPLAY_PARSE_FAILED' }));
        }
      }
      preparedSidecar = buildParticipationSidecar(snapshot, validated, safePath(match.rawFilePath));
      await assertOwned();
      currentStage = 'FEATURIZING';
      await reached(jobId, leaseToken, currentStage, config, options.hooks);
      const analytics = computeMatchAnalytics(validated);
      artifact = matchArtifactSchema.parse({ schemaVersion: 'm2-artifact-1', match: validated, analytics });
    }
    currentStage = 'SCORING';
    await reached(jobId, leaseToken, currentStage, config, options.hooks);
    const reports = [V1_CONFIG, SUCCESSOR_75_25_CONFIG].map((ratingConfig) => scoreMatch(artifact!, ratingConfig));
    const defaultReport = reports.find((report) => report.scorerVersion === SUCCESSOR_75_25_CONFIG.version);
    if (!defaultReport) throw new Error('SCORING_REPORT_UNAVAILABLE');
    const validated = artifact.match;
    const terminal = validated.quality === 'VALID' ? 'COMPLETED' : 'PARTIAL';
    if (!preparedSidecar) throw new Error('PARTICIPATION_SEED_UNAVAILABLE');
    const canonical = buildCanonicalMatchResult({
      artifact, sidecar: participationSidecarSchema.parse(preparedSidecar), productionReports: reports,
      selector: config.activeRatingPolicy, sourceDemoRetained: config.retainSourceDemo
    });
    const published = await publishCanonicalMatchResult(dataRoot, canonical, assertOwned);
    await options.hooks?.afterStage?.('RESULT_PUBLISHED');
    if (replaySnapshot) {
      try {
        const replayIndex = await persistReplayArtifacts({ dataRoot, match: validated, snapshot: replaySnapshot, config, assertOwned });
        console.info(JSON.stringify({ level: 'info', event: 'replay_published', matchId, rounds: replayIndex.rounds.length, frames: replayIndex.totalFrames, compressedBytes: replayIndex.totalCompressedBytes }));
      } catch (error) {
        console.warn(JSON.stringify({ level: 'warn', event: 'replay_publish_unavailable', code: error instanceof Error ? error.message : 'REPLAY_PUBLISH_FAILED' }));
      }
    }
    const selectedPolicy = canonical.internal;
    await completeOwned({
      jobId, matchId, leaseToken, terminal,
      matchData: {
        status: terminal, quality: validated.quality, map: validated.map, normalizedFilePath: null,
        resultFilePath: published.relativePath, resultSchemaVersion: canonical.schemaVersion,
        resultSha256: published.sha256, resultPolicyId: selectedPolicy.selectedPolicyId,
        resultPolicyDigest: selectedPolicy.selectedPolicyDigest,
        winningTeamId: defaultReport.winningTeamId, losingTeamId: defaultReport.losingTeamId,
        parserVersion: PARSER_LIBRARY_VERSION, normalizerVersion: NORMALIZER_VERSION
      }
    });
    await options.hooks?.afterStage?.('DB_POINTER_COMMITTED');
    if (!config.retainSourceDemo) await cleanupRawAfterPublication(matchId, match.rawFilePath, options.hooks);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_WORKER_ERROR';
    if (message === 'STALE_JOB_OWNER') return;
    const timeout = message === 'PARSE_TIMEOUT';
    const validationFailure = currentStage === 'VALIDATING';
    const scoringFailure = currentStage === 'SCORING';
    const errorCode = timeout ? 'PARSE_TIMEOUT' : validationFailure ? 'VALIDATION_FAILED' : scoringFailure ? 'SCORING_FAILED' : 'PARSE_FAILED';
    const errorMessage = timeout ? 'Превышено время разбора демо.' : validationFailure
      ? 'Нормализованные данные не прошли обязательную валидацию.'
      : scoringFailure ? 'Не удалось детерминированно построить scoring-отчёт.' : 'Парсер не смог безопасно обработать демо.';
    console.error(JSON.stringify({ level: 'error', event: 'job_failed', stage: currentStage, code: errorCode }));
    await failOwned(jobId, matchId, leaseToken, job.type, errorCode, errorMessage);
  }
}
