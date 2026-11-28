import { Inject, Injectable } from '@nestjs/common';
import { ApplicationError } from '../application-error.js';
import {
  ArtifactDeletionPort,
  ClockPort,
  MatchCommandPort,
} from '../ports.js';

@Injectable()
export class DeleteMatch {
  constructor(
    @Inject(MatchCommandPort) private readonly matches: MatchCommandPort,
    @Inject(ArtifactDeletionPort) private readonly artifacts: ArtifactDeletionPort,
    @Inject(ClockPort) private readonly clock: ClockPort,
  ) {}

  async execute(id: string): Promise<void> {
    const deletion = await this.matches.beginMatchDeletion(id, this.clock.now());
    if (deletion.kind === 'MATCH_NOT_FOUND') {
      throw new ApplicationError('MATCH_NOT_FOUND', 'Матч не найден.', 404);
    }
    if (deletion.kind === 'MATCH_ACTIVE' || deletion.kind === 'CONCURRENT_WRITE') {
      throw new ApplicationError('MATCH_ACTIVE', 'Активный анализ необходимо завершить перед удалением матча.', 409);
    }

    const { match } = deletion;
    const files = new Set<string>();
    for (const candidate of [
      match.rawFilePath,
      match.normalizedFilePath,
      match.resultFilePath,
      match.evpFilePath,
      ...match.reports.map((report) => report.jsonFilePath),
    ]) {
      if (candidate) files.add(candidate);
    }
    await this.artifacts.deleteMatchFiles(id, files);
    const completion = await this.matches.completeMatchDeletion(id);
    if (completion.kind === 'CONCURRENT_WRITE') {
      throw new ApplicationError('STORAGE_FAILURE', 'Не удалось завершить удаление матча.', 503);
    }
  }
}
