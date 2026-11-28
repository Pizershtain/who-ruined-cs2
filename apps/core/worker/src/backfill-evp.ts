import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ACTIVE_JOB_STAGES,
  lockMatchArtifacts,
  prisma,
  runSerializedJobWrite,
  type PrismaClient,
} from '@who-ruined/database';
import { evpPolicyId, evpReportSchemaVersion } from '@who-ruined/contracts';
import { evpReportBinding } from '@who-ruined/artifacts';
import { buildEvpReport } from '@who-ruined/scoring';
import { H2_PARTICIPATION_RATING_POLICY } from '@who-ruined/scoring';
import { readCanonicalMatchResult } from './match-result-storage.js';
import { publishEvpReport, readStoredEvpReport } from './evp-report-storage.js';

export interface EvpBackfillOptions {
  client: PrismaClient;
  dataRoot: string;
  mode: 'apply' | 'dry-run';
  matchId?: string;
  writeOutput?: (line: string) => void;
  writeError?: (line: string) => void;
  afterPublishBeforePointer?: () => void | Promise<void>;
}

export interface EvpBackfillSummary {
  mode: EvpBackfillOptions['mode'];
  matches: number;
  created: number;
  reused: number;
  blocked: number;
}

export function parseEvpBackfillArguments(argumentsList: string[]): Pick<EvpBackfillOptions, 'mode' | 'matchId'> {
  const apply = argumentsList.includes('--apply');
  const dryRun = argumentsList.includes('--dry-run');
  if (apply === dryRun) throw new Error('Specify exactly one of --dry-run or --apply');
  const matchArgument = argumentsList.find((argument) => argument.startsWith('--match='));
  const matchId = matchArgument?.slice('--match='.length);
  if (matchArgument && !matchId) throw new Error('EVP_BACKFILL_MATCH_ID_REQUIRED');
  return { mode: apply ? 'apply' : 'dry-run', ...(matchId ? { matchId } : {}) };
}

export async function runEvpBackfill(options: EvpBackfillOptions): Promise<EvpBackfillSummary> {
  const writeOutput = options.writeOutput ?? ((line) => process.stdout.write(line));
  const writeError = options.writeError ?? ((line) => process.stderr.write(line));
  const matches = await options.client.match.findMany({
    where: {
      resultFilePath: { not: null },
      ...(options.matchId ? { id: options.matchId } : {}),
    },
    orderBy: { id: 'asc' },
  });

  let created = 0;
  let reused = 0;
  let blocked = 0;
  for (const match of matches) {
    try {
      if (match.deletionState) throw new Error('MATCH_DELETION_IN_PROGRESS');
      const activeJobs = await options.client.job.count({
        where: { matchId: match.id, status: { in: [...ACTIVE_JOB_STAGES] } },
      });
      if (activeJobs > 0) throw new Error('MATCH_ACTIVE');
      if (!match.resultFilePath || !match.resultSha256) throw new Error('REPORT_NOT_READY');

      const canonical = await readCanonicalMatchResult(
        options.dataRoot,
        match.resultFilePath,
        match.resultSha256,
      );
      if (
        canonical.schemaVersion === 'match-result@1' && (
        canonical.internal.selectedPolicySelector !== H2_PARTICIPATION_RATING_POLICY.selector
        || canonical.internal.selectedPolicyId !== H2_PARTICIPATION_RATING_POLICY.id
        || canonical.internal.selectedPolicyDigest !== H2_PARTICIPATION_RATING_POLICY.digest)
      ) {
        throw new Error('CANONICAL_POLICY_NOT_H2_RUN_RATING_REBUILD_FIRST');
      }
      const binding = evpReportBinding(canonical);
      const pointer = [
        match.evpFilePath,
        match.evpSchemaVersion,
        match.evpSha256,
        match.evpPolicyId,
        match.evpBindingDigest,
      ];
      const pointerAbsent = pointer.every((value) => value === null);
      if (!pointerAbsent && pointer.some((value) => value === null)) {
        throw new Error('EVP_POINTER_INCOMPLETE');
      }
      if (
        !pointerAbsent
        && (
          match.evpSchemaVersion !== evpReportSchemaVersion
          || match.evpPolicyId !== evpPolicyId
          || match.evpBindingDigest !== binding.inputDigest
        )
      ) {
        throw new Error('EVP_POINTER_INCOMPATIBLE');
      }
      if (!pointerAbsent) {
        await readStoredEvpReport(
          options.dataRoot,
          match.evpFilePath!,
          match.evpSha256!,
          canonical,
        );
        reused += 1;
        writeOutput(`${match.id}\tREUSED\n`);
        continue;
      }

      buildEvpReport(canonical, binding);
      if (options.mode === 'dry-run') {
        writeOutput(`${match.id}\tWOULD_CREATE\n`);
        continue;
      }

      await runSerializedJobWrite(options.client, async (transaction) => {
        await lockMatchArtifacts(transaction, match.id);
        const active = await transaction.job.count({
          where: { matchId: match.id, status: { in: [...ACTIVE_JOB_STAGES] } },
        });
        if (active > 0) throw new Error('MATCH_ACTIVE');
        const published = await publishEvpReport(options.dataRoot, canonical, async () => {
          const unchanged = await transaction.match.count({
            where: {
              id: match.id,
              resultFilePath: match.resultFilePath,
              resultSha256: match.resultSha256,
              deletionState: null,
            },
          });
          if (unchanged !== 1) throw new Error('MATCH_RESULT_POINTER_CHANGED');
        });
        await options.afterPublishBeforePointer?.();
        const updated = await transaction.match.updateMany({
          where: {
            id: match.id,
            resultFilePath: match.resultFilePath,
            resultSha256: match.resultSha256,
            deletionState: null,
          },
          data: {
            evpFilePath: published.relativePath,
            evpSchemaVersion: published.report.schemaVersion,
            evpSha256: published.sha256,
            evpPolicyId: published.report.policyId,
            evpBindingDigest: published.report.binding.inputDigest,
          },
        });
        if (updated.count !== 1) throw new Error('MATCH_RESULT_POINTER_CHANGED');
      });
      created += 1;
      writeOutput(`${match.id}\tCREATED\n`);
    } catch (error) {
      blocked += 1;
      writeError(`${match.id}\tBLOCKED\t${error instanceof Error ? error.message : 'UNKNOWN'}\n`);
    }
  }

  if (options.matchId && matches.length === 0) {
    blocked += 1;
    writeError(`${options.matchId}\tBLOCKED\tMATCH_NOT_FOUND_OR_RESULT_NOT_READY\n`);
  }
  return { mode: options.mode, matches: matches.length, created, reused, blocked };
}

async function main(): Promise<void> {
  const argumentsOptions = parseEvpBackfillArguments(process.argv.slice(2));
  const summary = await runEvpBackfill({
    client: prisma,
    dataRoot: path.resolve(process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data')),
    ...argumentsOptions,
  });
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  await prisma.$disconnect();
  if (summary.blocked > 0) process.exitCode = 2;
}

const executedFile = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (executedFile === import.meta.url) await main();
