import { Module } from '@nestjs/common';
import {
  ApiSettingsPort,
  ArtifactDeletionPort,
  ArtifactReaderPort,
  AuditLogPort,
  ClockPort,
  DemoFilePort,
  IdGeneratorPort,
  MatchCommandPort,
  MatchQueryPort,
  MatchPublicationsPort,
  ReplayReaderPort,
} from '../../application/ports.js';
import { StoredMatchAccess } from '../../application/stored-match-access.js';
import { DeleteMatch } from '../../application/use-cases/delete-match.js';
import { IngestDemo } from '../../application/use-cases/ingest-demo.js';
import { MatchQueries } from '../../application/use-cases/match-queries.js';
import { MatchPublications } from '../../application/use-cases/match-publications.js';
import { ReplayQueries } from '../../application/use-cases/replay-queries.js';
import { ReportQueries } from '../../application/use-cases/report-queries.js';
import { RescoreMatch } from '../../application/use-cases/rescore-match.js';
import { LocalArtifactDeletion } from '../../infrastructure/local-artifact-deletion.js';
import { LocalDemoFiles } from '../../infrastructure/local-demo-files.js';
import { PrismaApiRepository } from '../../infrastructure/prisma-api-repository.js';
import { StoredArtifactReader } from '../../infrastructure/stored-artifact-reader.js';
import { StoredReplayReader } from '../../infrastructure/stored-replay-reader.js';
import {
  ConsoleAuditLog,
  CryptoIdGenerator,
  RuntimeApiSettings,
  SystemClock,
} from '../../infrastructure/system-services.js';
import { ReplayController } from '../replay/replay.controller.js';
import { ReportsController } from '../reports/reports.controller.js';
import { MatchesController } from './matches.controller.js';
import { MatchPublicationsController } from './match-publications.controller.js';

@Module({
  controllers: [MatchesController, ReportsController, ReplayController, MatchPublicationsController],
  providers: [
    PrismaApiRepository,
    StoredArtifactReader,
    StoredReplayReader,
    LocalDemoFiles,
    LocalArtifactDeletion,
    RuntimeApiSettings,
    SystemClock,
    CryptoIdGenerator,
    ConsoleAuditLog,
    { provide: MatchQueryPort, useExisting: PrismaApiRepository },
    { provide: MatchPublicationsPort, useExisting: PrismaApiRepository },
    { provide: MatchCommandPort, useExisting: PrismaApiRepository },
    { provide: ArtifactReaderPort, useExisting: StoredArtifactReader },
    { provide: ReplayReaderPort, useExisting: StoredReplayReader },
    { provide: DemoFilePort, useExisting: LocalDemoFiles },
    { provide: ArtifactDeletionPort, useExisting: LocalArtifactDeletion },
    { provide: ApiSettingsPort, useExisting: RuntimeApiSettings },
    { provide: ClockPort, useExisting: SystemClock },
    { provide: IdGeneratorPort, useExisting: CryptoIdGenerator },
    { provide: AuditLogPort, useExisting: ConsoleAuditLog },
    StoredMatchAccess,
    IngestDemo,
    MatchQueries,
    MatchPublications,
    ReportQueries,
    ReplayQueries,
    RescoreMatch,
    DeleteMatch,
  ],
})
export class MatchesModule {}
