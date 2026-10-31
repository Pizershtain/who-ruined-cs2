import { describe, expect, it } from 'vitest';
import type { MatchData } from '@who-ruined/contracts';
import type { ParsedReplaySnapshot } from '@who-ruined/parser-adapter';
import { syntheticValidMatch } from '@who-ruined/testkit';
import { buildReplayRoundArtifacts, DUST2_REPLAY_CALIBRATION } from '../src/replay-artifact.js';

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
});
