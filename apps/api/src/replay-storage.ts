import { createHash } from 'node:crypto';
import {
  replayIndexArtifactSchema, replayRoundArtifactSchema,
  type ReplayIndexArtifact, type ReplayRoundArtifact
} from '@who-ruined/contracts';
import { ApiError } from './safe-exception.filter.js';
import { BoundedGzipError, readBoundedGzipJson } from './bounded-gzip.js';

function replayRootRelative(matchId: string, fileSha256: string): string {
  return `replays/${matchId}/${fileSha256}`;
}

function indexRelative(matchId: string, fileSha256: string): string {
  return `${replayRootRelative(matchId, fileSha256)}/index.m4.7-replay@1.json.gz`;
}

function roundRelative(matchId: string, fileSha256: string, roundId: string): string {
  return `${replayRootRelative(matchId, fileSha256)}/rounds/${roundId}.m4.7-replay-round@1.json.gz`;
}

function fingerprint(index: ReplayIndexArtifact): string {
  const value = { ...index } as Partial<ReplayIndexArtifact>;
  delete value.fingerprint;
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertBinding(value: { binding: { matchId: string; fileSha256: string } }, matchId: string, fileSha256: string): void {
  if (value.binding.matchId !== matchId || value.binding.fileSha256 !== fileSha256) {
    throw new ApiError('REPLAY_CORRUPT', 'Replay-артефакт привязан к другому матчу.', 409);
  }
}

export async function readReplayIndex(matchId: string, fileSha256: string): Promise<ReplayIndexArtifact | null> {
  let decoded: unknown;
  try { decoded = await readBoundedGzipJson(indexRelative(matchId, fileSha256)); }
  catch (error) {
    if (error instanceof BoundedGzipError && error.reason === 'MISSING') return null;
    throw new ApiError('REPLAY_CORRUPT', 'Индекс 2D-реконструкции недоступен или повреждён.', 409);
  }
  const parsed = replayIndexArtifactSchema.safeParse(decoded);
  if (!parsed.success) throw new ApiError('REPLAY_CORRUPT', 'Индекс 2D-реконструкции не соответствует поддерживаемой схеме.', 409);
  assertBinding(parsed.data, matchId, fileSha256);
  if (fingerprint(parsed.data) !== parsed.data.fingerprint) throw new ApiError('REPLAY_CORRUPT', 'Нарушена целостность индекса 2D-реконструкции.', 409);
  return parsed.data;
}

export async function readReplayRound(index: ReplayIndexArtifact, roundId: string): Promise<ReplayRoundArtifact> {
  const summary = index.rounds.find((round) => round.id === roundId);
  if (!summary) throw new ApiError('REPLAY_ROUND_NOT_FOUND', 'Раунд отсутствует в 2D-реконструкции.', 404);
  let decoded: unknown;
  try { decoded = await readBoundedGzipJson(roundRelative(index.binding.matchId, index.binding.fileSha256, roundId), summary.sha256); }
  catch { throw new ApiError('REPLAY_CORRUPT', 'Данные раунда 2D-реконструкции недоступны или повреждены.', 409); }
  const parsed = replayRoundArtifactSchema.safeParse(decoded);
  if (!parsed.success) throw new ApiError('REPLAY_CORRUPT', 'Данные раунда 2D-реконструкции не соответствуют поддерживаемой схеме.', 409);
  assertBinding(parsed.data, index.binding.matchId, index.binding.fileSha256);
  if (parsed.data.round.id !== roundId || parsed.data.frames.length !== summary.sampleCount || parsed.data.events.length !== summary.eventCount) {
    throw new ApiError('REPLAY_CORRUPT', 'Индекс и данные раунда 2D-реконструкции не совпадают.', 409);
  }
  return parsed.data;
}
