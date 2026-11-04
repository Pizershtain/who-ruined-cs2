import { open, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import {
  validateParsedMatchSnapshotEnvelope,
  validateParsedReplaySnapshot,
  type ParsedMatchSnapshotEnvelope,
  type ParsedReplaySnapshot,
  type ReplaySamplingRequest,
} from '@who-ruined/parser-adapter';
import { runOwnedChild } from './owned-child.js';
import { resolveDataPath } from './storage.js';
import type { WorkerRuntimeConfig } from './runtime-config.js';

const unzip = promisify(gunzip);

export function resolveParserChildLaunch(moduleUrl: string): {
  entrypoint: string;
  nodeArguments: readonly string[];
} {
  const runsFromTypeScript = fileURLToPath(moduleUrl).endsWith('.ts');
  return {
    entrypoint: fileURLToPath(new URL(
      runsFromTypeScript ? './parser-child.ts' : './parser-child.js',
      moduleUrl,
    )),
    nodeArguments: runsFromTypeScript ? ['--import', 'tsx'] : [],
  };
}

const parserChildLaunch = resolveParserChildLaunch(import.meta.url);

type ParseChildRequest = {
  kind: 'PARSE' | 'REPLAY';
  rawRelative: string;
  outputRelative: string;
  maxArtifactBytes: number;
  maxArtifactOutputBytes: number;
  replay?: {
    tickRate: number;
    sampleRateHz: number;
    rounds: Array<[string, number, number, number | null, number]>;
  };
};

async function readBoundedFile(filePath: string, maximumBytes: number): Promise<Buffer> {
  const handle = await open(filePath, 'r');
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > maximumBytes) {
      throw new Error('PARSE_CHILD_OUTPUT_INVALID');
    }
    const bytes = Buffer.allocUnsafe(metadata.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (read.bytesRead === 0) throw new Error('PARSE_CHILD_OUTPUT_INVALID');
      offset += read.bytesRead;
    }
    const overflow = Buffer.allocUnsafe(1);
    if ((await handle.read(overflow, 0, 1, bytes.length)).bytesRead !== 0) {
      throw new Error('PARSE_CHILD_OUTPUT_INVALID');
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

async function readChildJson(
  outputPath: string,
  compressedLimit: number,
  decompressedLimit: number,
): Promise<unknown> {
  try {
    const decoded = await readAndUnzipChildOutput(
      outputPath,
      compressedLimit,
      decompressedLimit,
    );
    return JSON.parse(decoded.toString('utf8')) as unknown;
  } catch (error) {
    throw new Error('PARSE_CHILD_OUTPUT_INVALID', { cause: error });
  }
}

async function readAndUnzipChildOutput(
  outputPath: string,
  compressedLimit: number,
  decompressedLimit: number,
): Promise<Buffer> {
  const compressed = await readBoundedFile(outputPath, compressedLimit);
  return unzip(compressed, { maxOutputLength: decompressedLimit });
}

async function runParserChild(options: {
  dataRoot: string;
  outputRelative: string;
  request: ParseChildRequest;
  timeoutMs: number;
  killGraceMs: number;
  compressedLimit: number;
  decompressedLimit: number;
  signal?: AbortSignal;
  childEntrypoint?: string;
}): Promise<unknown> {
  const outputPath = resolveDataPath(options.dataRoot, options.outputRelative);
  const encoded = Buffer.from(JSON.stringify(options.request)).toString('base64url');
  console.log(JSON.stringify({
    level: 'info',
    event: 'childSpawned',
    kind: options.request.kind === 'PARSE' ? 'parser-child' : 'replay-parser-child',
  }));
  try {
    const result = await runOwnedChild({
      entrypoint: options.childEntrypoint ?? parserChildLaunch.entrypoint,
      ...(!options.childEntrypoint && parserChildLaunch.nodeArguments.length > 0
        ? { nodeArguments: parserChildLaunch.nodeArguments }
        : {}),
      args: [encoded],
      timeoutMs: options.timeoutMs,
      killGraceMs: options.killGraceMs,
      environment: { ...process.env, DATA_DIR: options.dataRoot },
      ...(options.signal ? { signal: options.signal } : {}),
    });
    if (result.timedOut) throw new Error('PARSE_TIMEOUT');
    if (result.aborted) throw new Error('STALE_JOB_OWNER');
    if (result.code !== 0) {
      throw new Error(options.request.kind === 'REPLAY' ? 'REPLAY_PARSE_FAILED' : 'PARSE_FAILED');
    }
    return await readChildJson(
      outputPath,
      options.compressedLimit,
      options.decompressedLimit,
    );
  } finally {
    await Promise.all([
      rm(outputPath, { force: true }),
      rm(`${outputPath}.tmp`, { force: true }),
    ]);
  }
}

export async function parseInKillableProcess(options: {
  dataRoot: string;
  rawRelative: string;
  outputRelative: string;
  config: WorkerRuntimeConfig;
  signal?: AbortSignal;
  /** Programmatic test seam only; never populated from HTTP or environment. */
  childEntrypoint?: string;
}): Promise<ParsedMatchSnapshotEnvelope> {
  const value = await runParserChild({
    dataRoot: options.dataRoot,
    outputRelative: options.outputRelative,
    request: {
      kind: 'PARSE',
      rawRelative: options.rawRelative,
      outputRelative: options.outputRelative,
      maxArtifactBytes: options.config.maxParseArtifactBytes,
      maxArtifactOutputBytes: options.config.maxParseArtifactOutputBytes,
    },
    timeoutMs: options.config.parseTimeoutMs,
    killGraceMs: options.config.childKillGraceMs,
    compressedLimit: options.config.maxParseArtifactBytes,
    decompressedLimit: options.config.maxParseArtifactOutputBytes,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.childEntrypoint ? { childEntrypoint: options.childEntrypoint } : {}),
  });
  try {
    return validateParsedMatchSnapshotEnvelope(value);
  } catch (error) {
    throw new Error('PARSE_CHILD_OUTPUT_INVALID', { cause: error });
  }
}

export async function parseReplayInKillableProcess(options: {
  dataRoot: string;
  rawRelative: string;
  outputRelative: string;
  replay: ReplaySamplingRequest;
  config: WorkerRuntimeConfig;
  signal?: AbortSignal;
  /** Programmatic test seam only; never populated from HTTP or environment. */
  childEntrypoint?: string;
}): Promise<ParsedReplaySnapshot> {
  const value = await runParserChild({
    dataRoot: options.dataRoot,
    outputRelative: options.outputRelative,
    request: {
      kind: 'REPLAY',
      rawRelative: options.rawRelative,
      outputRelative: options.outputRelative,
      maxArtifactBytes: options.config.maxReplayParseArtifactBytes,
      maxArtifactOutputBytes: options.config.maxReplayParseArtifactOutputBytes,
      replay: {
        tickRate: options.replay.tickRate,
        sampleRateHz: options.replay.sampleRateHz,
        rounds: options.replay.rounds.map((round) => [
          round.id,
          round.ordinal,
          round.startTick,
          round.freezeEndTick,
          round.endTick,
        ]),
      },
    },
    timeoutMs: options.config.parseTimeoutMs,
    killGraceMs: options.config.childKillGraceMs,
    compressedLimit: options.config.maxReplayParseArtifactBytes,
    decompressedLimit: options.config.maxReplayParseArtifactOutputBytes,
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.childEntrypoint ? { childEntrypoint: options.childEntrypoint } : {}),
  });
  try {
    return validateParsedReplaySnapshot(value);
  } catch (error) {
    throw new Error('PARSE_CHILD_OUTPUT_INVALID', { cause: error });
  }
}
