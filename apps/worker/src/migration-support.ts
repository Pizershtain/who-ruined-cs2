import { readFile } from 'node:fs/promises';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { matchArtifactSchema, type MatchArtifact } from '@who-ruined/contracts';
import { resolveDataPath } from './storage.js';

const unzip = promisify(gunzip);

export async function loadArtifactForMigration(dataRoot: string, relativePath: string): Promise<MatchArtifact> {
  const raw = await unzip(await readFile(resolveDataPath(dataRoot, relativePath)));
  return matchArtifactSchema.parse(JSON.parse(raw.toString('utf8')) as unknown);
}
