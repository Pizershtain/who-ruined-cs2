import path from 'node:path';
import {
  assertJobLease,
  completeOwnedJob,
  failOwnedJob,
  initialJobStageFor,
  isJobType,
  prisma,
  type ActiveJobStage,
} from '@who-ruined/database';
import { type ScoringConfig, type ScoringReport } from '@who-ruined/contracts';
import { NORMALIZER_VERSION, PARSER_LIBRARY_VERSION } from '@who-ruined/parser-adapter';
import { buildCanonicalMatchResult, scoreMatch, SUCCESSOR_75_25_CONFIG, V1_CONFIG } from '@who-ruined/scoring';
import { resolveWorkerRuntimeConfig, type WorkerRuntimeConfig } from './runtime-config.js';
import { publishCanonicalMatchResult } from './match-result-storage.js';
import { persistReplayArtifacts } from './replay-artifact.js';
import {
  cleanupRawAfterPublication,
  reachOwnedStage,
  runPostCommitCleanup,
  type JobFaultHooks,
} from './job-lifecycle.js';
import {
  scoreStoredArtifact as scoreStoredArtifactAtRoot,
} from './report-storage.js';
import { runRescorePipeline } from './rescore-pipeline.js';
import { runParsePipeline } from './parse-pipeline.js';

export type { JobFaultHooks } from './job-lifecycle.js';

const dataRoot = path.resolve(process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'));

export async function scoreStoredArtifact(relativePath: string, config: ScoringConfig): Promise<ScoringReport> {
  return scoreStoredArtifactAtRoot(dataRoot, relativePath, config);
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
  if (!isJobType(job.type)) {
    const failed = await failOwnedJob(
      jobId,
      leaseToken,
      'UNSUPPORTED_JOB_TYPE',
      'Задача имеет неподдерживаемый тип.',
    );
    if (failed) {
      console.error(JSON.stringify({
        level: 'error', event: 'job_failed', stage: job.stage, code: 'UNSUPPORTED_JOB_TYPE',
      }));
    }
    return;
  }
  const jobType = job.type;
  const assertOwned = async () => {
    if (options.signal?.aborted) throw new Error('STALE_JOB_OWNER');
    await assertJobLease(jobId, leaseToken);
  };
  const lifecycleState: { currentStage: ActiveJobStage } = {
    currentStage: initialJobStageFor(jobType),
  };
  try {
    await assertOwned();
    if (jobType === 'RESCORE') {
      await runRescorePipeline({
        dataRoot,
        jobId,
        matchId,
        leaseToken,
        job,
        match,
        config,
        ...(options.hooks ? { hooks: options.hooks } : {}),
        assertOwned,
      });
      return;
    }
    const rawFilePath = match.rawFilePath;
    if (!rawFilePath) throw new Error('RAW_DEMO_UNAVAILABLE');
    const {
      artifact,
      preparedSidecar,
      replaySnapshot,
    } = await runParsePipeline({
      dataRoot,
      jobId,
      matchId,
      leaseToken,
      rawFilePath,
      fileSha256: match.fileSha256,
      config,
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.hooks ? { hooks: options.hooks } : {}),
      assertOwned,
      onStage: (stage) => {
        lifecycleState.currentStage = stage;
      },
    });
    lifecycleState.currentStage = 'SCORING';
    await reachOwnedStage(
      jobId,
      leaseToken,
      lifecycleState.currentStage,
      config,
      options.hooks,
    );
    const reports = [V1_CONFIG, SUCCESSOR_75_25_CONFIG].map((ratingConfig) => scoreMatch(artifact, ratingConfig));
    const defaultReport = reports.find((report) => report.scorerVersion === SUCCESSOR_75_25_CONFIG.version);
    if (!defaultReport) throw new Error('SCORING_REPORT_UNAVAILABLE');
    const validated = artifact.match;
    const terminal = validated.quality === 'VALID' ? 'COMPLETED' : 'PARTIAL';
    const canonical = buildCanonicalMatchResult({
      artifact, sidecar: preparedSidecar, productionReports: reports,
      sourceDemoRetained: config.retainSourceDemo
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
    await completeOwnedJob({
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
    await runPostCommitCleanup('post_commit_cleanup_failed', async () => {
      await options.hooks?.afterStage?.('DB_POINTER_COMMITTED');
      if (!config.retainSourceDemo) {
        await cleanupRawAfterPublication(
          dataRoot,
          matchId,
          rawFilePath,
          options.hooks,
        );
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'UNKNOWN_WORKER_ERROR';
    if (message === 'STALE_JOB_OWNER') return;
    const timeout = message === 'PARSE_TIMEOUT';
    const corruptStoredReport = jobType === 'RESCORE'
      && (message === 'REPORT_CORRUPT' || message.startsWith('ARTIFACT_'));
    const validationFailure = lifecycleState.currentStage === 'VALIDATING';
    const scoringFailure = lifecycleState.currentStage === 'SCORING';
    const errorCode = timeout ? 'PARSE_TIMEOUT' : corruptStoredReport ? 'REPORT_CORRUPT' : validationFailure ? 'VALIDATION_FAILED' : scoringFailure ? 'SCORING_FAILED' : 'PARSE_FAILED';
    const errorMessage = timeout ? 'Превышено время разбора демо.' : validationFailure
      ? 'Нормализованные данные не прошли обязательную валидацию.'
      : corruptStoredReport ? 'Сохранённый результат повреждён и не может быть пересчитан.'
      : scoringFailure ? 'Не удалось детерминированно построить scoring-отчёт.' : 'Парсер не смог безопасно обработать демо.';
    const failed = await failOwnedJob(jobId, leaseToken, errorCode, errorMessage);
    if (failed) {
      console.error(JSON.stringify({
        level: 'error', event: 'job_failed', stage: lifecycleState.currentStage, code: errorCode,
      }));
    } else {
      console.warn(JSON.stringify({
        level: 'warn', event: 'stale_job_failure_ignored', stage: lifecycleState.currentStage, code: errorCode,
      }));
    }
  }
}
