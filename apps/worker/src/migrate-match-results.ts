import path from 'node:path';
import { access, stat } from 'node:fs/promises';
import { prisma, ACTIVE_JOB_STAGES } from '@who-ruined/database';
import { participationSidecarSchema } from '@who-ruined/contracts';
import { buildCanonicalMatchResult, scoreMatch, SUCCESSOR_75_25_CONFIG, V1_CONFIG } from '@who-ruined/scoring';
import { participationSidecarRelativePath, readParticipationSidecar } from './participation-sidecar.js';
import { loadArtifactForMigration } from './migration-support.js';
import { publishCanonicalMatchResult } from './match-result-storage.js';
import { resolveDataPath } from './storage.js';
import { resolveWorkerRuntimeConfig } from './runtime-config.js';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply'); const dryRun = args.has('--dry-run');
if (apply === dryRun) throw new Error('Specify exactly one of --dry-run or --apply');
const config = resolveWorkerRuntimeConfig();
const dataRoot = path.resolve(process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'));
const matches = await prisma.match.findMany({ where: { resultFilePath: null }, orderBy: { id: 'asc' } });
const bytes = async (relative: string | null): Promise<number | null> => {
  if (!relative) return null;
  try { return (await stat(resolveDataPath(dataRoot, relative))).size; } catch { return null; }
};
let migratable = 0; let migrated = 0; let blocked = 0;
for (const match of matches) {
  const inventory = { raw: await bytes(match.rawFilePath), cache: await bytes(match.normalizedFilePath), sidecar: null as number|null, reports: 0 };
  try {
    if (match.deletionState) throw new Error('MATCH_DELETION_IN_PROGRESS');
    if (!match.normalizedFilePath) throw new Error(match.rawFilePath ? 'REQUIRES_PREPARATION_FROM_ORIGINAL_DEMO' : 'REQUIRES_ORIGINAL_DEMO');
    const sidecarRelative = participationSidecarRelativePath(match.id, match.fileSha256);
    inventory.sidecar = await bytes(sidecarRelative);
    if (inventory.sidecar === null) {
      if (!match.rawFilePath) throw new Error('REQUIRES_ORIGINAL_DEMO');
      try { await access(resolveDataPath(dataRoot, match.rawFilePath)); } catch { throw new Error('REQUIRES_ORIGINAL_DEMO'); }
      throw new Error('REQUIRES_PREPARED_SIDECAR');
    }
    const active = await prisma.job.count({ where: { matchId: match.id, status: { in: [...ACTIVE_JOB_STAGES] } } });
    if (active) throw new Error('MATCH_ACTIVE');
    const artifact = await loadArtifactForMigration(dataRoot, match.normalizedFilePath);
    const sidecar = participationSidecarSchema.parse(await readParticipationSidecar(dataRoot, sidecarRelative));
    const reports = [scoreMatch(artifact, V1_CONFIG), scoreMatch(artifact, SUCCESSOR_75_25_CONFIG)];
    const legacyReports = await prisma.report.findMany({ where: { matchId: match.id } });
    inventory.reports = (await Promise.all(legacyReports.map((report) => bytes(report.jsonFilePath)))).reduce<number>((sum, value) => sum + (value ?? 0), 0);
    const result = buildCanonicalMatchResult({ artifact, sidecar, productionReports: reports, selector: config.activeRatingPolicy, sourceDemoRetained: match.rawFilePath !== null });
    migratable += 1;
    if (!apply) { process.stdout.write(`${match.id}\tMIGRATABLE\t${JSON.stringify(inventory)}\n`); continue; }
    const published = await publishCanonicalMatchResult(dataRoot, result, async () => {
      const unchanged = await prisma.match.count({ where: { id: match.id, resultFilePath: null, deletionState: null } });
      if (unchanged !== 1) throw new Error('MATCH_RESULT_POINTER_CHANGED');
    });
    const updated = await prisma.match.updateMany({
      where: { id: match.id, resultFilePath: null, deletionState: null },
      data: { resultFilePath: published.relativePath, resultSchemaVersion: result.schemaVersion, resultSha256: published.sha256, resultPolicyId: result.internal.selectedPolicyId, resultPolicyDigest: result.internal.selectedPolicyDigest }
    });
    if (updated.count !== 1) throw new Error('MATCH_RESULT_POINTER_CHANGED');
    migrated += 1; process.stdout.write(`${match.id}\tMIGRATED_PRESERVED_LEGACY\t${JSON.stringify(inventory)}\n`);
  } catch (error) {
    blocked += 1; process.stderr.write(`${match.id}\tBLOCKED\t${error instanceof Error ? error.message : 'UNKNOWN'}\t${JSON.stringify(inventory)}\n`);
  }
}
process.stdout.write(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', matches: matches.length, migratable, migrated, blocked, historicalCleanupPerformed: false }) + '\n');
await prisma.$disconnect();
if (blocked) process.exitCode = 2;
