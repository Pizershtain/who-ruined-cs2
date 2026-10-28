import { open, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { parseDemoSnapshot, validateParsedDemoSnapshot } from '@who-ruined/parser-adapter';
import { resolveDataPath } from './storage.js';

const zip = promisify(gzip);
const requestText = process.argv[2];
if (!requestText || requestText.length > 4096) process.exit(64);

type Request = { rawRelative: string; outputRelative: string; maxArtifactBytes: number };
let request: Request;
try {
  request = JSON.parse(Buffer.from(requestText, 'base64url').toString('utf8')) as Request;
} catch {
  process.exit(64);
}

const safeRelative = (value: unknown, prefix: string, suffix: string): value is string =>
  typeof value === 'string' && value.length <= 512 && value.startsWith(prefix) && value.endsWith(suffix) && !value.includes('..');
if (!safeRelative(request.rawRelative, 'uploads/', '.dem') ||
    !safeRelative(request.outputRelative, 'worker-tmp/', '.snapshot.json.gz') ||
    !Number.isSafeInteger(request.maxArtifactBytes) || request.maxArtifactBytes < 1) process.exit(64);

const dataRoot = path.resolve(process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'));
const rawPath = resolveDataPath(dataRoot, request.rawRelative);
const outputPath = resolveDataPath(dataRoot, request.outputRelative);
const temporaryPath = `${outputPath}.${process.pid}.tmp`;

try {
  const snapshot = validateParsedDemoSnapshot(parseDemoSnapshot(rawPath));
  const compressed = await zip(Buffer.from(JSON.stringify(snapshot)));
  if (compressed.length > request.maxArtifactBytes) throw new Error('PARSE_ARTIFACT_TOO_LARGE');
  await mkdir(path.dirname(outputPath), { recursive: true });
  const handle = await open(temporaryPath, 'wx');
  try {
    await handle.writeFile(compressed);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, outputPath);
  process.exitCode = 0;
} catch {
  await rm(temporaryPath, { force: true });
  process.exitCode = 1;
}
