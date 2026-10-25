import { randomUUID } from 'node:crypto';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzip, gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { prisma } from '@who-ruined/database';
import { matchArtifactSchema, matchDataSchema, type MatchArtifact, type ScoringConfig, type ScoringReport } from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import { normalizeSnapshot } from '@who-ruined/match-domain';
import { parseDemoSnapshot } from '@who-ruined/parser-adapter';
import { SCORING_CONFIGS, scoreMatch, scoringConfigHash, SUCCESSOR_75_25_CONFIG, V1_CONFIG } from '@who-ruined/scoring';
import { resolveDataPath } from './storage.js';
import { buildC2S2PreparedSidecar, persistC2S2PreparedSidecar } from './c2s2-sidecar.js';
import { buildParticipationSidecar, persistParticipationSidecar } from './participation-sidecar.js';

const zip = promisify(gzip);
const unzip = promisify(gunzip);
const dataRoot = path.resolve(process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'));
function safePath(relativePath: string): string { return resolveDataPath(dataRoot, relativePath); }
async function stage(jobId: string, status: string): Promise<void> { await prisma.job.update({ where: { id: jobId }, data: { status, stage: status, leaseUntil: new Date(Date.now() + 120_000) } }); }

async function writeGzipJson(relative: string, temporarySuffix: string, value: unknown): Promise<void> {
  const finalPath = safePath(relative);
  const temporary = `${finalPath}.${temporarySuffix}.tmp`;
  await mkdir(path.dirname(finalPath), { recursive: true });
  await writeFile(temporary, await zip(Buffer.from(JSON.stringify(value))));
  await rename(temporary, finalPath);
}

async function loadArtifact(relativePath: string): Promise<MatchArtifact> {
  const raw = await unzip(await readFile(safePath(relativePath)));
  return matchArtifactSchema.parse(JSON.parse(raw.toString('utf8')) as unknown);
}

export async function scoreStoredArtifact(relativePath: string, config: ScoringConfig): Promise<ScoringReport> {
  return scoreMatch(await loadArtifact(relativePath), config);
}

async function persistReport(matchId: string, report: ScoringReport, suffix: string): Promise<void> {
  const relative = `reports/${matchId}/${report.scorerVersion}-${report.configHash}.json.gz`;
  await writeGzipJson(relative, suffix, report);
  await prisma.report.upsert({
    where: { matchId_scoringVersion_configHash: { matchId, scoringVersion: report.scorerVersion, configHash: report.configHash } },
    create: { id: randomUUID(), matchId, scoringVersion: report.scorerVersion, configHash: report.configHash, jsonFilePath: relative, quality: report.quality },
    update: { jsonFilePath: relative, quality: report.quality, createdAt: new Date() }
  });
}

function requestedConfig(version: string | null, hash: string | null): ScoringConfig {
  const config = SCORING_CONFIGS.find((candidate) => candidate.version === version && scoringConfigHash(candidate) === hash);
  if (!config) throw new Error('UNSUPPORTED_SCORING_CONFIG');
  return config;
}

async function scoreAndPersist(matchId: string, jobId: string, artifact: MatchArtifact, configs: readonly ScoringConfig[]): Promise<ScoringReport[]> {
  const reports: ScoringReport[] = [];
  for (const config of configs) {
    const report = scoreMatch(artifact, config);
    await persistReport(matchId, report, jobId);
    reports.push(report);
  }
  return reports;
}

export async function processJob(jobId: string, matchId: string): Promise<void> {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  const match = await prisma.match.findUnique({ where: { id: matchId } });
  if (!job || !match) throw new Error('Job or match is unavailable');
  let currentStage = job.type === 'RESCORE' ? 'SCORING' : 'PARSING';
  try {
    if (job.type === 'RESCORE') {
      if (!match.normalizedFilePath) throw new Error('M2_ARTIFACT_UNAVAILABLE');
      await stage(jobId, 'SCORING');
      const config = requestedConfig(job.requestedScoringVersion, job.requestedConfigHash);
      const report = await scoreStoredArtifact(match.normalizedFilePath, config);
      await persistReport(matchId, report, jobId);
      await prisma.$transaction([
        prisma.match.update({ where: { id: matchId }, data: { winningTeamId: report?.winningTeamId, losingTeamId: report?.losingTeamId } }),
        prisma.job.update({ where: { id: jobId }, data: { status: 'COMPLETED', stage: 'COMPLETED', leaseUntil: null } })
      ]);
      return;
    }
    if (job.type !== 'PARSE' || !match.rawFilePath) throw new Error('Raw demo is unavailable');
    const started = Date.now();
    await stage(jobId, 'PARSING');
    const snapshot = parseDemoSnapshot(safePath(match.rawFilePath));
    if (Date.now() - started > Number(process.env.PARSE_TIMEOUT_MS ?? 120_000)) throw new Error('PARSE_TIMEOUT');
    currentStage = 'NORMALIZING'; await stage(jobId, currentStage);
    const normalized = normalizeSnapshot({ matchId, fileSha256: match.fileSha256, snapshot });
    currentStage = 'VALIDATING'; await stage(jobId, currentStage);
    const validated = matchDataSchema.parse(normalized);
    if (process.env.ENABLE_EXPERIMENTAL_RATING === '1') {
      const sidecar = buildC2S2PreparedSidecar(snapshot, validated, safePath(match.rawFilePath));
      await persistC2S2PreparedSidecar(dataRoot, sidecar);
    }
    if (process.env.ENABLE_EXPERIMENTAL_PARTICIPATION_RATING === '1') {
      const sidecar = buildParticipationSidecar(snapshot, validated, safePath(match.rawFilePath));
      await persistParticipationSidecar(dataRoot, sidecar);
    }
    currentStage = 'FEATURIZING'; await stage(jobId, currentStage);
    const analytics = computeMatchAnalytics(validated);
    const artifact = matchArtifactSchema.parse({ schemaVersion: 'm2-artifact-1', match: validated, analytics });
    const relative = `cache/${matchId}.json.gz`;
    await writeGzipJson(relative, jobId, artifact);
    currentStage = 'SCORING'; await stage(jobId, currentStage);
    const reports = await scoreAndPersist(matchId, jobId, artifact, [V1_CONFIG, SUCCESSOR_75_25_CONFIG]);
    const defaultReport = reports.find((report) => report.scorerVersion === SUCCESSOR_75_25_CONFIG.version);
    if (!defaultReport) throw new Error('SCORING_REPORT_UNAVAILABLE');
    const terminal = validated.quality === 'VALID' ? 'COMPLETED' : 'PARTIAL';
    await prisma.$transaction([
      prisma.match.update({ where: { id: matchId }, data: { status: terminal, quality: validated.quality, map: validated.map, normalizedFilePath: relative, winningTeamId: defaultReport?.winningTeamId, losingTeamId: defaultReport?.losingTeamId } }),
      prisma.job.update({ where: { id: jobId }, data: { status: terminal, stage: terminal, leaseUntil: null } })
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown worker error';
    const timeout = message === 'PARSE_TIMEOUT';
    const scoringFailure = currentStage === 'SCORING';
    console.error(JSON.stringify({ level: 'error', jobId, matchId, stage: currentStage, message }));
    const errorCode = timeout ? 'PARSE_TIMEOUT' : scoringFailure ? 'SCORING_FAILED' : 'PARSE_FAILED';
    const errorMessage = timeout ? 'Превышено время разбора демо.' : scoringFailure ? 'Не удалось детерминированно построить scoring-отчёт.' : 'Парсер не смог безопасно обработать демо.';
    await prisma.job.update({ where: { id: jobId }, data: { status: 'FAILED', stage: 'FAILED', leaseUntil: null, errorCode, errorMessage } });
    if (job.type === 'PARSE') await prisma.match.update({ where: { id: matchId }, data: { status: 'FAILED', quality: 'UNSUPPORTED' } });
  }
}
