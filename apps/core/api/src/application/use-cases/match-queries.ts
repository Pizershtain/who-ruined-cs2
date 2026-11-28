import { Inject, Injectable } from '@nestjs/common';
import type { MatchData } from '@who-ruined/contracts';
import { ApplicationError } from '../application-error.js';
import { MatchQueryPort } from '../ports.js';
import { StoredMatchAccess } from '../stored-match-access.js';

@Injectable()
export class MatchQueries {
  constructor(
    @Inject(MatchQueryPort) private readonly repository: MatchQueryPort,
    @Inject(StoredMatchAccess) private readonly storedMatches: StoredMatchAccess,
  ) {}

  async job(id: string) {
    const job = await this.repository.findJob(id);
    if (!job) throw new ApplicationError('JOB_NOT_FOUND', 'Задача не найдена.', 404);
    return {
      id: job.id,
      matchId: job.matchId,
      status: job.status,
      stage: job.stage,
      createdAt: job.createdAt.toISOString(),
      updatedAt: job.updatedAt.toISOString(),
      ...(job.errorCode ? { errorCode: job.errorCode } : {}),
      ...(job.errorMessage ? { message: job.errorMessage } : {}),
    };
  }

  async list(cursor?: string) {
    const rows = await this.repository.listMatches(cursor, 21);
    const items = rows.slice(0, 20).map((match) => ({
      id: match.id,
      map: match.map,
      score: null,
      status: match.status,
      quality: match.quality,
      createdAt: match.createdAt.toISOString(),
    }));
    return { items, ...(rows.length > 20 ? { nextCursor: rows[19]?.id } : {}) };
  }

  match(id: string): Promise<MatchData> {
    return this.storedMatches.match(id);
  }

  async rounds(id: string) {
    return { items: (await this.match(id)).rounds };
  }
}
