import { Injectable } from '@nestjs/common';
import {
  type ReplayIndexArtifact,
  type ReplayRoundArtifact,
} from '@who-ruined/contracts';
import {
  ArtifactError,
  parseReplayIndex,
  parseReplayRound,
  replayIndexRelative,
  replayRoundRelative,
} from '@who-ruined/artifacts';
import type { ReplayReaderPort } from '../application/ports.js';
import { ApplicationError } from '../application/application-error.js';
import { BoundedGzipError, readBoundedGzipJson } from '../bounded-gzip.js';

@Injectable()
export class StoredReplayReader implements ReplayReaderPort {
  async readIndex(matchId: string, fileSha256: string): Promise<ReplayIndexArtifact | null> {
    let decoded: unknown;
    try {
      decoded = await readBoundedGzipJson(replayIndexRelative(matchId, fileSha256));
    } catch (error) {
      if (error instanceof BoundedGzipError && error.reason === 'MISSING') return null;
      throw new ApplicationError('REPLAY_CORRUPT', 'Индекс 2D-реконструкции недоступен или повреждён.', 409);
    }

    try {
      return parseReplayIndex(decoded, { matchId, fileSha256 });
    } catch (error) {
      if (error instanceof ArtifactError && error.reason === 'SCHEMA_MISMATCH') {
        throw new ApplicationError('REPLAY_CORRUPT', 'Индекс 2D-реконструкции не соответствует поддерживаемой схеме.', 409);
      }
      if (error instanceof ArtifactError && error.reason === 'BINDING_MISMATCH') {
        throw new ApplicationError('REPLAY_CORRUPT', 'Replay-артефакт привязан к другому матчу.', 409);
      }
      throw new ApplicationError('REPLAY_CORRUPT', 'Нарушена целостность индекса 2D-реконструкции.', 409);
    }
  }

  async readRound(index: ReplayIndexArtifact, roundId: string): Promise<ReplayRoundArtifact> {
    const summary = index.rounds.find((round) => round.id === roundId);
    if (!summary) {
      throw new ApplicationError('REPLAY_ROUND_NOT_FOUND', 'Раунд отсутствует в 2D-реконструкции.', 404);
    }

    let decoded: unknown;
    try {
      decoded = await readBoundedGzipJson(
        replayRoundRelative(index.binding.matchId, index.binding.fileSha256, roundId),
        summary.sha256,
      );
    } catch {
      throw new ApplicationError('REPLAY_CORRUPT', 'Данные раунда 2D-реконструкции недоступны или повреждены.', 409);
    }

    try {
      return parseReplayRound(decoded, {
        matchId: index.binding.matchId,
        fileSha256: index.binding.fileSha256,
        roundId,
        sampleCount: summary.sampleCount,
        eventCount: summary.eventCount,
      });
    } catch (error) {
      if (error instanceof ArtifactError && error.reason === 'SCHEMA_MISMATCH') {
        throw new ApplicationError('REPLAY_CORRUPT', 'Данные раунда 2D-реконструкции не соответствуют поддерживаемой схеме.', 409);
      }
      if (error instanceof ArtifactError && error.reason === 'BINDING_MISMATCH') {
        throw new ApplicationError('REPLAY_CORRUPT', 'Replay-артефакт привязан к другому матчу.', 409);
      }
      throw new ApplicationError('REPLAY_CORRUPT', 'Индекс и данные раунда 2D-реконструкции не совпадают.', 409);
    }
  }
}
