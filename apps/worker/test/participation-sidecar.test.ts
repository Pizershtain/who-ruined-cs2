import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  participationSidecarFingerprint,
} from '@who-ruined/artifacts';
import type {
  C2S2PreparedProfileDto,
  ParticipationSidecar,
} from '@who-ruined/contracts';
import {
  C2S2_MODEL_VERSION,
  C2S2_POLICY_DIGEST,
  C2S2_REFERENCE_VERSION,
  H2_PARTICIPATION_RATING_POLICY,
  HISTORICAL_H1_PARTICIPATION_POLICY_IDENTITY,
  PARTICIPATION_SIDECAR_POLICY_IDENTITIES,
  projectParticipationRatings,
  selectParticipationAwards,
  type ParticipationRatingPreparedProfile,
} from '@who-ruined/scoring';
import {
  PARTICIPATION_SIDECAR_POLICIES,
  PARTICIPATION_SIDECAR_SCHEMA_VERSION,
  classifyParticipation,
  participationSidecarRelativePath,
  persistParticipationSidecar,
  readParticipationSidecar,
  validateParticipationSidecar,
} from '../src/participation-sidecar.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

const classificationInput = {
  globalComplete: true,
  liveStart: 100,
  liveEnd: 200,
  startObserved: true,
  startAlive: true,
  startTeamNum: 2,
  expectedTeamNum: 2,
  disconnectedBeforeStart: false,
  reconnectedBeforeStart: false,
  deathTick: null,
  lifecycle: [],
  gameplayEventCount: 0,
};

const defaultLimits = {
  compressedBytes: 1024 * 1024,
  decompressedBytes: 4 * 1024 * 1024,
  jsonDepth: 128,
};

function prepared(
  profileKey: string,
  teamId: string,
  harm = -0.04,
): C2S2PreparedProfileDto {
  const contribution = {
    status: 'CALCULATED_RESEARCH_ONLY' as const,
    reason: null,
    familyContributions: {
      COMBAT: 0.1,
      SUPPORT: 0,
      DEATH_RELATED: 0,
      DIRECT_HARM: harm,
      CONTEXT: 0,
      OBJECTIVES: 0,
    },
    episodeContributions: [{
      anchorId: 'round_1:harm',
      chosenAxis: 'allyHp',
      family: 'DIRECT_HARM' as const,
      base: harm,
      tags: [],
    }],
  };
  return {
    profileKey,
    playerId: profileKey,
    teamId,
    scenario: 'BOMB',
    rounds: 2,
    validRounds: 2,
    tRounds: 1,
    ctRounds: 1,
    requiredInputStatus: 'COMPLETE',
    p4BPlus: contribution,
    p4CPlus: {
      ...contribution,
      objectiveSignals: {
        'objective:plants': 0,
        'objective:defuses': 0,
      },
    },
  };
}

function withFingerprint(
  value: Omit<ParticipationSidecar, 'fingerprint'>,
): ParticipationSidecar {
  const sidecar = { ...value, fingerprint: '0'.repeat(64) };
  return {
    ...sidecar,
    fingerprint: participationSidecarFingerprint(sidecar),
  };
}

function fixture(): ParticipationSidecar {
  const profiles = Array.from({ length: 10 }, (_, index) => {
    const teamId = index < 5 ? 'team_a' : 'team_b';
    const profile = prepared(`player_${index + 1}`, teamId);
    return {
      profileKey: profile.profileKey,
      playerId: profile.playerId,
      teamId,
      status: 'ELIGIBLE' as const,
      reason: null,
      verifiedRounds: 2,
      absentRounds: 0,
      partialRounds: 0,
      unknownRounds: 0,
      globalExcludedRounds: 0,
      tRounds: 1,
      ctRounds: 1,
      countedRoundIds: ['round_1', 'round_2'],
      excludedRoundIds: [],
      prepared: profile,
    };
  });
  return withFingerprint({
    schemaVersion: PARTICIPATION_SIDECAR_SCHEMA_VERSION,
    createdAt: '2026-10-24T00:00:00.000Z',
    binding: {
      matchId: 'match',
      fileSha256: 'a'.repeat(64),
      parserVersion: '0.42.0',
      normalizerVersion: 'm2.5-0.2.0',
    },
    model: {
      preparedInputModel: C2S2_MODEL_VERSION,
      preparedInputDigest: C2S2_POLICY_DIGEST,
      referenceVersion: C2S2_REFERENCE_VERSION,
      policies: PARTICIPATION_SIDECAR_POLICIES,
    },
    scenario: 'BOMB',
    participation: [],
    profiles,
    provenance: {
      source: 'RAW_DEMO_EVENTS_AND_TICKS',
      lifecycleEvents: [],
      contextTags: [],
      s2AppliedBy: 'synthetic-test',
    },
  });
}

function expectedBinding(value: ParticipationSidecar): ParticipationSidecar['binding'] {
  return value.binding;
}

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'wrc-participation-sidecar-'));
  roots.push(root);
  return root;
}

function targetPath(root: string, relativePath: string): string {
  return path.join(root, ...relativePath.split('/'));
}

async function writeCompressed(
  root: string,
  relativePath: string,
  bytes: Buffer,
): Promise<void> {
  const target = targetPath(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}

function project(value: ParticipationSidecar) {
  const profiles: ParticipationRatingPreparedProfile[] = value.profiles.map((profile) => ({
    profileKey: profile.profileKey,
    playerId: profile.playerId,
    teamId: profile.teamId,
    status: profile.status,
    reason: profile.reason,
    prepared: profile.prepared,
  }));
  return projectParticipationRatings(profiles);
}

describe('player participation state machine', () => {
  it('keeps a post-death disconnect as present and marks a live disconnect partial', () => {
    expect(classifyParticipation({
      ...classificationInput,
      deathTick: 140,
      lifecycle: [{ kind: 'player_disconnect', tick: 150 }],
    }).classification).toBe('PRESENT_VERIFIED');
    expect(classifyParticipation({
      ...classificationInput,
      deathTick: 170,
      lifecycle: [{ kind: 'player_disconnect', tick: 150 }],
    }).classification).toBe('INTERRUPTED_PARTIAL_ROUND');
  });

  it('does not invent absence from silence and separates global boundary failure', () => {
    expect(classifyParticipation({
      ...classificationInput,
      startObserved: false,
      startAlive: null,
      startTeamNum: null,
    }).classification).toBe('PARTICIPATION_UNKNOWN');
    expect(classifyParticipation({
      ...classificationInput,
      globalComplete: false,
    }).classification).toBe('ROUND_GLOBAL_EVIDENCE_MISSING');
  });

  it('requires explicit disconnected non-playing evidence for a full absence', () => {
    expect(classifyParticipation({
      ...classificationInput,
      startAlive: false,
      startTeamNum: 1,
      disconnectedBeforeStart: true,
    }).classification).toBe('ABSENT_FULL_ROUND_VERIFIED');
  });
});

describe('safe participation sidecar codec', () => {
  it('publishes, reads, validates, and reuses the same immutable sidecar', async () => {
    const root = await temporaryRoot();
    const value = fixture();
    let beforeCommitCalls = 0;
    const relativePath = await persistParticipationSidecar(
      root,
      value,
      async () => { beforeCommitCalls += 1; },
      { limits: defaultLimits },
    );

    expect(relativePath).toBe(participationSidecarRelativePath(
      value.binding.matchId,
      value.binding.fileSha256,
    ));
    const stored = JSON.parse(
      gunzipSync(await readFile(targetPath(root, relativePath))).toString('utf8'),
    ) as unknown;
    expect(validateParticipationSidecar(stored)).toEqual(value);
    await expect(readParticipationSidecar(
      root,
      relativePath,
      expectedBinding(value),
      { limits: defaultLimits },
    )).resolves.toEqual(value);
    await expect(persistParticipationSidecar(
      root,
      value,
      async () => { beforeCommitCalls += 1; },
      { limits: defaultLimits },
    )).resolves.toBe(relativePath);
    expect(beforeCommitCalls).toBe(1);
  });

  it('rejects a mismatched fingerprint and nested participation/profile changes', () => {
    const value = fixture();
    expect(() => validateParticipationSidecar({
      ...value,
      fingerprint: 'f'.repeat(64),
    })).toThrow('PARTICIPATION_SIDECAR_INVALID');

    const participationChanged = structuredClone(value);
    participationChanged.participation.push({
      roundId: 'round_1',
      ordinal: 1,
      playerId: 'player_1',
      classification: 'PRESENT_VERIFIED',
      reason: 'SYNTHETIC_TEST_EVIDENCE',
      counted: true,
      side: 'T',
      boundary: { liveStart: 10, liveEnd: 20, complete: true },
      evidence: {
        startObserved: true,
        startAlive: true,
        startTeamNum: 2,
        deathTick: null,
        gameplayEventCount: 1,
        lifecycle: [],
      },
    });
    expect(() => validateParticipationSidecar(participationChanged))
      .toThrow('PARTICIPATION_SIDECAR_INVALID');

    const profileChanged = structuredClone(value);
    profileChanged.profiles[0]!.prepared.rounds += 1;
    expect(() => validateParticipationSidecar(profileChanged))
      .toThrow('PARTICIPATION_SIDECAR_INVALID');
  });

  it('rejects binding, frozen policy, and schema incompatibilities distinctly', async () => {
    const root = await temporaryRoot();
    const value = fixture();
    const relativePath = await persistParticipationSidecar(
      root,
      value,
      undefined,
      { limits: defaultLimits },
    );

    await expect(readParticipationSidecar(root, relativePath, {
      ...value.binding,
      matchId: 'another_match',
    }, { limits: defaultLimits })).rejects.toThrow('PARTICIPATION_SIDECAR_INVALID');

    const policyChanged = structuredClone(value);
    policyChanged.model.policies[0]!.harmMultiplier = 1;
    policyChanged.fingerprint = participationSidecarFingerprint(policyChanged);
    expect(() => validateParticipationSidecar(policyChanged))
      .toThrow('PARTICIPATION_SIDECAR_POLICY_MISMATCH');

    expect(() => validateParticipationSidecar({
      ...value,
      schemaVersion: 'm3c8-c2s2-prepared-sidecar-1',
    })).toThrow('PARTICIPATION_SIDECAR_SCHEMA_MISMATCH');
  });

  it('rejects corrupt gzip, corrupt JSON, and missing files with controlled errors', async () => {
    const root = await temporaryRoot();
    const value = fixture();
    const relativePath = participationSidecarRelativePath(
      value.binding.matchId,
      value.binding.fileSha256,
    );

    await writeCompressed(root, relativePath, Buffer.from('not-gzip'));
    await expect(readParticipationSidecar(
      root,
      relativePath,
      expectedBinding(value),
      { limits: defaultLimits },
    )).rejects.toThrow('PARTICIPATION_SIDECAR_INVALID');

    await writeCompressed(root, relativePath, gzipSync(Buffer.from('{')));
    await expect(readParticipationSidecar(
      root,
      relativePath,
      expectedBinding(value),
      { limits: defaultLimits },
    )).rejects.toThrow('PARTICIPATION_SIDECAR_INVALID');

    await rm(targetPath(root, relativePath));
    await expect(readParticipationSidecar(
      root,
      relativePath,
      expectedBinding(value),
      { limits: defaultLimits },
    )).rejects.toThrow('PARTICIPATION_SIDECAR_UNAVAILABLE_REQUIRES_ORIGINAL_DEMO');
  });

  it('enforces compressed, decompressed, and JSON depth limits', async () => {
    const root = await temporaryRoot();
    const value = fixture();
    const relativePath = participationSidecarRelativePath(
      value.binding.matchId,
      value.binding.fileSha256,
    );

    await writeCompressed(root, relativePath, Buffer.alloc(256, 1));
    await expect(readParticipationSidecar(root, relativePath, expectedBinding(value), {
      limits: { ...defaultLimits, compressedBytes: 32 },
    })).rejects.toThrow('PARTICIPATION_SIDECAR_INVALID');

    await writeCompressed(root, relativePath, gzipSync(Buffer.from(JSON.stringify({
      payload: 'x'.repeat(1024),
    }))));
    await expect(readParticipationSidecar(root, relativePath, expectedBinding(value), {
      limits: { ...defaultLimits, decompressedBytes: 64 },
    })).rejects.toThrow('PARTICIPATION_SIDECAR_INVALID');

    await writeCompressed(root, relativePath, gzipSync(Buffer.from(
      '{"a":{"b":{"c":{"d":true}}}}',
    )));
    await expect(readParticipationSidecar(root, relativePath, expectedBinding(value), {
      limits: { ...defaultLimits, jsonDepth: 3 },
    })).rejects.toThrow('PARTICIPATION_SIDECAR_INVALID');
  });

  it('rejects a junction or symlink that escapes DATA_DIR', async () => {
    const root = await temporaryRoot();
    const outside = await temporaryRoot();
    const value = fixture();
    const relativePath = participationSidecarRelativePath(
      value.binding.matchId,
      value.binding.fileSha256,
    );
    const outsideRelative = relativePath.split('/').slice(1).join('/');
    await writeCompressed(outside, outsideRelative, gzipSync(Buffer.from(JSON.stringify(value))));
    await symlink(
      outside,
      path.join(root, 'experimental'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(readParticipationSidecar(
      root,
      relativePath,
      expectedBinding(value),
      { limits: defaultLimits },
    )).rejects.toThrow('PARTICIPATION_SIDECAR_INVALID');
  });

  it('does not overwrite corrupt or different valid immutable data', async () => {
    const root = await temporaryRoot();
    const value = fixture();
    const relativePath = participationSidecarRelativePath(
      value.binding.matchId,
      value.binding.fileSha256,
    );
    await writeCompressed(root, relativePath, Buffer.from('corrupt'));
    await expect(persistParticipationSidecar(
      root,
      value,
      undefined,
      { limits: defaultLimits },
    )).rejects.toThrow('PARTICIPATION_SIDECAR_INVALID_EXISTING');

    await rm(targetPath(root, relativePath));
    await persistParticipationSidecar(root, value, undefined, { limits: defaultLimits });
    const different = { ...value, createdAt: '2026-10-25T00:00:00.000Z' };
    await expect(persistParticipationSidecar(
      root,
      different,
      undefined,
      { limits: defaultLimits },
    )).rejects.toThrow('PARTICIPATION_SIDECAR_IMMUTABLE_CONFLICT');
  });

  it('keeps concurrent immutable publication deterministic', async () => {
    const root = await temporaryRoot();
    const value = fixture();
    const results = await Promise.all([
      persistParticipationSidecar(root, value, undefined, { limits: defaultLimits }),
      persistParticipationSidecar(root, value, undefined, { limits: defaultLimits }),
    ]);
    expect(new Set(results).size).toBe(1);
    await expect(readParticipationSidecar(
      root,
      results[0]!,
      expectedBinding(value),
      { limits: defaultLimits },
    )).resolves.toEqual(value);
  });

  it('allows only one of two different concurrent values at one immutable path', async () => {
    const root = await temporaryRoot();
    const first = fixture();
    const second = { ...first, createdAt: '2026-10-26T00:00:00.000Z' };
    const results = await Promise.allSettled([
      persistParticipationSidecar(root, first, undefined, { limits: defaultLimits }),
      persistParticipationSidecar(root, second, undefined, { limits: defaultLimits }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({
        message: 'PARTICIPATION_SIDECAR_IMMUTABLE_CONFLICT',
      }),
    });

    const relativePath = participationSidecarRelativePath(
      first.binding.matchId,
      first.binding.fileSha256,
    );
    const stored = await readParticipationSidecar(
      root,
      relativePath,
      expectedBinding(first),
      { limits: defaultLimits },
    );
    expect([first.createdAt, second.createdAt]).toContain(stored.createdAt);
  });
});

describe('frozen historical participation metadata', () => {
  it('reads the legacy two-policy metadata while projecting H2 only', () => {
    const value = fixture();
    const h2 = project(value);
    const awards = selectParticipationAwards(h2, [
      { teamId: 'team_a', score: 13 },
      { teamId: 'team_b', score: 8 },
    ]);
    expect(value.model.policies).toEqual(PARTICIPATION_SIDECAR_POLICY_IDENTITIES);
    expect(value.model.policies[0]).toEqual({
      id: H2_PARTICIPATION_RATING_POLICY.id,
      digest: H2_PARTICIPATION_RATING_POLICY.digest,
      harmMultiplier: H2_PARTICIPATION_RATING_POLICY.harmMultiplier,
    });
    expect(value.model.policies[1]).toEqual(HISTORICAL_H1_PARTICIPATION_POLICY_IDENTITY);
    expect(h2).toHaveLength(10);
    expect(awards.eligiblePoolSize).toBe(10);
    expect(awards.mvp.awardPoolSize).toBe(10);
    for (const row of h2) {
      if (row.status !== 'CALCULATED_RESEARCH_ONLY') {
        throw new Error('synthetic projection unexpectedly unavailable');
      }
      expect(row.finalAttribution.DIRECT_HARM)
        .toBe(2 * row.rawFamilyInputs.DIRECT_HARM);
    }
  });
});
