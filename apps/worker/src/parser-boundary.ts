import { fork } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import {
  validateParsedDemoSnapshot, validateParsedReplaySnapshot,
  type ParsedDemoSnapshot, type ParsedReplaySnapshot, type ReplaySamplingRequest
} from '@who-ruined/parser-adapter';
import { resolveDataPath } from './storage.js';
import type { WorkerRuntimeConfig } from './runtime-config.js';

const unzip = promisify(gunzip);
const supervisorEntrypoint = fileURLToPath(new URL('./parser-supervisor.js', import.meta.url));

export async function parseInKillableProcess(options: {
  dataRoot: string;
  rawRelative: string;
  outputRelative: string;
  config: WorkerRuntimeConfig;
  signal?: AbortSignal;
  /** Programmatic test seam only; never populated from HTTP or environment. */
  supervisorEntrypoint?: string;
}): Promise<ParsedDemoSnapshot> {
  const outputPath = resolveDataPath(options.dataRoot, options.outputRelative);
  const supervisor = fork(options.supervisorEntrypoint ?? supervisorEntrypoint, [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, DATA_DIR: options.dataRoot }
  });
  const abort = () => { if (supervisor.connected) supervisor.disconnect(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  console.log(JSON.stringify({ level: 'info', event: 'childSpawned', kind: 'parser-supervisor' }));
  try {
    const result = await new Promise<{ ok: boolean; code?: string }>((resolve, reject) => {
      let messageReceived = false;
      supervisor.once('error', reject);
      supervisor.on('message', (message: unknown) => {
        messageReceived = true;
        resolve(message as { ok: boolean; code?: string });
      });
      supervisor.once('exit', (code) => {
        if (!messageReceived) reject(new Error(code === 124 ? 'PARSE_TIMEOUT' : options.signal?.aborted ? 'STALE_JOB_OWNER' : 'PARSE_SUPERVISOR_EXITED'));
      });
      supervisor.send({
        kind: 'PARSE', rawRelative: options.rawRelative, outputRelative: options.outputRelative,
        timeoutMs: options.config.parseTimeoutMs, killGraceMs: options.config.childKillGraceMs,
        maxArtifactBytes: options.config.maxParseArtifactBytes
      });
    });
    if (!result.ok) {
      console.log(JSON.stringify({ level: 'info', event: result.code === 'PARSE_TIMEOUT' ? 'childTimedOut' : 'childExited', code: result.code ?? 'PARSE_FAILED' }));
      throw new Error(result.code ?? 'PARSE_FAILED');
    }
    const compressed = await readFile(outputPath);
    if (compressed.length > options.config.maxParseArtifactBytes) throw new Error('PARSE_CHILD_OUTPUT_INVALID');
    const decoded = await unzip(compressed, { maxOutputLength: options.config.maxParseArtifactOutputBytes });
    return validateParsedDemoSnapshot(JSON.parse(decoded.toString('utf8')) as unknown);
  } finally {
    options.signal?.removeEventListener('abort', abort);
    if (supervisor.connected) supervisor.disconnect();
    await rm(outputPath, { force: true });
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
  supervisorEntrypoint?: string;
}): Promise<ParsedReplaySnapshot> {
  const outputPath = resolveDataPath(options.dataRoot, options.outputRelative);
  const supervisor = fork(options.supervisorEntrypoint ?? supervisorEntrypoint, [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    env: { ...process.env, DATA_DIR: options.dataRoot }
  });
  const abort = () => { if (supervisor.connected) supervisor.disconnect(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  console.log(JSON.stringify({ level: 'info', event: 'childSpawned', kind: 'replay-parser-supervisor' }));
  try {
    const result = await new Promise<{ ok: boolean; code?: string }>((resolve, reject) => {
      let messageReceived = false;
      supervisor.once('error', reject);
      supervisor.on('message', (message: unknown) => {
        messageReceived = true;
        resolve(message as { ok: boolean; code?: string });
      });
      supervisor.once('exit', (code) => {
        if (!messageReceived) reject(new Error(code === 124 ? 'PARSE_TIMEOUT' : options.signal?.aborted ? 'STALE_JOB_OWNER' : 'PARSE_SUPERVISOR_EXITED'));
      });
      supervisor.send({
        kind: 'REPLAY', rawRelative: options.rawRelative, outputRelative: options.outputRelative,
        replay: options.replay,
        timeoutMs: options.config.parseTimeoutMs, killGraceMs: options.config.childKillGraceMs,
        maxArtifactBytes: options.config.maxReplayParseArtifactBytes
      });
    });
    if (!result.ok) throw new Error(result.code ?? 'REPLAY_PARSE_FAILED');
    const compressed = await readFile(outputPath);
    if (compressed.length > options.config.maxReplayParseArtifactBytes) throw new Error('PARSE_CHILD_OUTPUT_INVALID');
    const decoded = await unzip(compressed, { maxOutputLength: options.config.maxReplayParseArtifactOutputBytes });
    return validateParsedReplaySnapshot(JSON.parse(decoded.toString('utf8')) as unknown);
  } finally {
    options.signal?.removeEventListener('abort', abort);
    if (supervisor.connected) supervisor.disconnect();
    await rm(outputPath, { force: true });
  }
}
