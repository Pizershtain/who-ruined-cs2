import { access, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileArtifactStore } from '@who-ruined/artifacts';
import type { MatchData } from '@who-ruined/contracts';
import type { ParsedReplaySnapshot } from '@who-ruined/parser-adapter';
import { syntheticValidMatch } from '@who-ruined/testkit';
import {
  buildReplayRoundArtifacts,
  DUST2_REPLAY_CALIBRATION,
  persistReplayArtifacts,
  replayIndexRelative,
  replayRootRelative,
  replayRoundRelative,
} from '../src/replay-artifact.js';
import { resolveWorkerRuntimeConfig } from '../src/runtime-config.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function fixture(): { match: MatchData; snapshot: ParsedReplaySnapshot } {
  const source = syntheticValidMatch();
  const round = source.rounds[0]!;
  const match: MatchData = {
    ...source,
    map: 'de_dust2',
    rounds: [round],
    events: [{
      id: 'synthetic-kill', kind: 'PLAYER_DEATH', roundId: round.id, tick: round.freezeEndTick! + 32,
      actorId: source.players[0]!.id, targetId: source.players[5]!.id, assisterId: null, attrs: {},
      context: { phase: 'LIVE', actorTeamId: source.players[0]!.teamId, targetTeamId: source.players[5]!.teamId, actorSide: 'T', targetSide: 'CT', aliveByTeamId: null, secondsFromFreezeEnd: .5, bombState: 'NOT_PLANTED', actorEquipmentValue: null, actorMoney: null },
      source: { eventName: 'player_death', rowIndex: 0 }
    }]
  };
  const ticks = new Set<number>();
  for (let tick = round.startTick; tick <= round.endTick; tick += 16) ticks.add(tick);
  ticks.add(round.freezeEndTick!); ticks.add(round.endTick);
  const rows = [...ticks].flatMap((tick) => match.players.map((player, index) => ({
    tick, steamid: player.id, X: -1000 + index * 50 + tick / 100, Y: 2000 - index * 20, Z: index,
    yaw: index * 15, pitch: 0, is_alive: !(index === 5 && tick >= round.freezeEndTick! + 32),
    team_num: index < 5 ? 2 : 3
  })));
  return {
    match,
    snapshot: { schemaVersion: 'parser-replay-snapshot@1', tickRate: 64, sampleRateHz: 4, rounds: [{ id: round.id, ordinal: round.ordinal, startTick: round.startTick, freezeEndTick: round.freezeEndTick, endTick: round.endTick }], rows }
  };
}

describe('synthetic replay artifact', () => {
  it('publishes replay rounds and the index readable with the same limits', async () => {
    const { match, snapshot } = fixture();
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'wrc-replay-readable-'));
    roots.push(dataRoot);
    const config = resolveWorkerRuntimeConfig({});

    const index = await persistReplayArtifacts({
      dataRoot,
      match,
      snapshot,
      config,
      assertOwned: async () => undefined,
    });
    const store = new FileArtifactStore(dataRoot, {
      compressedBytes: config.maxResultCompressedBytes,
      decompressedBytes: config.maxResultJsonBytes,
      jsonDepth: config.maxResultJsonDepth,
    });

    await expect(store.readGzipJson(replayRoundRelative(
      match.matchId,
      match.fileSha256,
      match.rounds[0]!.id,
    ))).resolves.toMatchObject({ schemaVersion: 'm4.7-replay-round@1' });
    await expect(store.readGzipJson(replayIndexRelative(
      match.matchId,
      match.fileSha256,
    ))).resolves.toEqual(index);
  });

  it('keeps real signed coordinates, stable roster indexes, deaths, and factual events', () => {
    const { match, snapshot } = fixture();
    const [round] = buildReplayRoundArtifacts(match, snapshot);
    expect(round?.coverage).toBe('COMPLETE');
    expect(round?.frames[0]?.states).toHaveLength(10);
    expect(round?.frames[0]?.states[0]?.[1]).toBeLessThan(0);
    expect(round?.events).toEqual([expect.objectContaining({ id: 'synthetic-kill', kind: 'KILL', actorId: match.players[0]!.id, targetId: match.players[5]!.id })]);
    const afterDeath = round?.frames.find((frame) => frame.tick >= match.rounds[0]!.freezeEndTick! + 32);
    expect(afterDeath?.states[5]?.[6]).toBe(false);
    expect(match.players[0]!.teamId).not.toBe(match.players[5]!.teamId);
  });

  it('preserves missing coordinates as null and marks coverage partial', () => {
    const { match, snapshot } = fixture();
    const first = snapshot.rows.find((row) => row.steamid === match.players[0]!.id)!;
    first.X = null;
    const [round] = buildReplayRoundArtifacts(match, snapshot);
    expect(round?.coverage).toBe('PARTIAL');
    expect(round?.frames[0]?.states[0]?.[1]).toBeNull();
    expect(round?.warnings).toContain('MISSING_COORDINATES');
  });

  it('uses official Dust2 overview metadata for deterministic world-to-map calibration', () => {
    expect(DUST2_REPLAY_CALIBRATION).toMatchObject({ posX: -2476, posY: 3239, scale: 4.4, imageWidth: 1024, imageHeight: 1024 });
  });

  it('does not publish a replay round that exceeds the API decompressed result limit', async () => {
    const { match, snapshot } = fixture();
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'wrc-replay-limits-'));
    roots.push(dataRoot);

    await expect(persistReplayArtifacts({
      dataRoot,
      match,
      snapshot,
      config: resolveWorkerRuntimeConfig({ MAX_RESULT_JSON_BYTES: '128' }),
      assertOwned: async () => undefined,
    })).rejects.toThrow('REPLAY_ROUND_OUTPUT_TOO_LARGE');

    await expect(access(path.join(
      dataRoot,
      ...replayRootRelative(match.matchId, match.fileSha256).split('/'),
    ))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('uses the stricter API compressed limit when replay publication is configured higher', async () => {
    const { match, snapshot } = fixture();
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'wrc-replay-limits-'));
    roots.push(dataRoot);

    await expect(persistReplayArtifacts({
      dataRoot,
      match,
      snapshot,
      config: resolveWorkerRuntimeConfig({
        MAX_REPLAY_ROUND_COMPRESSED_BYTES: '8192',
        MAX_RESULT_COMPRESSED_BYTES: '1024',
      }),
      assertOwned: async () => undefined,
    })).rejects.toThrow('REPLAY_ROUND_TOO_LARGE');

    await expect(access(path.join(
      dataRoot,
      ...replayRootRelative(match.matchId, match.fileSha256).split('/'),
    ))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an over-depth replay round before publication', async () => {
    const { match, snapshot } = fixture();
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'wrc-replay-depth-'));
    roots.push(dataRoot);

    await expect(persistReplayArtifacts({
      dataRoot,
      match,
      snapshot,
      config: resolveWorkerRuntimeConfig({ MAX_RESULT_JSON_DEPTH: '1' }),
      assertOwned: async () => undefined,
    })).rejects.toMatchObject({ reason: 'DEPTH' });
    await expect(access(path.join(
      dataRoot,
      ...replayRootRelative(match.matchId, match.fileSha256).split('/'),
    ))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects an over-depth replay index before publication', async () => {
    const source = fixture();
    const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'wrc-replay-index-depth-'));
    roots.push(dataRoot);
    const match = { ...source.match, rounds: [], events: [] };
    const snapshot = { ...source.snapshot, rounds: [], rows: [] };

    await expect(persistReplayArtifacts({
      dataRoot,
      match,
      snapshot,
      config: resolveWorkerRuntimeConfig({ MAX_RESULT_JSON_DEPTH: '1' }),
      assertOwned: async () => undefined,
    })).rejects.toMatchObject({ reason: 'DEPTH' });
    await expect(access(path.join(
      dataRoot,
      ...replayRootRelative(match.matchId, match.fileSha256).split('/'),
    ))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
