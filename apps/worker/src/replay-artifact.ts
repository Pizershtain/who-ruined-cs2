import {
  replayIndexArtifactSchema, replayRoundArtifactSchema,
  type MatchData, type ReplayIndexArtifact, type ReplayMapCalibration, type ReplayRoundArtifact
} from '@who-ruined/contracts';
import {
  ArtifactError,
  gzipJson,
  replayIndexFingerprint,
  replayIndexRelative,
  replayRootRelative,
  replayRoundRelative,
  sha256Bytes,
  verifyReplayIndexFingerprint,
} from '@who-ruined/artifacts';
import { asInteger, asText, NORMALIZER_VERSION, PARSER_LIBRARY_VERSION, type ParsedReplaySnapshot, type UnknownRow } from '@who-ruined/parser-adapter';
import { publishImmutableBytes, resolveDataPath } from './storage.js';
import type { WorkerRuntimeConfig } from './runtime-config.js';

export const REPLAY_SAMPLE_RATE_HZ = 4;
export const DUST2_REPLAY_CALIBRATION: ReplayMapCalibration = {
  id: 'de_dust2-valve-overview-v2@14191',
  map: 'de_dust2',
  imageWidth: 1024,
  imageHeight: 1024,
  posX: -2476,
  posY: 3239,
  scale: 4.4,
  rotate: 1,
  source: 'VALVE_OVERVIEW_METADATA',
  sourceVersion: 'CS2 patch 14191 · resource/overviews/de_dust2.txt',
  imageUrl: null
};

function finite(row: UnknownRow, key: string): number | null {
  const value = row[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function bool(row: UnknownRow, key: string): boolean | null {
  const value = row[key];
  if (typeof value === 'boolean') return value;
  if (value === 0 || value === 1) return value === 1;
  return null;
}

function sampleTicks(round: MatchData['rounds'][number], tickRate: number, sampleRateHz: number): number[] {
  const step = Math.max(1, Math.round(tickRate / sampleRateHz));
  const ticks = new Set<number>();
  for (let tick = round.startTick; tick <= round.endTick; tick += step) ticks.add(tick);
  ticks.add(round.endTick);
  if (round.freezeEndTick !== null) ticks.add(round.freezeEndTick);
  return [...ticks].sort((a, b) => a - b);
}

function roundEvents(match: MatchData, roundId: string): ReplayRoundArtifact['events'] {
  return match.events.flatMap((event) => {
    if (event.roundId !== roundId) return [];
    const kind = event.kind === 'PLAYER_DEATH' ? 'KILL'
      : event.kind === 'BOMB_PLANTED' ? 'BOMB_PLANTED'
        : event.kind === 'BOMB_DEFUSED' ? 'BOMB_DEFUSED' : null;
    return kind ? [{ id: event.id, kind, tick: event.tick, actorId: event.actorId, targetId: event.targetId, assisterId: event.assisterId }] : [];
  });
}

interface ReplayBuildContext {
  playerIndex: Map<string, number>;
  rowsByTick: Map<number, UnknownRow[]>;
}

function replayBuildContext(match: MatchData, snapshot: ParsedReplaySnapshot): ReplayBuildContext {
  const playerIndex = new Map(match.players.map((player, index) => [player.id, index]));
  const rowsByTick = new Map<number, UnknownRow[]>();
  for (const row of snapshot.rows) {
    const tick = asInteger(row, ['tick']);
    if (tick === null) continue;
    const rows = rowsByTick.get(tick) ?? [];
    rows.push(row);
    rowsByTick.set(tick, rows);
  }
  return { playerIndex, rowsByTick };
}

function buildReplayRoundArtifact(
  match: MatchData,
  snapshot: ParsedReplaySnapshot,
  round: MatchData['rounds'][number],
  context: ReplayBuildContext,
): ReplayRoundArtifact {
  if (match.tickRate === null || match.tickRate !== snapshot.tickRate) throw new Error('REPLAY_TICK_RATE_MISMATCH');
  const warnings = new Set<string>();
  const ticks = sampleTicks(round, snapshot.tickRate, snapshot.sampleRateHz);
  const frames = ticks.map((tick) => {
    const seen = new Set<number>();
    const states: ReplayRoundArtifact['frames'][number]['states'] = [];
    for (const row of context.rowsByTick.get(tick) ?? []) {
      const id = asText(row, ['steamid', 'steam_id']);
      const index = id ? context.playerIndex.get(id) : undefined;
      const alive = bool(row, 'is_alive');
      if (index === undefined || seen.has(index) || alive === null) continue;
      seen.add(index);
      const x = finite(row, 'X'); const y = finite(row, 'Y'); const z = finite(row, 'Z');
      if (x === null || y === null || z === null) warnings.add('MISSING_COORDINATES');
      states.push([index, x, y, z, finite(row, 'yaw'), finite(row, 'pitch'), alive]);
    }
    states.sort((a, b) => a[0] - b[0]);
    if (states.length !== match.players.length) warnings.add('MISSING_PLAYER_SAMPLES');
    return { tick, states };
  });
  const coverage = frames.every((frame) => frame.states.length === match.players.length && frame.states.every((state) => state[1] !== null && state[2] !== null && state[3] !== null)) ? 'COMPLETE' : 'PARTIAL';
  return replayRoundArtifactSchema.parse({
    schemaVersion: 'm4.7-replay-round@1',
    binding: { matchId: match.matchId, fileSha256: match.fileSha256, parserVersion: PARSER_LIBRARY_VERSION, normalizerVersion: NORMALIZER_VERSION },
    round: { id: round.id, ordinal: round.ordinal, startTick: round.startTick, freezeEndTick: round.freezeEndTick, endTick: round.endTick },
    tickRate: snapshot.tickRate,
    sampleRateHz: snapshot.sampleRateHz,
    coverage,
    frames,
    events: roundEvents(match, round.id),
    warnings: [...warnings]
  });
}

export function buildReplayRoundArtifacts(match: MatchData, snapshot: ParsedReplaySnapshot): ReplayRoundArtifact[] {
  const context = replayBuildContext(match, snapshot);
  return match.rounds.map((round) => buildReplayRoundArtifact(match, snapshot, round, context));
}

export async function persistReplayArtifacts(options: {
  dataRoot: string;
  match: MatchData;
  snapshot: ParsedReplaySnapshot;
  config: WorkerRuntimeConfig;
  assertOwned: () => Promise<void>;
}): Promise<ReplayIndexArtifact> {
  const context = replayBuildContext(options.match, options.snapshot);
  const summaries: ReplayIndexArtifact['rounds'] = [];
  let totalCompressedBytes = 0;
  for (const round of options.match.rounds) {
    const artifact = buildReplayRoundArtifact(options.match, options.snapshot, round, context);
    let bytes: Buffer;
    try {
      bytes = await gzipJson(artifact, {
        compressedBytes: Math.min(
          options.config.maxReplayRoundCompressedBytes,
          options.config.maxResultCompressedBytes,
        ),
        decompressedBytes: options.config.maxResultJsonBytes,
        jsonDepth: options.config.maxResultJsonDepth,
      });
    } catch (error) {
      if (error instanceof ArtifactError && error.reason === 'COMPRESSED_LIMIT') {
        throw new Error('REPLAY_ROUND_TOO_LARGE', { cause: error });
      }
      if (error instanceof ArtifactError && error.reason === 'DECOMPRESSED_LIMIT') {
        throw new Error('REPLAY_ROUND_OUTPUT_TOO_LARGE', { cause: error });
      }
      throw error;
    }
    totalCompressedBytes += bytes.byteLength;
    if (totalCompressedBytes > options.config.maxReplayTotalCompressedBytes) throw new Error('REPLAY_ARTIFACT_TOO_LARGE');
    await options.assertOwned();
    await publishImmutableBytes(options.dataRoot, resolveDataPath(options.dataRoot, replayRoundRelative(options.match.matchId, options.match.fileSha256, artifact.round.id)), bytes, options.assertOwned);
    summaries.push({
      ...artifact.round,
      sampleCount: artifact.frames.length,
      eventCount: artifact.events.length,
      coverage: artifact.coverage,
      sha256: sha256Bytes(bytes),
      compressedBytes: bytes.byteLength
    });
  }
  const withoutFingerprint: Omit<ReplayIndexArtifact, 'fingerprint'> = {
    schemaVersion: 'm4.7-replay-index@1',
    binding: { matchId: options.match.matchId, fileSha256: options.match.fileSha256, parserVersion: PARSER_LIBRARY_VERSION, normalizerVersion: NORMALIZER_VERSION },
    map: options.match.map,
    tickRate: options.snapshot.tickRate,
    sampleRateHz: options.snapshot.sampleRateHz,
    calibration: options.match.map === 'de_dust2' ? DUST2_REPLAY_CALIBRATION : null,
    players: options.match.players.map(({ id, displayName, teamId }) => ({ id, displayName, teamId })),
    teams: options.match.teams,
    rounds: summaries,
    totalFrames: summaries.reduce((sum, round) => sum + round.sampleCount, 0),
    totalCompressedBytes,
    warnings: summaries.some((round) => round.coverage === 'PARTIAL') ? ['PARTIAL_COORDINATE_COVERAGE'] : []
  };
  const index = replayIndexArtifactSchema.parse({ ...withoutFingerprint, fingerprint: replayIndexFingerprint(withoutFingerprint) });
  const bytes = await gzipJson(index, {
    compressedBytes: options.config.maxResultCompressedBytes,
    decompressedBytes: options.config.maxResultJsonBytes,
    jsonDepth: options.config.maxResultJsonDepth,
  });
  await options.assertOwned();
  await publishImmutableBytes(options.dataRoot, resolveDataPath(options.dataRoot, replayIndexRelative(options.match.matchId, options.match.fileSha256)), bytes, options.assertOwned);
  return index;
}

export { replayIndexRelative, replayRootRelative, replayRoundRelative, verifyReplayIndexFingerprint };
