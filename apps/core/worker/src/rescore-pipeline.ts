import {
  canonicalMatchResultSchema,
  evpPolicyId,
  evpReportSchemaVersion,
} from '@who-ruined/contracts';
import { evpReportBinding } from '@who-ruined/artifacts';
import { completeOwnedJob } from '@who-ruined/database';
import { scoreMatch } from '@who-ruined/scoring';
import type { WorkerRuntimeConfig } from './runtime-config.js';
import {
  publishCanonicalMatchResult,
  readCanonicalMatchResult,
  removeOwnedResult,
} from './match-result-storage.js';
import {
  reachOwnedStage,
  runPostCommitCleanup,
  type JobFaultHooks,
} from './job-lifecycle.js';
import {
  persistScoringReport,
  requestedScoringConfig,
  scoreStoredArtifact,
} from './report-storage.js';
import { readStoredEvpReport } from './evp-report-storage.js';

export interface RescoreJobInput {
  requestedScoringVersion: string | null;
  requestedConfigHash: string | null;
}

export interface RescoreMatchInput {
  resultFilePath: string | null;
  resultSha256: string | null;
  normalizedFilePath: string | null;
  evpFilePath: string | null;
  evpSchemaVersion: string | null;
  evpSha256: string | null;
  evpPolicyId: string | null;
  evpBindingDigest: string | null;
}

async function assertEvpPointerCurrent(
  dataRoot: string,
  match: RescoreMatchInput,
  current: Parameters<typeof evpReportBinding>[0],
): Promise<void> {
  const pointer = [
    match.evpFilePath,
    match.evpSchemaVersion,
    match.evpSha256,
    match.evpPolicyId,
    match.evpBindingDigest,
  ];
  if (pointer.every((value) => value === null)) return;
  if (pointer.some((value) => value === null)) throw new Error('REPORT_CORRUPT');
  if (match.evpSchemaVersion !== evpReportSchemaVersion || match.evpPolicyId !== evpPolicyId) {
    throw new Error('REPORT_CORRUPT');
  }
  const binding = evpReportBinding(current);
  if (binding.inputDigest !== match.evpBindingDigest) throw new Error('REPORT_CORRUPT');
  await readStoredEvpReport(
    dataRoot,
    match.evpFilePath!,
    match.evpSha256!,
    current,
  );
}

export async function runRescorePipeline(options: {
  dataRoot: string;
  jobId: string;
  matchId: string;
  leaseToken: string;
  job: RescoreJobInput;
  match: RescoreMatchInput;
  config: WorkerRuntimeConfig;
  hooks?: JobFaultHooks;
  assertOwned: () => Promise<void>;
}): Promise<void> {
  await reachOwnedStage(
    options.jobId,
    options.leaseToken,
    'SCORING',
    options.config,
    options.hooks,
  );
  const selected = requestedScoringConfig(
    options.job.requestedScoringVersion,
    options.job.requestedConfigHash,
  );

  const previousResultFilePath = options.match.resultFilePath;
  if (previousResultFilePath && options.match.resultSha256) {
    const current = await readCanonicalMatchResult(
      options.dataRoot,
      previousResultFilePath,
      options.match.resultSha256,
    );
    await assertEvpPointerCurrent(options.dataRoot, options.match, current);
    const report = scoreMatch(current.artifact, selected);
    const productionReports = [
      ...current.productionReports.filter(
        (item) => !(
          item.scorerVersion === report.scorerVersion
          && item.configHash === report.configHash
        ),
      ),
      report,
    ];
    const next = canonicalMatchResultSchema.parse({
      ...current,
      createdAt: new Date().toISOString(),
      productionReports,
    });
    if (evpReportBinding(next).inputDigest !== options.match.evpBindingDigest && options.match.evpBindingDigest !== null) {
      throw new Error('REPORT_CORRUPT');
    }
    const published = await publishCanonicalMatchResult(
      options.dataRoot,
      next,
      options.assertOwned,
    );
    await completeOwnedJob({
      jobId: options.jobId,
      matchId: options.matchId,
      leaseToken: options.leaseToken,
      terminal: 'COMPLETED',
      matchData: {
        resultFilePath: published.relativePath,
        resultSha256: published.sha256,
        resultSchemaVersion: next.schemaVersion,
        winningTeamId: report.winningTeamId,
        losingTeamId: report.losingTeamId,
      },
    });
    if (previousResultFilePath !== published.relativePath) {
      await runPostCommitCleanup('superseded_result_cleanup_failed', async () => {
        await removeOwnedResult(options.dataRoot, previousResultFilePath);
      });
    }
    return;
  }

  if (!options.match.normalizedFilePath) throw new Error('SOURCE_DEMO_UNAVAILABLE');
  const report = await scoreStoredArtifact(
    options.dataRoot,
    options.match.normalizedFilePath,
    selected,
  );
  await persistScoringReport({
    dataRoot: options.dataRoot,
    jobId: options.jobId,
    matchId: options.matchId,
    leaseToken: options.leaseToken,
    report,
    assertOwned: options.assertOwned,
  });
  await completeOwnedJob({
    jobId: options.jobId,
    matchId: options.matchId,
    leaseToken: options.leaseToken,
    terminal: 'COMPLETED',
    matchData: {
      winningTeamId: report.winningTeamId,
      losingTeamId: report.losingTeamId,
    },
  });
}
