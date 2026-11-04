import { Injectable } from '@nestjs/common';
import { jobStatusSchema } from '@who-ruined/contracts';
import {
  DatabaseConcurrentWriteError,
  prisma,
  runSerializedJobWrite,
  UNFINISHED_JOB_STATUSES,
  type Prisma,
  type PrismaClient,
} from '@who-ruined/database';
import type {
  MatchCommandPort,
  MatchDeletionCompletionResult,
  MatchDeletionResult,
  MatchQueryPort,
  RescoreAdmissionResult,
  RescoreRegistration,
  StoredJob,
  StoredMatch,
  UploadAdmissionResult,
  UploadRegistration,
} from '../application/ports.js';

type AtomicOperation = 'UPLOAD' | 'RESCORE' | 'DELETE';
type TransactionCheckpoint =
  | 'BEFORE_WRITE_LOCK'
  | 'AFTER_WRITE_LOCK'
  | 'AFTER_UPLOAD_MATCH_CREATED';

@Injectable()
export class PrismaApiRepository implements MatchQueryPort, MatchCommandPort {
  protected databaseClient(): PrismaClient {
    return prisma;
  }

  /** Integration-test seam for deterministic transaction interleavings and rollback faults. */
  protected transactionCheckpoint(
    checkpoint: TransactionCheckpoint,
    operation: AtomicOperation,
  ): void | Promise<void> {
    void checkpoint;
    void operation;
  }

  private async serializedWrite<T>(
    operation: AtomicOperation,
    action: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return runSerializedJobWrite(this.databaseClient(), action, {
      beforeWriteLock: () => this.transactionCheckpoint('BEFORE_WRITE_LOCK', operation),
      afterWriteLock: () => this.transactionCheckpoint('AFTER_WRITE_LOCK', operation),
    });
  }

  findMatch(id: string): Promise<StoredMatch | null> {
    return this.databaseClient().match.findUnique({ where: { id } });
  }

  async findJob(id: string): Promise<StoredJob | null> {
    const job = await this.databaseClient().job.findUnique({ where: { id } });
    if (!job) return null;
    const status = jobStatusSchema.safeParse(job.status);
    const stage = jobStatusSchema.safeParse(job.stage);
    if (!status.success || !stage.success) throw new Error('INVALID_STORED_JOB_STATE');
    return { ...job, status: status.data, stage: stage.data };
  }

  listMatches(cursor: string | undefined, take: number): Promise<StoredMatch[]> {
    return this.databaseClient().match.findMany({
      take,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  async findScoringReport(matchId: string, scoringVersion: string, configHash: string) {
    return this.databaseClient().report.findUnique({
      where: { matchId_scoringVersion_configHash: { matchId, scoringVersion, configHash } },
      select: { jsonFilePath: true },
    });
  }

  async admitUploadedMatch(
    input: UploadRegistration,
    maximumQueuedJobs: number,
  ): Promise<UploadAdmissionResult> {
    try {
      return await this.serializedWrite('UPLOAD', async (transaction) => {
        const duplicate = await transaction.match.findUnique({
          where: {
            fileSha256_parserVersion_normalizerVersion: {
              fileSha256: input.fileSha256,
              parserVersion: input.parserVersion,
              normalizerVersion: input.normalizerVersion,
            },
          },
          select: {
            id: true,
            deletionState: true,
            jobs: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true } },
          },
        });
        if (duplicate?.deletionState) return { kind: 'DUPLICATE_DELETING' };
        if (duplicate) return { kind: 'DUPLICATE', match: duplicate };

        const unfinishedJobs = await transaction.job.count({
          where: { status: { in: [...UNFINISHED_JOB_STATUSES] } },
        });
        if (unfinishedJobs >= maximumQueuedJobs) return { kind: 'QUEUE_SATURATED' };

        await transaction.match.create({
          data: {
            id: input.matchId,
            originalFileName: input.originalFileName,
            fileSha256: input.fileSha256,
            status: 'QUEUED',
            parserVersion: input.parserVersion,
            normalizerVersion: input.normalizerVersion,
            rawFilePath: input.rawFilePath,
          },
        });
        await this.transactionCheckpoint('AFTER_UPLOAD_MATCH_CREATED', 'UPLOAD');
        await transaction.job.create({
          data: {
            id: input.jobId,
            matchId: input.matchId,
            type: 'PARSE',
            status: 'QUEUED',
            stage: 'QUEUED',
          },
        });
        return { kind: 'ADMITTED' };
      });
    } catch (error) {
      if (error instanceof DatabaseConcurrentWriteError) return { kind: 'CONCURRENT_WRITE' };
      throw error;
    }
  }

  async admitRescore(
    input: RescoreRegistration,
    maximumQueuedJobs: number,
  ): Promise<RescoreAdmissionResult> {
    try {
      return await this.serializedWrite('RESCORE', async (transaction) => {
        const match = await transaction.match.findUnique({
          where: { id: input.matchId },
          select: {
            deletionState: true,
            normalizedFilePath: true,
            resultFilePath: true,
          },
        });
        if (!match || match.deletionState) return { kind: 'MATCH_NOT_FOUND' };
        if (!match.normalizedFilePath && !match.resultFilePath) {
          return { kind: 'SOURCE_UNAVAILABLE' };
        }

        const duplicate = await transaction.job.findFirst({
          where: {
            matchId: input.matchId,
            type: 'RESCORE',
            requestedScoringVersion: input.scoringVersion,
            requestedConfigHash: input.configHash,
            status: { in: [...UNFINISHED_JOB_STATUSES] },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (duplicate) return { kind: 'DUPLICATE', jobId: duplicate.id };

        const unfinishedJobs = await transaction.job.count({
          where: { status: { in: [...UNFINISHED_JOB_STATUSES] } },
        });
        if (unfinishedJobs >= maximumQueuedJobs) return { kind: 'QUEUE_SATURATED' };

        await transaction.job.create({
          data: {
            id: input.jobId,
            matchId: input.matchId,
            type: 'RESCORE',
            status: 'QUEUED',
            stage: 'QUEUED',
            requestedScoringVersion: input.scoringVersion,
            requestedConfigHash: input.configHash,
          },
        });
        return { kind: 'ADMITTED', jobId: input.jobId };
      });
    } catch (error) {
      if (error instanceof DatabaseConcurrentWriteError) return { kind: 'CONCURRENT_WRITE' };
      throw error;
    }
  }

  async beginMatchDeletion(id: string, requestedAt: Date): Promise<MatchDeletionResult> {
    try {
      return await this.serializedWrite('DELETE', async (transaction) => {
        const match = await transaction.match.findUnique({
          where: { id },
          include: {
            jobs: { select: { status: true } },
            reports: { select: { jsonFilePath: true } },
          },
        });
        if (!match) return { kind: 'MATCH_NOT_FOUND' };
        if (match.deletionState && match.deletionState !== 'DELETING') {
          return { kind: 'MATCH_ACTIVE' };
        }
        if (match.jobs.some((job) => (
          UNFINISHED_JOB_STATUSES as readonly string[]
        ).includes(job.status))) {
          return { kind: 'MATCH_ACTIVE' };
        }

        const deletionRequestedAt = match.deletionRequestedAt ?? requestedAt;
        let deletionSnapshot = match;
        if (match.deletionState !== 'DELETING' || !match.deletionRequestedAt) {
          deletionSnapshot = await transaction.match.update({
            where: { id },
            data: { deletionState: 'DELETING', deletionRequestedAt },
            include: {
              jobs: { select: { status: true } },
              reports: { select: { jsonFilePath: true } },
            },
          });
        }
        const { jobs, ...snapshot } = deletionSnapshot;
        void jobs;
        return {
          kind: 'READY',
          match: {
            ...snapshot,
            deletionState: 'DELETING',
            deletionRequestedAt,
          },
        };
      });
    } catch (error) {
      if (error instanceof DatabaseConcurrentWriteError) return { kind: 'CONCURRENT_WRITE' };
      throw error;
    }
  }

  async completeMatchDeletion(id: string): Promise<MatchDeletionCompletionResult> {
    try {
      await this.serializedWrite('DELETE', async (transaction) => {
        await transaction.match.deleteMany({
          where: { id, deletionState: 'DELETING' },
        });
      });
      return { kind: 'COMPLETED' };
    } catch (error) {
      if (error instanceof DatabaseConcurrentWriteError) return { kind: 'CONCURRENT_WRITE' };
      throw error;
    }
  }
}
