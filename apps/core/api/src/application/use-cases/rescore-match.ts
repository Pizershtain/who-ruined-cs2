import { Inject, Injectable } from '@nestjs/common';
import { scoringConfigHash } from '@who-ruined/scoring';
import { ApplicationError } from '../application-error.js';
import { resolveScoringConfig } from '../scoring-config.js';
import {
  ApiSettingsPort,
  IdGeneratorPort,
  MatchCommandPort,
} from '../ports.js';
import { StoredMatchAccess } from '../stored-match-access.js';

export interface RescoreMatchRequest {
  scoringVersion: string;
  configHash?: string;
}

@Injectable()
export class RescoreMatch {
  constructor(
    @Inject(MatchCommandPort) private readonly matches: MatchCommandPort,
    @Inject(IdGeneratorPort) private readonly ids: IdGeneratorPort,
    @Inject(StoredMatchAccess) private readonly storedMatches: StoredMatchAccess,
    @Inject(ApiSettingsPort) private readonly settings: ApiSettingsPort,
  ) {}

  async execute(id: string, request: RescoreMatchRequest): Promise<{
    matchId: string;
    jobId: string;
    scoringVersion: string;
    configHash: string;
  }> {
    const config = resolveScoringConfig(request.scoringVersion, request.configHash);
    const match = await this.storedMatches.requireRecord(id);
    if (!match.normalizedFilePath && !match.resultFilePath) {
      throw new ApplicationError('SOURCE_DEMO_UNAVAILABLE', 'Для rescore нужен сохранённый M2-артефакт или канонический результат.', 409);
    }
    const artifact = await this.storedMatches.load(id);
    if (!artifact.analytics) {
      throw new ApplicationError('INCOMPLETE_MATCH', 'Старый артефакт не содержит M2-аналитику; требуется повторный разбор демо.', 409);
    }
    const jobId = this.ids.create();
    const configHash = scoringConfigHash(config);
    const admission = await this.matches.admitRescore({
      jobId,
      matchId: id,
      scoringVersion: config.version,
      configHash,
    }, this.settings.maxQueuedJobs());
    if (admission.kind === 'MATCH_NOT_FOUND') {
      throw new ApplicationError('MATCH_NOT_FOUND', 'Матч не найден.', 404);
    }
    if (admission.kind === 'SOURCE_UNAVAILABLE') {
      throw new ApplicationError('SOURCE_DEMO_UNAVAILABLE', 'Для rescore нужен сохранённый M2-артефакт или канонический результат.', 409);
    }
    if (admission.kind === 'QUEUE_SATURATED' || admission.kind === 'CONCURRENT_WRITE') {
      throw new ApplicationError('QUEUE_SATURATED', 'Очередь анализа временно заполнена.', 503);
    }
    return {
      matchId: id,
      jobId: admission.jobId,
      scoringVersion: config.version,
      configHash,
    };
  }
}
