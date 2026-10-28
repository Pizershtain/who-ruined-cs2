import path from 'node:path';
import { prisma, ACTIVE_JOB_STAGES } from '@who-ruined/database';
import { P72_POLICIES, rebuildCanonicalMatchResult } from '@who-ruined/scoring';
import { publishCanonicalMatchResult, readCanonicalMatchResult, removeOwnedResult } from './match-result-storage.js';
import { resolveWorkerRuntimeConfig } from './runtime-config.js';

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const dryRun = args.has('--dry-run');
if (apply === dryRun) throw new Error('Specify exactly one of --dry-run or --apply');
const matchArg = [...args].find((arg) => arg.startsWith('--match='));
const selectedMatchId = matchArg?.slice('--match='.length);
const config = resolveWorkerRuntimeConfig();
const target = P72_POLICIES[config.activeRatingPolicy];
const dataRoot = path.resolve(process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'));
const matches = await prisma.match.findMany({
  where: { resultFilePath: { not: null }, ...(selectedMatchId ? { id: selectedMatchId } : {}) },
  orderBy: { id: 'asc' }
});
let ready = 0; let changed = 0; let blocked = 0; let maxReconstructionError = 0; let maxPolicyDeltaError = 0;
for (const match of matches) {
  try {
    if (match.deletionState) throw new Error('MATCH_DELETION_IN_PROGRESS');
    const activeJobs = await prisma.job.count({ where: { matchId: match.id, status: { in: [...ACTIVE_JOB_STAGES] } } });
    if (activeJobs) throw new Error('MATCH_ACTIVE');
    const current = await readCanonicalMatchResult(dataRoot, match.resultFilePath!, match.resultSha256 ?? undefined);
    const h1 = rebuildCanonicalMatchResult(current, 'H1');
    const h2 = rebuildCanonicalMatchResult(current, 'H2');
    const h1ByPlayer = new Map(h1.activeRating.players.map((player) => [player.playerId, player]));
    for (const h2Player of h2.activeRating.players) {
      const h1Player = h1ByPlayer.get(h2Player.playerId);
      if (!h1Player || !h1Player.rating || !h2Player.rating) continue;
      maxReconstructionError = Math.max(maxReconstructionError, Math.abs(h1Player.rating.value - h1Player.rating.arithmetic.reconstructed), Math.abs(h2Player.rating.value - h2Player.rating.arithmetic.reconstructed));
      maxPolicyDeltaError = Math.max(maxPolicyDeltaError, Math.abs((h2Player.rating.value - h1Player.rating.value) - h1Player.rating.rawFamilyInputs.DIRECT_HARM));
    }
    const next = config.activeRatingPolicy === 'H2' ? h2 : h1;
    if (current.internal.selectedPolicyId === target.id && current.internal.selectedPolicyDigest === target.digest) {
      ready += 1; process.stdout.write(`${match.id}\tREADY\n`); continue;
    }
    if (!apply) { changed += 1; process.stdout.write(`${match.id}\tWOULD_REBUILD\n`); continue; }
    const published = await publishCanonicalMatchResult(dataRoot, next, async () => {
      const owned = await prisma.match.count({ where: { id: match.id, resultFilePath: match.resultFilePath, resultSha256: match.resultSha256, deletionState: null } });
      if (owned !== 1) throw new Error('MATCH_RESULT_POINTER_CHANGED');
    });
    await prisma.$transaction(async (transaction) => {
      const active = await transaction.job.count({ where: { matchId: match.id, status: { in: [...ACTIVE_JOB_STAGES] } } });
      if (active) throw new Error('MATCH_ACTIVE');
      const updated = await transaction.match.updateMany({
        where: { id: match.id, resultFilePath: match.resultFilePath, resultSha256: match.resultSha256, deletionState: null },
        data: { resultFilePath: published.relativePath, resultSha256: published.sha256, resultSchemaVersion: next.schemaVersion, resultPolicyId: target.id, resultPolicyDigest: target.digest }
      });
      if (updated.count !== 1) throw new Error('MATCH_RESULT_POINTER_CHANGED');
    });
    if (match.resultFilePath !== published.relativePath) await removeOwnedResult(dataRoot, match.resultFilePath!);
    changed += 1; process.stdout.write(`${match.id}\tREBUILT\n`);
  } catch (error) {
    blocked += 1; process.stderr.write(`${match.id}\tBLOCKED\t${error instanceof Error ? error.message : 'UNKNOWN'}\n`);
  }
}
process.stdout.write(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', target: config.activeRatingPolicy, matches: matches.length, ready, changed, blocked, maxReconstructionError, maxPolicyDeltaError }) + '\n');
await prisma.$disconnect();
if (blocked) process.exitCode = 2;
