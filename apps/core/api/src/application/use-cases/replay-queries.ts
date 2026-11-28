import { Inject, Injectable } from '@nestjs/common';
import {
  replayMetadataSchema,
  type ReplayMetadata,
  type ReplayRoundArtifact,
} from '@who-ruined/contracts';
import { ApplicationError } from '../application-error.js';
import { ReplayReaderPort } from '../ports.js';
import { StoredMatchAccess } from '../stored-match-access.js';
import { resolveReplayRadar } from '../replay-maps.js';

@Injectable()
export class ReplayQueries {
  constructor(
    @Inject(StoredMatchAccess) private readonly storedMatches: StoredMatchAccess,
    @Inject(ReplayReaderPort) private readonly replay: ReplayReaderPort,
  ) {}

  async metadata(id: string, version: 1 | 2 = 1): Promise<ReplayMetadata> {
    const match = await this.storedMatches.match(id);
    const index = await this.replay.readIndex(match.matchId, match.fileSha256);
    if (!index) {
      return replayMetadataSchema.parse({
        schemaVersion: version === 2 ? 'm4.7-replay-metadata@2' : 'm4.7-replay-metadata@1',
        matchId: match.matchId,
        availability: 'REPLAY_UNAVAILABLE',
        reason: 'REPLAY_UNAVAILABLE',
        map: match.map,
        tickRate: match.tickRate,
        sampleRateHz: null,
        calibration: null,
        players: match.players.map(({ id: playerId, displayName, teamId }) => ({ id: playerId, displayName, teamId })),
        teams: match.teams,
        rounds: match.rounds.map(({ id: roundId, ordinal, startTick, freezeEndTick, endTick }) => ({
          id: roundId,
          ordinal,
          startTick,
          freezeEndTick,
          endTick,
          sampleCount: 0,
          eventCount: 0,
          coverage: null,
        })),
        totalFrames: 0,
        totalCompressedBytes: 0,
        warnings: ['REPLAY_UNAVAILABLE'],
      });
    }
    if (index.map !== match.map) throw new ApplicationError('REPLAY_CORRUPT', 'Replay map does not match the stored match.', 409);
    const calibration = version === 2 ? resolveReplayRadar(index.map, index.calibration) : index.calibration;
    const supported = version === 2 ? calibration !== null : index.map === 'de_dust2' && calibration !== null;
    return replayMetadataSchema.parse({
      schemaVersion: version === 2 ? 'm4.7-replay-metadata@2' : 'm4.7-replay-metadata@1',
      matchId: match.matchId,
      availability: supported ? 'AVAILABLE' : 'UNSUPPORTED_MAP',
      reason: supported ? null : 'UNSUPPORTED_MAP',
      map: index.map,
      tickRate: index.tickRate,
      sampleRateHz: index.sampleRateHz,
      calibration,
      players: index.players,
      teams: index.teams,
      rounds: index.rounds.map((round) => ({
        id: round.id,
        ordinal: round.ordinal,
        startTick: round.startTick,
        freezeEndTick: round.freezeEndTick,
        endTick: round.endTick,
        sampleCount: round.sampleCount,
        eventCount: round.eventCount,
        coverage: round.coverage,
      })),
      totalFrames: index.totalFrames,
      totalCompressedBytes: index.totalCompressedBytes,
      warnings: index.warnings,
    });
  }

  async round(id: string, roundId: string): Promise<ReplayRoundArtifact> {
    const match = await this.storedMatches.match(id);
    const index = await this.replay.readIndex(match.matchId, match.fileSha256);
    if (!index) throw new ApplicationError('REPLAY_UNAVAILABLE', 'Для этого матча координаты 2D-реконструкции не сохранены.', 409);
    return this.replay.readRound(index, roundId);
  }
}
