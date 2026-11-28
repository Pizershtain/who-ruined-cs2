import { randomUUID } from 'node:crypto';
import {
  scoringReportSchema,
  type MatchArtifact,
  type ScoringConfig,
  type ScoringReport,
} from '@who-ruined/contracts';
import { persistOwnedReport } from '@who-ruined/database';
import {
  ArtifactError,
  FileArtifactStore,
  gzipJson,
  parseMatchArtifact,
} from '@who-ruined/artifacts';
import {
  SCORING_CONFIGS,
  scoreMatch,
  scoringConfigHash,
} from '@who-ruined/scoring';
import { resolveWorkerRuntimeConfig } from './runtime-config.js';

function store(dataRoot: string): FileArtifactStore {
  const limits = resolveWorkerRuntimeConfig();
  return new FileArtifactStore(dataRoot, {
    compressedBytes: limits.maxResultCompressedBytes,
    decompressedBytes: limits.maxResultJsonBytes,
    jsonDepth: limits.maxResultJsonDepth,
  });
}

export async function loadMatchArtifact(
  dataRoot: string,
  relativePath: string,
): Promise<MatchArtifact> {
  return parseMatchArtifact(await store(dataRoot).readGzipJson(relativePath));
}

export async function scoreStoredArtifact(
  dataRoot: string,
  relativePath: string,
  config: ScoringConfig,
): Promise<ScoringReport> {
  return scoreMatch(await loadMatchArtifact(dataRoot, relativePath), config);
}

export function requestedScoringConfig(
  version: string | null,
  hash: string | null,
): ScoringConfig {
  const config = SCORING_CONFIGS.find(
    (candidate) => candidate.version === version && scoringConfigHash(candidate) === hash,
  );
  if (!config) throw new Error('UNSUPPORTED_SCORING_CONFIG');
  return config;
}

export async function persistScoringReport(options: {
  dataRoot: string;
  jobId: string;
  matchId: string;
  leaseToken: string;
  report: ScoringReport;
  assertOwned: () => Promise<void>;
}): Promise<'CREATED' | 'REUSED'> {
  const relativePath = 'reports/' + options.matchId + '/'
    + options.report.scorerVersion + '-' + options.report.configHash + '.json.gz';
  const artifacts = store(options.dataRoot);
  let publication: 'CREATED' | 'REUSED';
  try {
    const existing = scoringReportSchema.parse(
      await artifacts.readGzipJson(relativePath),
    );
    if (
      existing.matchId !== options.matchId
      || existing.scorerVersion !== options.report.scorerVersion
      || existing.configHash !== options.report.configHash
    ) {
      throw new Error('IMMUTABLE_REPORT_CONFLICT');
    }
    publication = 'REUSED';
  } catch (error) {
    if (!(error instanceof ArtifactError) || error.reason !== 'MISSING') throw error;
    const bytes = await gzipJson(options.report, artifacts.limits);
    await options.assertOwned();
    publication = (
      await artifacts.publishImmutable(relativePath, bytes, options.assertOwned)
    ).publication;
  }

  await persistOwnedReport({
    jobId: options.jobId,
    matchId: options.matchId,
    leaseToken: options.leaseToken,
    reportId: randomUUID(),
    scoringVersion: options.report.scorerVersion,
    configHash: options.report.configHash,
    jsonFilePath: relativePath,
    quality: options.report.quality,
  });
  return publication;
}
