import { access, readdir, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import {
  ACTIVE_JOB_STAGES,
  Prisma,
  prisma,
  runSerializedMatchArtifactWrite,
  UNFINISHED_JOB_STATUSES,
  type PrismaClient,
} from '@who-ruined/database';
import { assertNoSymlinkComponents, resolveDataPath } from './storage.js';
import { readCanonicalMatchResult } from './match-result-storage.js';

const SNAPSHOT_SUFFIXES = [
  '.snapshot.json.gz',
  '.replay-snapshot.json.gz',
] as const;

function snapshotLeaseToken(fileName: string): string | null {
  const completeName = fileName.endsWith('.tmp') ? fileName.slice(0, -4) : fileName;
  for (const suffix of SNAPSHOT_SUFFIXES) {
    if (!completeName.endsWith(suffix)) continue;
    const token = completeName.slice(0, -suffix.length);
    return token.length > 0 ? token : null;
  }
  return null;
}

async function removeEmptyDirectory(directory: string): Promise<boolean> {
  try {
    await rmdir(directory);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return true;
    if (code === 'ENOTEMPTY') return false;
    throw error;
  }
}

type ActiveWorkerLeases = Map<string, string>;

async function currentWorkerLeases(now = new Date()): Promise<ActiveWorkerLeases> {
  const jobs = await prisma.job.findMany({
    where: { status: { in: [...ACTIVE_JOB_STAGES] }, leaseUntil: { gte: now }, leaseToken: { not: null } },
    select: { id: true, leaseToken: true }
  });
  return new Map(jobs.flatMap((job) => job.leaseToken ? [[job.leaseToken, job.id]] : []));
}

export async function reconcileWorkerTemp(
  dataRoot: string,
  readActiveLeases: () => Promise<ActiveWorkerLeases> = currentWorkerLeases
): Promise<{ removed: number; retained: number }> {
  const root = resolveDataPath(dataRoot, 'worker-tmp');
  const active = await readActiveLeases();
  let removed = 0;
  let retained = 0;

  async function isProtectedSnapshot(directory: string, fileName: string): Promise<boolean> {
    const token = snapshotLeaseToken(fileName);
    if (!token) return false;
    const jobId = path.basename(directory);
    if (active.get(token) === jobId) return true;

    // A lease may have been claimed after the initial scan. Refresh before
    // deletion; lease tokens are never reactivated after they become stale.
    const refreshed = await readActiveLeases();
    for (const [activeToken, activeJobId] of refreshed) {
      active.set(activeToken, activeJobId);
    }
    return active.get(token) === jobId;
  }

  async function visit(directory: string): Promise<boolean> {
    await assertNoSymlinkComponents(dataRoot, directory);
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      throw error;
    }
    let empty = true;
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        const childEmpty = await visit(candidate);
        if (childEmpty) {
          if (!(await removeEmptyDirectory(candidate))) empty = false;
        } else {
          empty = false;
        }
        continue;
      }
      if (!entry.isSymbolicLink() && await isProtectedSnapshot(directory, entry.name)) {
        retained += 1;
        empty = false;
      } else {
        if (!entry.isSymbolicLink()) {
          await assertNoSymlinkComponents(dataRoot, candidate);
        }
        await rm(candidate, { force: true });
        removed += 1;
      }
    }
    return empty;
  }
  await visit(root);
  return { removed, retained };
}

interface ResultPointerState {
  referencedPath: string | null;
  evpReferencedPath?: string | null;
  active: boolean;
}

type ResultState = Map<string, ResultPointerState>;

async function currentResultState(
  client: Prisma.TransactionClient,
  matchId: string,
): Promise<ResultPointerState> {
  const [state] = await client.$queryRaw<Array<ResultPointerState>>`
    SELECT
      match."resultFilePath" AS "referencedPath",
      match."evpFilePath" AS "evpReferencedPath",
      EXISTS (
        SELECT 1
        FROM "Job" AS job
        WHERE job."matchId" = ${matchId}
          AND job.status IN (${Prisma.join([...ACTIVE_JOB_STAGES])})
      ) AS active
    FROM "Match" AS match
    WHERE match.id = ${matchId}
  `;
  return state ?? {
    referencedPath: null,
    evpReferencedPath: null,
    active: false,
  };
}

export interface OrphanReconciliationOptions {
  client?: PrismaClient;
  readState?: () => Promise<ResultState>;
  afterMatchLock?: (matchId: string) => void | Promise<void>;
}

/** Remove result versions that are neither referenced nor protected by a live job. */
export async function reconcileOrphanedMatchResults(
  dataRoot: string,
  options: OrphanReconciliationOptions = {},
): Promise<{ removed: number; retained: number }> {
  const overrideStates = options.readState ? await options.readState() : null;
  const client = options.client ?? prisma;
  let removed = 0; let retained = 0;
  const directoriesByMatch = new Map<string, Array<{
    directory: string;
    referencedPath: (state: ResultPointerState) => string | null | undefined;
  }>>();
  async function collectRoot(
    rootRelative: string,
    referencedPath: (state: ResultPointerState) => string | null | undefined,
  ): Promise<void> {
    const root = resolveDataPath(dataRoot, rootRelative);
    let entries;
    try { entries = await readdir(root, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const directory = path.join(root, entry.name);
      await assertNoSymlinkComponents(dataRoot, directory);
      if (!entry.isDirectory()) { await rm(directory, { force: true }); removed += 1; continue; }
      const directories = directoriesByMatch.get(entry.name) ?? [];
      directories.push({ directory, referencedPath });
      directoriesByMatch.set(entry.name, directories);
    }
  }
  await collectRoot('results', (state) => state.referencedPath);
  await collectRoot('experimental/evp', (state) => state.evpReferencedPath);

  for (const [matchId, directories] of directoriesByMatch) {
    const reconcileMatch = async (state: ResultPointerState): Promise<void> => {
      for (const { directory, referencedPath } of directories) {
        const children = await readdir(directory, { withFileTypes: true });
        for (const child of children) {
          const target = path.join(directory, child.name);
          const relative = path.relative(dataRoot, target).replaceAll('\\', '/');
          if (state.active || (!child.isDirectory() && !child.isSymbolicLink() && relative === referencedPath(state))) {
            retained += 1;
            continue;
          }
          await assertNoSymlinkComponents(dataRoot, target);
          await rm(target, { recursive: child.isDirectory(), force: true });
          removed += 1;
        }
        await rmdir(directory).catch((error) => { if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error; });
      }
    };
    if (overrideStates) {
      await reconcileMatch(overrideStates.get(matchId) ?? {
        referencedPath: null,
        evpReferencedPath: null,
        active: false,
      });
    } else {
      await runSerializedMatchArtifactWrite(client, matchId, async (transaction) => {
        await options.afterMatchLock?.(matchId);
        await reconcileMatch(await currentResultState(transaction, matchId));
      }, Prisma.TransactionIsolationLevel.ReadCommitted);
    }
  }
  return { removed, retained };
}

export async function reconcilePublishedSourceCleanup(dataRoot: string, retainSourceDemo: boolean): Promise<{ removed: number; retained: number }> {
  const matches = await prisma.match.findMany({
    where: { resultFilePath: { not: null }, resultSha256: { not: null }, rawFilePath: { not: null }, deletionState: null },
    select: { id: true, resultFilePath: true, resultSha256: true, rawFilePath: true }
  });
  let removed = 0; let retained = 0;
  for (const match of matches) {
    if (retainSourceDemo) { retained += 1; continue; }
    const active = await prisma.job.count({ where: { matchId: match.id, status: { in: [...ACTIVE_JOB_STAGES] } } });
    const shared = await prisma.match.count({ where: { rawFilePath: match.rawFilePath!, id: { not: match.id } } });
    if (active || shared) { retained += 1; continue; }
    try { await readCanonicalMatchResult(dataRoot, match.resultFilePath!, match.resultSha256!); }
    catch { retained += 1; continue; }
    const rawTarget = resolveDataPath(dataRoot, match.rawFilePath!);
    await assertNoSymlinkComponents(dataRoot, rawTarget);
    await rm(rawTarget, { force: true });
    const updated = await prisma.match.updateMany({
      where: { id: match.id, rawFilePath: match.rawFilePath, resultFilePath: match.resultFilePath, resultSha256: match.resultSha256 },
      data: { rawFilePath: null, sourceDeletedAt: new Date() }
    });
    removed += updated.count;
  }
  return { removed, retained };
}

export async function reconcileDeletingMatches(dataRoot: string): Promise<number> {
  const matches = await prisma.match.findMany({ where: { deletionState: 'DELETING' }, include: { jobs: true, reports: true } });
  let completed = 0;
  for (const match of matches) {
    if (match.jobs.some((job) => UNFINISHED_JOB_STATUSES.includes(
      job.status as (typeof UNFINISHED_JOB_STATUSES)[number],
    ))) continue;
    const files = new Set<string>();
    for (const candidate of [match.rawFilePath, match.normalizedFilePath, match.resultFilePath, match.evpFilePath, ...match.reports.map((report) => report.jsonFilePath)]) if (candidate) files.add(candidate);
    for (const relative of files) {
      const target = resolveDataPath(dataRoot, relative);
      await assertNoSymlinkComponents(dataRoot, target);
      await rm(target, { force: true });
    }
    for (const directory of [`results/${match.id}`,`reports/${match.id}`,`experimental/c2s2/${match.id}`,`experimental/c2s2-participation/${match.id}`,`experimental/evp/${match.id}`]) {
      const resolved = resolveDataPath(dataRoot, directory);
      try { await access(resolved); await assertNoSymlinkComponents(dataRoot, resolved); await rm(resolved, { recursive: true, force: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    await prisma.match.deleteMany({ where: { id: match.id, deletionState: 'DELETING' } });
    completed += 1;
  }
  return completed;
}
