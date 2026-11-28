import { Inject, Injectable } from '@nestjs/common';
import { matchPublicationStateSchema, type MatchPublicationState, type MatchPublications as PublicationPage } from '@who-ruined/contracts';
import { ArtifactReaderPort, MatchPublicationsPort, type StoredMatch } from '../ports.js';
import { StoredMatchAccess } from '../stored-match-access.js';
import { ApplicationError } from '../application-error.js';
import { projectMatchMeasurements } from './match-measurements.js';

@Injectable()
export class MatchPublications {
  constructor(
    @Inject(MatchPublicationsPort) private readonly publications: MatchPublicationsPort,
    @Inject(ArtifactReaderPort) private readonly artifacts: ArtifactReaderPort,
    @Inject(StoredMatchAccess) private readonly matches: StoredMatchAccess,
  ) {}

  async list(after: bigint): Promise<PublicationPage['events']> {
    return this.publications.listPublications(after);
  }

  async state(matchId: string): Promise<MatchPublicationState> {
    const snapshot = await this.publications.publicationState(matchId);
    if (!snapshot) throw new ApplicationError('MATCH_NOT_FOUND', 'Match publication not found.', 404);
    return this.project(matchId, snapshot.revision, snapshot.match);
  }

  async measuredStats(id: string): Promise<MatchPublicationState> {
    return this.project(id, '0', await this.matches.requireRecord(id));
  }

  private async project(matchId: string, revision: string, stored: StoredMatch | null): Promise<MatchPublicationState> {
    const excluded = { schemaVersion: 'match-publication-state@1', state: 'EXCLUDED', matchId, revision } as const;
    if (!stored) return excluded;
    const canonical = await this.artifacts.readCanonicalResult(stored);
    if (canonical.artifact.match.fileSha256 !== stored.fileSha256) {
      throw new ApplicationError('REPORT_CORRUPT', 'Result does not match the uploaded demo.', 409);
    }
    if (canonical.schemaVersion !== 'match-result@2') return excluded;
    const evp = await this.artifacts.readEvpReport(stored, canonical).catch((error: unknown) => {
      // EVP keeps its strict endpoint. Its failure cannot invalidate the separately
      // bound canonical source or turn a missing award into a confirmed zero.
      if (error instanceof ApplicationError && ['REPORT_NOT_READY', 'REPORT_CORRUPT', 'REPORT_POLICY_MISMATCH'].includes(error.code)) return null;
      throw error;
    });
    return matchPublicationStateSchema.parse(projectMatchMeasurements(canonical, stored.createdAt, revision, evp));
  }
}
