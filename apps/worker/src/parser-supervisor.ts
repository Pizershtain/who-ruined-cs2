import { stat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOwnedChild } from './owned-child.js';
import { resolveDataPath } from './storage.js';
import type { ReplaySamplingRequest } from '@who-ruined/parser-adapter';

type Request = {
  kind: 'PARSE' | 'REPLAY';
  rawRelative: string;
  outputRelative: string;
  timeoutMs: number;
  killGraceMs: number;
  maxArtifactBytes: number;
  replay?: ReplaySamplingRequest;
};

const parserEntrypoint = fileURLToPath(new URL('./parser-child.js', import.meta.url));
const dataRoot = path.resolve(process.env.DATA_DIR ?? path.resolve(process.cwd(), 'data'));
const abortController = new AbortController();
let accepted = false;

process.once('disconnect', () => {
  abortController.abort();
  if (!accepted) process.exit(125);
});
process.once('SIGTERM', () => abortController.abort());
process.once('SIGINT', () => abortController.abort());

process.once('message', async (value: unknown) => {
  if (accepted) return;
  accepted = true;
  const request = value as Partial<Request>;
  if ((request.kind !== 'PARSE' && request.kind !== 'REPLAY') || typeof request.rawRelative !== 'string' || typeof request.outputRelative !== 'string' ||
      !Number.isSafeInteger(request.timeoutMs) || !Number.isSafeInteger(request.killGraceMs) || !Number.isSafeInteger(request.maxArtifactBytes)) {
    process.send?.({ ok: false, code: 'PARSE_SUPERVISOR_PROTOCOL' });
    process.exit(64);
    return;
  }
  const timeoutMs = request.timeoutMs as number;
  const killGraceMs = request.killGraceMs as number;
  const maxArtifactBytes = request.maxArtifactBytes as number;
  let outputPath: string;
  try {
    outputPath = resolveDataPath(dataRoot, request.outputRelative);
    resolveDataPath(dataRoot, request.rawRelative);
  } catch {
    process.send?.({ ok: false, code: 'PARSE_SUPERVISOR_PROTOCOL' });
    process.exit(64);
    return;
  }
  const encoded = Buffer.from(JSON.stringify({
    kind: request.kind,
    rawRelative: request.rawRelative,
    outputRelative: request.outputRelative,
    maxArtifactBytes,
    ...(request.kind === 'REPLAY' && request.replay ? { replay: {
      tickRate: request.replay.tickRate,
      sampleRateHz: request.replay.sampleRateHz,
      rounds: request.replay.rounds.map((round) => [round.id, round.ordinal, round.startTick, round.freezeEndTick, round.endTick])
    } } : {})
  })).toString('base64url');
  const result = await runOwnedChild({
    entrypoint: parserEntrypoint,
    args: [encoded],
    timeoutMs,
    killGraceMs,
    signal: abortController.signal
  });
  if (result.timedOut || result.aborted || result.code !== 0) {
    await rm(outputPath, { force: true });
    const code = result.timedOut ? 'PARSE_TIMEOUT' : result.aborted ? 'PARENT_DISCONNECTED' : request.kind === 'REPLAY' ? 'REPLAY_PARSE_FAILED' : 'PARSE_FAILED';
    process.send?.({ ok: false, code, durationMs: Math.round(result.durationMs) });
    process.exit(result.timedOut ? 124 : result.aborted ? 125 : 1);
    return;
  }
  try {
    const metadata = await stat(outputPath);
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > maxArtifactBytes) throw new Error('INVALID_OUTPUT');
  } catch {
    await rm(outputPath, { force: true });
    process.send?.({ ok: false, code: 'PARSE_CHILD_OUTPUT_INVALID' });
    process.exit(1);
    return;
  }
  process.send?.({ ok: true, durationMs: Math.round(result.durationMs) });
  process.disconnect?.();
});
