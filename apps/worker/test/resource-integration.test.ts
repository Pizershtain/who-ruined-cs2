import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { matchArtifactSchema } from '@who-ruined/contracts';
import { computeMatchAnalytics } from '@who-ruined/features';
import type { ParsedReplaySnapshot } from '@who-ruined/parser-adapter';
import {
  FileArtifactStore,
  parseReplayIndex,
  parseReplayRound,
  replayIndexRelative,
  replayRoundRelative,
} from '@who-ruined/artifacts';
import { buildCanonicalMatchResult } from '@who-ruined/scoring';
import { syntheticValidMatch } from '@who-ruined/testkit';
import {
  publishCanonicalMatchResult,
  readCanonicalMatchResult,
} from '../src/match-result-storage.js';
import { persistReplayArtifacts } from '../src/replay-artifact.js';
import { resolveWorkerRuntimeConfig } from '../src/runtime-config.js';
import { syntheticParticipationSidecar } from './fixtures/synthetic-participation-sidecar.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function replaySnapshot() {
  const match = syntheticValidMatch();
  const ticks = match.rounds.flatMap((round) => {
    const values = [];
    for (let tick = round.startTick; tick <= round.endTick; tick += 16) values.push(tick);
    values.push(round.endTick);
    if (round.freezeEndTick !== null) values.push(round.freezeEndTick);
    return [...new Set(values)];
  });
  return {
    schemaVersion: 'parser-replay-snapshot@1' as const,
    tickRate: 64,
    sampleRateHz: 4,
    rounds: match.rounds.map(({ id, ordinal, startTick, freezeEndTick, endTick }) => ({
      id,
      ordinal,
      startTick,
      freezeEndTick,
      endTick,
    })),
    rows: ticks.flatMap((tick) => match.players.map((player, index) => ({
      tick,
      steamid: player.id,
      X: -1_000 + index * 10,
      Y: 2_000 - index * 10,
      Z: index,
      yaw: index * 10,
      pitch: 0,
      is_alive: true,
    }))),
  } satisfies ParsedReplaySnapshot;
}

describe('synthetic canonical and replay integration', () => {
  it('round-trips H2 and replay independently through immutable artifacts', async () => {
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'wrc-resource-integration-'));
    roots.push(dataRoot);
    const match = syntheticValidMatch();
    const artifact = matchArtifactSchema.parse({
      schemaVersion: 'm2-artifact-1',
      match,
      analytics: computeMatchAnalytics(match),
    });
    const canonical = buildCanonicalMatchResult({
      artifact,
      sidecar: syntheticParticipationSidecar(),
      productionReports: [],
      sourceDemoRetained: false,
      createdAt: '2026-11-05T00:00:00.000Z',
    });

    const published = await publishCanonicalMatchResult(dataRoot, canonical);
    const config = resolveWorkerRuntimeConfig();
    await persistReplayArtifacts({
      dataRoot,
      match,
      snapshot: replaySnapshot(),
      config,
      assertOwned: async () => undefined,
    });

    const storedCanonical = await readCanonicalMatchResult(
      dataRoot,
      published.relativePath,
      published.sha256,
    );
    expect(storedCanonical.activeRating.players).toHaveLength(10);
    for (const player of storedCanonical.activeRating.players) {
      expect(player.rating).not.toBeNull();
      expect(Object.keys(player.rating?.rawFamilyInputs ?? {})).toHaveLength(6);
      expect(Object.keys(player.rating?.finalAttribution ?? {})).toHaveLength(6);
      expect(1 + Object.values(player.rating?.finalAttribution ?? {}).reduce((sum, value) => sum + value, 0))
        .toBeCloseTo(player.rating!.value, 12);
    }

    const store = new FileArtifactStore(dataRoot, {
      compressedBytes: config.maxResultCompressedBytes,
      decompressedBytes: config.maxResultJsonBytes,
      jsonDepth: config.maxResultJsonDepth,
    });
    const index = parseReplayIndex(
      await store.readGzipJson(replayIndexRelative(match.matchId, match.fileSha256)),
      { matchId: match.matchId, fileSha256: match.fileSha256 },
    );
    expect(index.rounds).toHaveLength(match.rounds.length);
    const first = index.rounds[0]!;
    const roundPath = replayRoundRelative(match.matchId, match.fileSha256, first.id);
    expect(parseReplayRound(
      await store.readGzipJson(roundPath, first.sha256),
      {
        matchId: match.matchId,
        fileSha256: match.fileSha256,
        roundId: first.id,
        sampleCount: first.sampleCount,
        eventCount: first.eventCount,
      },
    ).frames).toHaveLength(first.sampleCount);

    const absoluteRoundPath = path.join(dataRoot, ...roundPath.split('/'));
    await mkdir(path.dirname(absoluteRoundPath), { recursive: true });
    await writeFile(absoluteRoundPath, 'synthetic corruption');
    await expect(store.readGzipJson(roundPath, first.sha256))
      .rejects.toMatchObject({ reason: 'CHECKSUM' });
    await expect(readCanonicalMatchResult(
      dataRoot,
      published.relativePath,
      published.sha256,
    )).resolves.toEqual(storedCanonical);
  });
});
