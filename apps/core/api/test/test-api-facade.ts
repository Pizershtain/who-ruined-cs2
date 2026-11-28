import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { StoredMatchAccess } from '../src/application/stored-match-access.js';
import { DeleteMatch } from '../src/application/use-cases/delete-match.js';
import { IngestDemo } from '../src/application/use-cases/ingest-demo.js';
import { MatchQueries } from '../src/application/use-cases/match-queries.js';
import { ReplayQueries } from '../src/application/use-cases/replay-queries.js';
import { ReportQueries } from '../src/application/use-cases/report-queries.js';
import { RescoreMatch } from '../src/application/use-cases/rescore-match.js';
import { LocalArtifactDeletion } from '../src/infrastructure/local-artifact-deletion.js';
import { LocalDemoFiles } from '../src/infrastructure/local-demo-files.js';
import { PrismaApiRepository } from '../src/infrastructure/prisma-api-repository.js';
import { StoredArtifactReader } from '../src/infrastructure/stored-artifact-reader.js';
import { StoredReplayReader } from '../src/infrastructure/stored-replay-reader.js';
import {
  ConsoleAuditLog,
  CryptoIdGenerator,
  RuntimeApiSettings,
  SystemClock,
} from '../src/infrastructure/system-services.js';

export function createTestApiFacade() {
  const repository = new PrismaApiRepository();
  const artifacts = new StoredArtifactReader();
  const settings = new RuntimeApiSettings();
  const clock = new SystemClock();
  const ids = new CryptoIdGenerator();
  const storedMatches = new StoredMatchAccess(repository, artifacts);
  const ingest = new IngestDemo(repository, new LocalDemoFiles(), settings, clock, ids, new ConsoleAuditLog(), artifacts);
  const matchQueries = new MatchQueries(repository, storedMatches);
  const reportQueries = new ReportQueries(repository, artifacts, settings, storedMatches);
  const replayQueries = new ReplayQueries(storedMatches, new StoredReplayReader());
  const rescore = new RescoreMatch(repository, ids, storedMatches, settings);
  const deleteMatch = new DeleteMatch(repository, new LocalArtifactDeletion(), clock);

  return {
    ingest: async (file: Express.Multer.File) => ingest.execute({
      ...file, fileSha256: createHash('sha256').update(await readFile(file.path)).digest('hex'),
    }),
    job: matchQueries.job.bind(matchQueries),
    list: matchQueries.list.bind(matchQueries),
    match: matchQueries.match.bind(matchQueries),
    rounds: matchQueries.rounds.bind(matchQueries),
    analytics: reportQueries.analytics.bind(reportQueries),
    playerAnalytics: reportQueries.playerAnalytics.bind(reportQueries),
    participationRating: reportQueries.participationRating.bind(reportQueries),
    participationExplanation: reportQueries.participationExplanation.bind(reportQueries),
    evp: reportQueries.evp.bind(reportQueries),
    radar: reportQueries.radar.bind(reportQueries),
    report: reportQueries.report.bind(reportQueries),
    playerReport: reportQueries.playerReport.bind(reportQueries),
    replay: replayQueries.metadata.bind(replayQueries),
    replayRound: replayQueries.round.bind(replayQueries),
    rescore: rescore.execute.bind(rescore),
    deleteMatch: deleteMatch.execute.bind(deleteMatch),
  };
}
