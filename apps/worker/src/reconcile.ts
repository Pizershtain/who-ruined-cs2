import { access, readdir, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { ACTIVE_JOB_STAGES, prisma } from '@who-ruined/database';
import { assertNoSymlinkComponents, resolveDataPath } from './storage.js';
import { readCanonicalMatchResult } from './match-result-storage.js';

async function currentLeaseTokens(now = new Date()): Promise<Set<string>> {
  const jobs = await prisma.job.findMany({
    where: { status: { in: [...ACTIVE_JOB_STAGES] }, leaseUntil: { gte: now }, leaseToken: { not: null } },
    select: { leaseToken: true }
  });
  return new Set(jobs.flatMap((job) => job.leaseToken ? [job.leaseToken] : []));
}

export async function reconcileWorkerTemp(
  dataRoot: string,
  readActiveTokens: () => Promise<Set<string>> = currentLeaseTokens
): Promise<{ removed: number; retained: number }> {
  const root = resolveDataPath(dataRoot, 'worker-tmp');
  const active = await readActiveTokens();
  let removed = 0;
  let retained = 0;
  async function visit(directory: string): Promise<boolean> {
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
        if (childEmpty) await rmdir(candidate); else empty = false;
        continue;
      }
      const token = entry.name.split('.snapshot.json.gz', 1)[0] ?? '';
      if (!entry.isSymbolicLink() && entry.name.endsWith('.snapshot.json.gz') && active.has(token)) {
        retained += 1;
        empty = false;
      } else {
        await rm(candidate, { force: true });
        removed += 1;
      }
    }
    return empty;
  }
  await visit(root);
  return { removed, retained };
}

type ResultState = Map<string, { referencedPath: string | null; active: boolean }>;

async function currentResultState(): Promise<ResultState> {
  const [matches, activeJobs] = await Promise.all([
    prisma.match.findMany({ select: { id: true, resultFilePath: true } }),
    prisma.job.findMany({ where: { status: { in: [...ACTIVE_JOB_STAGES] } }, select: { matchId: true } })
  ]);
  const active = new Set(activeJobs.map((job) => job.matchId));
  return new Map(matches.map((match) => [match.id, { referencedPath: match.resultFilePath, active: active.has(match.id) }]));
}

/** Remove result versions that are neither referenced nor protected by a live job. */
export async function reconcileOrphanedMatchResults(
  dataRoot: string,
  readState: () => Promise<ResultState> = currentResultState
): Promise<{ removed: number; retained: number }> {
  const root = resolveDataPath(dataRoot, 'results');
  const states = await readState();
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { removed: 0, retained: 0 };
    throw error;
  }
  let removed = 0; let retained = 0;
  for (const entry of entries) {
    const directory = path.join(root, entry.name);
    await assertNoSymlinkComponents(dataRoot, directory);
    if (!entry.isDirectory()) { await rm(directory, { force: true }); removed += 1; continue; }
    const state = states.get(entry.name);
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const target = path.join(directory, child.name);
      const relative = path.relative(dataRoot, target).replaceAll('\\', '/');
      if (state?.active || (!child.isDirectory() && !child.isSymbolicLink() && relative === state?.referencedPath)) {
        retained += 1;
        continue;
      }
      await assertNoSymlinkComponents(dataRoot, target);
      await rm(target, { recursive: child.isDirectory(), force: true });
      removed += 1;
    }
    await rmdir(directory).catch((error) => { if ((error as NodeJS.ErrnoException).code !== 'ENOTEMPTY') throw error; });
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
    if (match.jobs.some((job) => ACTIVE_JOB_STAGES.includes(job.status as (typeof ACTIVE_JOB_STAGES)[number]))) continue;
    const files = new Set<string>();
    for (const candidate of [match.rawFilePath, match.normalizedFilePath, match.resultFilePath, ...match.reports.map((report) => report.jsonFilePath)]) if (candidate) files.add(candidate);
    for (const relative of files) {
      const target = resolveDataPath(dataRoot, relative);
      await assertNoSymlinkComponents(dataRoot, target);
      await rm(target, { force: true });
    }
    for (const directory of [`results/${match.id}`,`reports/${match.id}`,`experimental/c2s2/${match.id}`,`experimental/c2s2-participation/${match.id}`]) {
      const resolved = resolveDataPath(dataRoot, directory);
      try { await access(resolved); await assertNoSymlinkComponents(dataRoot, resolved); await rm(resolved, { recursive: true, force: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    await prisma.match.deleteMany({ where: { id: match.id, deletionState: 'DELETING' } });
    completed += 1;
  }
  return completed;
}
