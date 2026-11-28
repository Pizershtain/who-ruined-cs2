import type { H3EquipmentObservation, MatchData } from '@who-ruined/contracts';
import type { parseDemoEquipmentTicks } from '@who-ruined/parser-adapter';
import { parseEquipmentInKillableProcess } from './parser-boundary.js';

export function equipmentBoundaries(match: MatchData) {
  const boundary = new Map<number, { roundId: string; phase: H3EquipmentObservation['phase'] }>();
  for (const round of match.rounds) {
    if (round.freezeEndTick !== null) boundary.set(round.freezeEndTick, { roundId: round.id, phase: 'FREEZE_END' });
    boundary.set(round.endTick, { roundId: round.id, phase: 'ROUND_END' });
  }
  return boundary;
}

export function bindEquipmentObservations(
  match: MatchData, boundary: ReturnType<typeof equipmentBoundaries>, rows: ReturnType<typeof parseDemoEquipmentTicks>,
): H3EquipmentObservation[] {
  const playerBySteam = new Map(match.players.flatMap((player) => player.steamId
    ? [[player.steamId, player] as const] : []));
  return rows.flatMap(({ rowIndex, tick, steamId, side, ...equipment }): H3EquipmentObservation[] => {
    const player = playerBySteam.get(steamId ?? '');
    const location = tick === null ? undefined : boundary.get(tick);
    if (!player || tick === null || !location) return [];
    return [{
      evidenceId: `raw-tick:${tick}:${player.id}:${rowIndex}`,
      matchId: match.matchId,
      roundId: location.roundId,
      playerId: player.id,
      teamId: player.teamId,
      side,
      tick,
      phase: location.phase,
      ...equipment,
      provenance: 'RAW_DEMOPARSER_TICK',
    }];
  });
}

export async function readRatingEquipment(
  match: MatchData, options: Omit<Parameters<typeof parseEquipmentInKillableProcess>[0], 'ticks'>,
): Promise<H3EquipmentObservation[]> {
  const boundaries = equipmentBoundaries(match);
  const ticks = [...boundaries.keys()].sort((a, b) => a - b);
  if (!ticks.length) return [];
  try {
    return bindEquipmentObservations(match, boundaries, await parseEquipmentInKillableProcess({ ...options, ticks }));
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'EQUIPMENT_SOURCE_UNAVAILABLE') throw error;
    console.warn(JSON.stringify({ level: 'warn', event: 'rating_equipment_unavailable', matchId: match.matchId }));
    return [];
  }
}
