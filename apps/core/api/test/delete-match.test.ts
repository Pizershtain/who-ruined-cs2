import { describe, expect, it } from 'vitest';
import {
  ArtifactDeletionPort,
  ClockPort,
  MatchCommandPort,
  type MatchDeletionCompletionResult,
  type MatchDeletionResult,
  type MatchDeletionSnapshot,
} from '../src/application/ports.js';
import { DeleteMatch } from '../src/application/use-cases/delete-match.js';

const requestedAt = new Date('2026-11-03T00:00:00.000Z');

function deletionSnapshot(): MatchDeletionSnapshot {
  return {
    id: 'match-1',
    fileSha256: 'a'.repeat(64),
    map: 'de_dust2',
    status: 'COMPLETED',
    quality: 'VALID',
    createdAt: requestedAt,
    deletionState: null,
    deletionRequestedAt: null,
    rawFilePath: 'uploads/match-1.dem',
    normalizedFilePath: null,
    resultFilePath: 'results/match-1.json.gz',
    resultSha256: 'b'.repeat(64),
    resultPolicyId: null,
    resultPolicyDigest: null,
    evpFilePath: 'experimental/evp/match-1/report.json.gz',
    evpSchemaVersion: 'evp-report@1',
    evpSha256: 'c'.repeat(64),
    evpPolicyId: 'evp-policy@1-experimental',
    evpBindingDigest: 'd'.repeat(64),
    reports: [{ jsonFilePath: 'reports/match-1.json.gz' }],
  };
}

class FakeMatchCommands extends MatchCommandPort {
  beganAt: Date | null = null;
  deleted = false;

  constructor(
    private readonly result: MatchDeletionResult,
    private readonly completion: MatchDeletionCompletionResult = { kind: 'COMPLETED' },
  ) {
    super();
  }

  findUploadDuplicate(): Promise<never> { throw new Error('not used'); }
  admitUploadedMatch(): Promise<never> { throw new Error('not used'); }
  admitRescore(): Promise<never> { throw new Error('not used'); }
  beginMatchDeletion(_id: string, requestedAt: Date): Promise<MatchDeletionResult> {
    this.beganAt = requestedAt;
    return Promise.resolve(this.result);
  }
  completeMatchDeletion(): Promise<MatchDeletionCompletionResult> {
    this.deleted = true;
    return Promise.resolve(this.completion);
  }
}

class FakeArtifactDeletion extends ArtifactDeletionPort {
  deletedFiles: ReadonlySet<string> | null = null;

  constructor(private readonly failure?: Error) { super(); }

  deleteMatchFiles(_matchId: string, relativeFiles: ReadonlySet<string>): Promise<void> {
    this.deletedFiles = relativeFiles;
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve();
  }
}

class FixedClock extends ClockPort {
  now(): Date { return requestedAt; }
  nowMilliseconds(): number { return requestedAt.getTime(); }
}

describe('match deletion job-state policy', () => {
  it('maps an atomic active-job refusal without touching files', async () => {
    const commands = new FakeMatchCommands({ kind: 'MATCH_ACTIVE' });
    const artifacts = new FakeArtifactDeletion();

    await expect(new DeleteMatch(commands, artifacts, new FixedClock()).execute('match-1'))
      .rejects.toMatchObject({ code: 'MATCH_ACTIVE', status: 409 });
    expect(commands.beganAt).toEqual(requestedAt);
    expect(commands.deleted).toBe(false);
    expect(artifacts.deletedFiles).toBeNull();
  });

  it('allows deletion after a job reaches a terminal state', async () => {
    const commands = new FakeMatchCommands({ kind: 'READY', match: deletionSnapshot() });
    const artifacts = new FakeArtifactDeletion();

    await new DeleteMatch(commands, artifacts, new FixedClock()).execute('match-1');

    expect(commands.beganAt).toEqual(requestedAt);
    expect(commands.deleted).toBe(true);
    expect(artifacts.deletedFiles).toEqual(new Set([
      'uploads/match-1.dem',
      'results/match-1.json.gz',
      'experimental/evp/match-1/report.json.gz',
      'reports/match-1.json.gz',
    ]));
  });

  it('leaves the database deletion marker intact when file cleanup fails', async () => {
    const commands = new FakeMatchCommands({ kind: 'READY', match: deletionSnapshot() });
    const artifacts = new FakeArtifactDeletion(new Error('synthetic cleanup failure'));

    await expect(new DeleteMatch(commands, artifacts, new FixedClock()).execute('match-1'))
      .rejects.toThrow('synthetic cleanup failure');

    expect(commands.beganAt).toEqual(requestedAt);
    expect(commands.deleted).toBe(false);
  });

  it('maps exhausted final database-write contention to a typed 503', async () => {
    const commands = new FakeMatchCommands(
      { kind: 'READY', match: deletionSnapshot() },
      { kind: 'CONCURRENT_WRITE' },
    );
    const artifacts = new FakeArtifactDeletion();

    await expect(new DeleteMatch(commands, artifacts, new FixedClock()).execute('match-1'))
      .rejects.toMatchObject({ code: 'STORAGE_FAILURE', status: 503 });

    expect(artifacts.deletedFiles).not.toBeNull();
    expect(commands.deleted).toBe(true);
  });
});
