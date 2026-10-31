import {
  importantMomentSchema,
  type ImportantMoment,
  type MatchArtifact,
  type MatchEvent
} from '@who-ruined/contracts';

const TRADE_WINDOW_SECONDS = 5;
const FAST_TRADE_WINDOW_SECONDS = 1;

export type VerifiedTradeLink = {
  originalDeath: MatchEvent;
  revengeKill: MatchEvent;
  delaySeconds: number;
};

function eventOrder(left: MatchEvent, right: MatchEvent): number {
  return left.tick - right.tick || left.source.rowIndex - right.source.rowIndex || left.id.localeCompare(right.id);
}

function isLiveEnemyDeath(event: MatchEvent, teamByPlayer: ReadonlyMap<string, string>): boolean {
  if (event.kind !== 'PLAYER_DEATH' || event.context?.phase !== 'LIVE') return false;
  if (!event.actorId || !event.targetId || event.actorId === event.targetId) return false;
  const actorTeam = teamByPlayer.get(event.actorId);
  const targetTeam = teamByPlayer.get(event.targetId);
  return actorTeam !== undefined && targetTeam !== undefined && actorTeam !== targetTeam;
}

/** The same deterministic, one-to-one trade rule used by the verified M2/M3 pipeline. */
export function deriveVerifiedTradeLinks(artifact: MatchArtifact): VerifiedTradeLink[] {
  const { match } = artifact;
  if (match.tickRate === null) return [];
  const teamByPlayer = new Map(match.players.map((player) => [player.id, player.teamId]));
  const deaths = match.events.filter((event) => isLiveEnemyDeath(event, teamByPlayer)).sort(eventOrder);
  const usedRevengeIds = new Set<string>();
  const links: VerifiedTradeLink[] = [];

  for (const original of deaths) {
    const revenge = deaths.find((candidate) => {
      if (candidate.roundId !== original.roundId || usedRevengeIds.has(candidate.id)) return false;
      const after = candidate.tick > original.tick || (candidate.tick === original.tick && candidate.source.rowIndex > original.source.rowIndex);
      if (!after || (candidate.tick - original.tick) / match.tickRate! > TRADE_WINDOW_SECONDS) return false;
      if (candidate.targetId !== original.actorId || !candidate.actorId || !original.targetId) return false;
      return teamByPlayer.get(candidate.actorId) === teamByPlayer.get(original.targetId);
    });
    if (!revenge) continue;
    usedRevengeIds.add(revenge.id);
    links.push({ originalDeath: original, revengeKill: revenge, delaySeconds: (revenge.tick - original.tick) / match.tickRate });
  }
  return links;
}

function importance(moment: ImportantMoment): number {
  if (moment.type === 'MULTI_KILL') return 1_000 + moment.killCount * 100 + moment.tradeCount * 10;
  return moment.type === 'FAST_TRADE' ? 600 : 500;
}

function momentOrder(left: ImportantMoment, right: ImportantMoment): number {
  return importance(right) - importance(left)
    || left.roundOrdinal - right.roundOrdinal
    || left.startTick - right.startTick
    || left.id.localeCompare(right.id);
}

export function buildImportantMoments(artifact: MatchArtifact): {
  byPlayer: ReadonlyMap<string, ImportantMoment[]>;
  match: ImportantMoment[];
} {
  const eventById = new Map(artifact.match.events.map((event) => [event.id, event]));
  const roundById = new Map(artifact.match.rounds.map((round) => [round.id, round]));
  const verifiedKillIds = new Set<string>();
  const verifiedTradeIds = new Set<string>();
  for (const player of artifact.analytics.players) {
    for (const fact of player.facts) {
      if (!fact.eventId) continue;
      if (fact.kind === 'KILL') verifiedKillIds.add(fact.eventId);
      if (fact.kind === 'TRADE_KILL') verifiedTradeIds.add(fact.eventId);
    }
  }

  const allLinks = deriveVerifiedTradeLinks(artifact);
  const tradeByRevengeId = new Map(allLinks
    .filter((link) => verifiedTradeIds.has(link.revengeKill.id))
    .map((link) => [link.revengeKill.id, link]));
  const kills = [...verifiedKillIds]
    .map((eventId) => eventById.get(eventId))
    .filter((event): event is MatchEvent => event !== undefined)
    .filter((event) => event.actorId !== null)
    .sort(eventOrder);
  const groups = new Map<string, MatchEvent[]>();
  for (const kill of kills) {
    const key = `${kill.actorId}\u0000${kill.roundId}`;
    groups.set(key, [...(groups.get(key) ?? []), kill]);
  }

  const collected = new Map<string, ImportantMoment[]>();
  for (const group of groups.values()) {
    const ordered = [...group].sort(eventOrder);
    const first = ordered[0]!;
    const playerId = first.actorId!;
    const round = roundById.get(first.roundId);
    if (!round) continue;
    const tradeLinks = ordered.map((event) => tradeByRevengeId.get(event.id)).filter((link): link is VerifiedTradeLink => link !== undefined);
    let moment: ImportantMoment | null = null;
    if (ordered.length >= 2 && ordered.length <= 5) {
      const evidenceEventIds = [...new Set([
        ...ordered.map((event) => event.id),
        ...tradeLinks.map((link) => link.originalDeath.id)
      ])];
      moment = importantMomentSchema.parse({
        id: first.id,
        type: 'MULTI_KILL',
        playerId,
        roundId: round.id,
        roundOrdinal: round.ordinal,
        startTick: ordered[0]!.tick,
        endTick: ordered.at(-1)!.tick,
        killCount: ordered.length,
        tradeCount: tradeLinks.length,
        tradeDelaySeconds: null,
        evidenceEventIds
      });
    } else if (ordered.length === 1 && tradeLinks[0]) {
      const trade = tradeLinks[0];
      moment = importantMomentSchema.parse({
        id: first.id,
        type: trade.delaySeconds <= FAST_TRADE_WINDOW_SECONDS ? 'FAST_TRADE' : 'TRADE',
        playerId,
        roundId: round.id,
        roundOrdinal: round.ordinal,
        startTick: trade.originalDeath.tick,
        endTick: trade.revengeKill.tick,
        killCount: 1,
        tradeCount: 1,
        tradeDelaySeconds: trade.delaySeconds,
        evidenceEventIds: [trade.originalDeath.id, trade.revengeKill.id]
      });
    }
    if (moment) collected.set(playerId, [...(collected.get(playerId) ?? []), moment]);
  }

  const byPlayer = new Map(artifact.match.players.map((player) => [
    player.id,
    [...(collected.get(player.id) ?? [])].sort(momentOrder).slice(0, 8)
  ]));
  const match = [...byPlayer.values()].flat().sort(momentOrder).slice(0, 8);
  return { byPlayer, match };
}
