import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import path from 'node:path';
import { matchDataSchema } from '@who-ruined/contracts';
import { prisma } from '@who-ruined/database';
import { assertMatchRelations, normalizeSnapshot } from '@who-ruined/match-domain';
import { toNormalizationInput } from '@who-ruined/parser-adapter';
import { parseInKillableProcess } from './parser-boundary.js';
import {
  buildParticipationSidecar,
  persistParticipationSidecar,
} from './participation-sidecar.js';
import { resolveWorkerRuntimeConfig } from './runtime-config.js';
import { resolveDataPath } from './storage.js';

const dataRoot = path.resolve(process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'));
const ids = process.argv.slice(2).filter((value) => value !== '--all' && value !== '--');
const all = process.argv.includes('--all');
if (!all && !ids.length) {
  throw new Error('Usage: pnpm experimental:participation:prepare -- <matchId...> | --all');
}

async function sha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

const config = resolveWorkerRuntimeConfig();
const matches = await prisma.match.findMany({
  where: all
    ? { status: { in: ['COMPLETED', 'PARTIAL'] } }
    : { id: { in: ids } },
});
let failed = 0;

for (const match of matches) {
  try {
    if (!match.rawFilePath) throw new Error('REQUIRES_ORIGINAL_DEMO');
    const demoPath = resolveDataPath(dataRoot, match.rawFilePath);
    try {
      await access(demoPath);
    } catch {
      throw new Error('REQUIRES_ORIGINAL_DEMO');
    }
    if (await sha256(demoPath) !== match.fileSha256) {
      throw new Error('SOURCE_DEMO_SHA256_MISMATCH');
    }
    const outputKey = createHash('sha256').update(match.id).digest('hex');
    const parsed = await parseInKillableProcess({
      dataRoot,
      rawRelative: match.rawFilePath,
      outputRelative: `worker-tmp/prepare-participation/${process.pid}-${outputKey}.snapshot.json.gz`,
      config,
    });
    const normalized = matchDataSchema.parse(normalizeSnapshot(toNormalizationInput({
      matchId: match.id,
      fileSha256: match.fileSha256,
      snapshot: parsed.snapshot,
    })));
    assertMatchRelations(normalized);
    const relative = await persistParticipationSidecar(
      dataRoot,
      buildParticipationSidecar(parsed.snapshot, normalized, parsed.participation),
    );
    process.stdout.write(`${match.id}\tPASS\t${relative}\n`);
  } catch (error) {
    failed += 1;
    process.stderr.write(
      `${match.id}\tFAIL\t${error instanceof Error ? error.message : 'UNKNOWN'}\n`,
    );
  }
}

for (const id of ids.filter((id) => !matches.some((match) => match.id === id))) {
  failed += 1;
  process.stderr.write(`${id}\tFAIL\tMATCH_NOT_FOUND\n`);
}

await prisma.$disconnect();
if (failed) process.exitCode = 1;
