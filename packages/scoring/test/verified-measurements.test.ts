import { expect, it } from 'vitest';
import { type MatchData, type MatchEvent } from '@who-ruined/contracts';
import { measureEnemyDamage } from '../src/player-radar.js';

function hit(roundId: string, tick: number, actorId: string, weapon: string, rawHealthDamage: number | null, healthAfter: number | null): MatchEvent {
  return {
    id: String(tick), roundId, tick, actorId, targetId: 'enemy', assisterId: null, kind: 'PLAYER_HURT',
    source: { rowIndex: tick, eventName: 'player_hurt' },
    attrs: { weapon, rawHealthDamage, healthAfter },
    context: {
      phase: 'LIVE', actorTeamId: 'a', targetTeamId: 'b', actorSide: 'T', targetSide: 'CT',
      aliveByTeamId: null, secondsFromFreezeEnd: null, bombState: null, actorEquipmentValue: null, actorMoney: null,
    },
  };
}

it('isolates missing damage within one round and preserves separately verified damage and utility channels', () => {
  const match: MatchData = {
    schemaVersion: '1', matchId: 'synthetic', fileSha256: 'a'.repeat(64), quality: 'PARTIAL',
    map: 'de_mirage', tickRate: 64, teams: [], rounds: [], qualityIssues: [],
    provenance: { parser: 'synthetic', parserVersion: 'none', normalizedAt: '2026-11-27T10:00:00.000Z' },
    players: [
      { id: 'actor', teamId: 'a', steamId: null, displayName: 'Actor' },
      { id: 'enemy', teamId: 'b', steamId: null, displayName: 'Opponent' },
    ],
    events: [
      hit('round-1', 1, 'actor', 'hegrenade', 40, 60),
      hit('round-2', 2, 'actor', 'inferno', null, 75),
      hit('round-2', 3, 'actor', 'hegrenade', 10, 65),
      hit('excluded', 4, 'actor', 'hegrenade', 25, 75),
    ],
  };
  expect(measureEnemyDamage(match, 'actor', new Set(['round-1', 'round-2']))).toMatchObject([
    { damage: 40, he: 40, fire: 0, complete: true, heComplete: true, fireComplete: true },
    { damage: 10, he: 10, fire: 0, complete: false, heComplete: true, fireComplete: false },
  ]);
});
