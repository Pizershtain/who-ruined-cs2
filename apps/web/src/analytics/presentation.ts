import type { MatchData, MatchEvent } from '@who-ruined/contracts';

export function finalScore(match: MatchData, teamId: string): number | null {
  return match.rounds.at(-1)?.scoreAfter[teamId] ?? null;
}
export function teamOutcome(match: MatchData, teamId: string): 'win' | 'loss' | 'draw' | 'unknown' {
  if (match.quality !== 'VALID' || match.teams.length !== 2 || !match.teams.some((team) => team.id === teamId)) return 'unknown';
  const other = match.teams.find((team) => team.id !== teamId);
  const ours = finalScore(match, teamId);
  const theirs = other ? finalScore(match, other.id) : null;
  if (ours === null || theirs === null) return 'unknown';
  return ours === theirs ? 'draw' : ours > theirs ? 'win' : 'loss';
}
export function timeAtTick(tick: number, tickRate: number | null): string | null {
  if (!tickRate) return null;
  const seconds = Math.floor(tick / tickRate);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
export function playerEvents(match: MatchData, playerId: string): MatchEvent[] {
  return match.events.filter((event) => event.actorId === playerId || event.targetId === playerId || event.assisterId === playerId).sort((a, b) => a.tick - b.tick);
}
export function playerPath(base: string, playerId: string): string {
  return `${base}/players/${encodeURIComponent(playerId)}`;
}
