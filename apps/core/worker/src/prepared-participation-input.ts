import { createHash } from 'node:crypto';
import { c2s2PreparedSidecarSchema, type C2S2PreparedProfileDto, type C2S2PreparedSidecar, type MatchData, type MatchEvent, type MatchRound } from '@who-ruined/contracts';
import {
  decodeParticipationRow,
  NORMALIZER_VERSION,
  PARSER_LIBRARY_VERSION,
  readPreparedParticipationSupplementRows,
  type ParsedDemoSnapshot,
  type ParsedParticipationSupplement,
  type UnknownRow,
} from '@who-ruined/parser-adapter';
import {
  C2S2_MODEL_VERSION,
  C2S2_POLICY_DIGEST,
  C2S2_REFERENCE_VERSION,
  participationScenarioForMap,
  type C2S2EpisodeContribution,
  type ParticipationFamily,
  type ParticipationPhysicalFamily,
} from '@who-ruined/scoring';

export const C2S2_SIDECAR_SCHEMA_VERSION = 'm3c8-c2s2-prepared-sidecar-1' as const;
const CONTEXT_TAGS = ['OPENING','TRADE','FAST_TRADE','MULTI_KILL','DISADVANTAGE','ALIVE_LEAD_TAKEN','POSTPLANT','FLASH_ASSIST','FLASH_TEAM_KILL_WINDOW','FLASH_TEAM_DAMAGE_WINDOW','LOW_EQUIP_COMBAT'] as const;
type ContextTag = typeof CONTEXT_TAGS[number];
type Relation = 'ENEMY' | 'ALLY' | 'SELF' | 'UNKNOWN';
type Boundary = { liveStart: number; liveEnd: number; baseLiveEnd: number; startSource: string; endSource: string; terminalSource: string; complete: boolean; startVerified: boolean; endVerified: boolean; reason: string | null; evidence: Record<string, number>; objective: { tick: number | null; kind: string | null; candidateCount: number; verifiedCount: number; complete: boolean }; eliminationTick: number | null };
type Episode = { anchorId: string; axis?: string; rawValue?: number; components?: Record<string, number>; tags: ContextTag[] };
type RawAxes = { enemyHp:number; enemyKills:number; enemyArmor:number; assists:number; enemyBlind:number; ownDeaths:number; suicides:number; worldDeaths:number; allyHp:number; allyKills:number; allyBlind:number; allyArmor:number };
type Profile = { profileKey: string; playerId: string; teamId: string; scenario: 'BOMB'|'HOSTAGE'|'UNKNOWN'; rounds: number; validRounds: number; liveMinutes: number; tRounds: number; ctRounds: number; requiredInputStatus: string; raw: RawAxes; objectives: { plants:number; defuses:number; hostageRescues:number; hostageHurts:number }; episodes: Episode[] };
type Death = MatchEvent & { order: number; relation: Relation; actorTeamId?: string|undefined; targetTeamId?: string|undefined };
type Trajectory = { roundId: string; boundary: Boundary; clean: boolean; reasons: string[]; state: { snapshots: Array<{ tick: number; pre: Record<string, number>; post: Record<string, number>; eventIds: string[] }> } };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const rowOrder = (event: MatchEvent) => event.source?.rowIndex ?? Number.MAX_SAFE_INTEGER;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const unique = <T extends { id: string }>(rows: T[]): T[] => { const seen=new Set<string>(); return rows.filter((row)=>!seen.has(row.id)&&Boolean(seen.add(row.id))); };
const relation = (teams: Map<string,string>, actor: string|null, target: string|null): Relation => !actor||!target||!teams.has(actor)||!teams.has(target)?'UNKNOWN':actor===target?'SELF':teams.get(actor)===teams.get(target)?'ALLY':'ENEMY';
const inside = (event: MatchEvent, boundary?: Boundary) => Boolean(boundary && event.tick >= boundary.liveStart && event.tick <= boundary.liveEnd);

function baseBoundaries(snapshot: ParsedDemoSnapshot, rounds: MatchRound[]): Map<string, Omit<Boundary,'terminalSource'|'objective'|'eliminationTick'>> {
  const rawEvents = snapshot.events
    .map((row, order) => {
      const decoded = decodeParticipationRow(row);
      return { name: decoded.eventName, tick: decoded.tick, order };
    })
    .filter((row): row is { name: string | null; tick: number; order: number } => (
      row.tick !== null
    ));

  return new Map(rounds.map((round) => {
    const liveStart = round.freezeEndTick ?? round.startTick;
    const freezeEndRows = rawEvents.filter((row) => (
      row.name === 'round_freeze_end' && row.tick === liveStart
    ));
    const roundEndRows = rawEvents.filter((row) => (
      row.name === 'round_end'
      && row.tick >= liveStart
      && row.tick <= round.endTick
    ));
    const officialEndRows = rawEvents.filter((row) => (
      row.name === 'round_officially_ended' && row.tick === round.endTick
    ));
    const freezeEndTicks = [...new Set(freezeEndRows.map((row) => row.tick))];
    const roundEndTicks = [...new Set(
      roundEndRows
        .sort((left, right) => left.tick - right.tick || left.order - right.order)
        .map((row) => row.tick),
    )];
    const officialEndTicks = [...new Set(officialEndRows.map((row) => row.tick))];

    let liveEnd = round.endTick;
    let endSource = 'NORMALIZED_ROUND_END_FALLBACK';
    let endVerified = false;
    let endReason: string | null = 'NO_UNIQUE_RAW_ROUND_END';
    if (roundEndTicks.length === 1) {
      liveEnd = roundEndTicks[0]!;
      endSource = 'RAW_ROUND_END';
      endVerified = true;
      endReason = null;
    } else if (!roundEndTicks.length && officialEndTicks.length === 1) {
      liveEnd = officialEndTicks[0]!;
      endSource = 'RAW_ROUND_OFFICIALLY_ENDED';
      endVerified = true;
      endReason = null;
    } else if (roundEndTicks.length > 1) {
      liveEnd = roundEndTicks[0]!;
      endSource = 'AMBIGUOUS_RAW_ROUND_END';
      endReason = 'MULTIPLE_RAW_ROUND_END_CANDIDATES';
    } else if (officialEndTicks.length > 1) {
      endSource = 'AMBIGUOUS_RAW_OFFICIAL_END';
      endReason = 'MULTIPLE_RAW_OFFICIAL_END_CANDIDATES';
    }

    const startVerified = freezeEndTicks.length === 1;
    return [round.id, {
      liveStart,
      liveEnd,
      baseLiveEnd: liveEnd,
      startSource: startVerified ? 'RAW_ROUND_FREEZE_END' : 'NORMALIZED_FREEZE_END_FALLBACK',
      endSource,
      complete: startVerified && endVerified,
      startVerified,
      endVerified,
      reason: !startVerified ? 'NO_UNIQUE_RAW_FREEZE_END' : endReason,
      evidence: {
        rawFreezeEndRows: freezeEndRows.length,
        rawFreezeEndUniqueTicks: freezeEndTicks.length,
        rawRoundEndRows: roundEndRows.length,
        rawRoundEndUniqueTicks: roundEndTicks.length,
        rawOfficialEndRows: officialEndRows.length,
        rawOfficialEndUniqueTicks: officialEndTicks.length,
        normalizedStart: liveStart,
        normalizedEnd: round.endTick,
      },
    }];
  }));
}
function startAlive(snapshot: ParsedDemoSnapshot, match: MatchData, boundary: {liveStart:number}, allowIncompleteRoster = false) {
  const roster = new Set(match.players.map((player) => player.id));
  const teamByPlayer = new Map(match.players.map((player) => [player.id, player.teamId]));
  const observed = new Map<string, boolean | null>();
  for (const row of snapshot.ticks) {
    const decoded = decodeParticipationRow(row);
    if (decoded.tick !== boundary.liveStart) continue;
    const playerId = decoded.tickSteamId;
    if (playerId && roster.has(playerId)) observed.set(playerId, decoded.isAlive);
  }

  const aliveByTeam = new Map(match.teams.map((team) => [
    team.id,
    new Set([...observed]
      .filter(([playerId, isAlive]) => (
        isAlive === true && teamByPlayer.get(playerId) === team.id
      ))
      .map(([playerId]) => playerId)),
  ]));
  const complete = allowIncompleteRoster
    ? match.teams.length === 2
      && match.teams.every((team) => (aliveByTeam.get(team.id)?.size ?? 0) > 0)
    : observed.size === roster.size
      && match.teams.length === 2
      && match.teams.every((team) => (
        team.playerIds.length === 5 && aliveByTeam.get(team.id)?.size === 5
      ));
  return {
    complete,
    aliveByTeam,
    reason: complete ? null : 'FREEZE_ALIVE_SNAPSHOT_INCOMPLETE',
  };
}

type LiveLifecycleEvent = {
  name: string;
  tick: number;
  identityStatus: string;
  playerId: string | null;
};

function aliveState(
  deaths: Death[],
  teamIds: string[],
  starts: Map<string, Set<string>>,
  liveStart: number,
  liveEnd: number,
  allowIncompleteRoster = false,
  lifecycle: LiveLifecycleEvent[] = [],
  playerTeams = new Map<string, string>(),
) {
  const alive = new Map(teamIds.map((teamId) => [
    teamId,
    new Set(starts.get(teamId) ?? []),
  ]));
  let reliable = teamIds.length === 2 && teamIds.every((teamId) => (
    allowIncompleteRoster
      ? (alive.get(teamId)?.size ?? 0) > 0
      : alive.get(teamId)?.size === 5
  ));
  const errors: string[] = [];
  const snapshots: Trajectory['state']['snapshots'] = [];
  const deathsByTick = new Map<number, Death[]>();
  const liveDeaths = unique(deaths.filter((death) => (
    death.tick >= liveStart && death.tick <= liveEnd
  )));
  for (const death of liveDeaths) {
    const tickDeaths = deathsByTick.get(death.tick) ?? [];
    tickDeaths.push(death);
    deathsByTick.set(death.tick, tickDeaths);
  }
  const liveLifecycle = [...lifecycle]
    .filter((event) => event.tick > liveStart && event.tick < liveEnd)
    .sort((left, right) => (
      left.tick - right.tick || left.name.localeCompare(right.name)
    ));
  let lifecycleIndex = 0;

  const applyLifecycleBeforeDeath = (event: LiveLifecycleEvent): void => {
    if (event.identityStatus !== 'STABLE_ROSTER_ID' || !event.playerId) {
      reliable = false;
      errors.push('UNKNOWN_IDENTITY_IN_LIVE_LIFECYCLE');
      return;
    }
    const teamId = playerTeams.get(event.playerId);
    if (!teamId) {
      reliable = false;
      errors.push('LIFECYCLE_PLAYER_TEAM_UNKNOWN');
      return;
    }
    if (event.name === 'player_disconnect') {
      alive.get(teamId)?.delete(event.playerId);
    } else if (
      ['player_connect', 'player_connect_full', 'player_spawn', 'player_team']
        .includes(event.name)
    ) {
      alive.get(teamId)?.add(event.playerId);
    }
  };

  for (const [tick, tickDeaths] of [...deathsByTick].sort(([left], [right]) => left - right)) {
    while (
      lifecycleIndex < liveLifecycle.length
      && liveLifecycle[lifecycleIndex]!.tick < tick
    ) {
      applyLifecycleBeforeDeath(liveLifecycle[lifecycleIndex++]!);
    }

    const pre = Object.fromEntries(teamIds.map((teamId) => [
      teamId,
      alive.get(teamId)?.size ?? 0,
    ]));
    const victims = new Set<string>();
    const victimTeamByDeath = new Map<string, string>();
    for (const death of tickDeaths) {
      const victimTeamId = death.targetId
        ? teamIds.find((teamId) => alive.get(teamId)?.has(death.targetId!))
        : undefined;
      if (!victimTeamId || !death.targetId) {
        reliable = false;
        errors.push('UNKNOWN_OR_ALREADY_DEAD_VICTIM');
        continue;
      }
      if (victims.has(death.targetId)) {
        reliable = false;
        errors.push('DUPLICATE_VICTIM_IN_TICK_GROUP');
        continue;
      }
      victims.add(death.targetId);
      victimTeamByDeath.set(death.id, victimTeamId);
    }
    for (const death of tickDeaths) {
      const victimTeamId = victimTeamByDeath.get(death.id);
      if (victimTeamId && death.targetId) {
        alive.get(victimTeamId)?.delete(death.targetId);
      }
    }
    snapshots.push({
      tick,
      pre,
      post: Object.fromEntries(teamIds.map((teamId) => [
        teamId,
        alive.get(teamId)?.size ?? 0,
      ])),
      eventIds: tickDeaths.map((death) => death.id),
    });

    while (
      lifecycleIndex < liveLifecycle.length
      && liveLifecycle[lifecycleIndex]!.tick === tick
    ) {
      const event = liveLifecycle[lifecycleIndex++]!;
      if (event.name !== 'player_disconnect') {
        reliable = false;
        errors.push('NON_DISCONNECT_LIFECYCLE_AT_DEATH_TICK');
        continue;
      }
      if (event.identityStatus !== 'STABLE_ROSTER_ID' || !event.playerId) {
        reliable = false;
        errors.push('UNKNOWN_IDENTITY_IN_LIVE_LIFECYCLE');
        continue;
      }
      const teamId = playerTeams.get(event.playerId);
      if (teamId) {
        alive.get(teamId)?.delete(event.playerId);
      } else {
        reliable = false;
        errors.push('LIFECYCLE_PLAYER_TEAM_UNKNOWN');
      }
    }
  }

  return { reliable, errors: [...new Set(errors)], snapshots };
}

function objectiveTerminal(match: MatchData, snapshot: ParsedDemoSnapshot, roundId: string, boundary:{liveStart:number;liveEnd:number}) {
  const rawNameByKind: Record<string, string> = {
    BOMB_DEFUSED: 'bomb_defused',
    BOMB_EXPLODED: 'bomb_exploded',
  };
  const candidates = match.events
    .filter((event) => (
      event.roundId === roundId
      && Object.hasOwn(rawNameByKind, event.kind)
      && event.tick >= boundary.liveStart
      && event.tick <= boundary.liveEnd
    ))
    .map((event) => {
      const decoded = decodeParticipationRow(snapshot.events[event.source.rowIndex] ?? {});
      return {
        event,
        verified: decoded.eventName === rawNameByKind[event.kind]
          && decoded.tick === event.tick,
      };
    })
    .sort((left, right) => (
      left.event.tick - right.event.tick
      || left.event.source.rowIndex - right.event.source.rowIndex
    ));
  const verified = candidates.filter((candidate) => candidate.verified);
  return {
    tick: verified.length === 1 ? verified[0]!.event.tick : null,
    kind: verified.length === 1 ? verified[0]!.event.kind : null,
    candidateCount: candidates.length,
    verifiedCount: verified.length,
    complete: candidates.length === verified.length && verified.length <= 1,
  };
}

function trajectories(
  snapshot: ParsedDemoSnapshot,
  match: MatchData,
  lifecycleRows: UnknownRow[],
  allowIncompleteRoster = false,
): Trajectory[] {
  const rounds = match.rounds.filter((round) => round.isValid);
  const teamIds = match.teams.map((team) => team.id);
  const teamByPlayer = new Map(match.players.map((player) => [player.id, player.teamId]));
  const roster = new Set(match.players.map((player) => player.id));
  const baseBoundaryByRound = baseBoundaries(snapshot, rounds);
  const deaths = unique(match.events.filter((event) => (
    event.kind === 'PLAYER_DEATH' && event.context?.phase === 'LIVE'
  ))).map((event) => ({
    ...event,
    order: rowOrder(event),
    relation: relation(teamByPlayer, event.actorId, event.targetId),
  }));
  const plants = match.events.filter((event) => (
    event.kind === 'BOMB_PLANTED' && event.context?.phase === 'LIVE'
  ));
  const lifecycleNames = new Set([
    'player_disconnect',
    'player_connect',
    'player_connect_full',
    'player_spawn',
    'player_team',
  ]);
  const lifecycle = lifecycleRows
    .map((row, order) => {
      const decoded = decodeParticipationRow(row);
      const name = decoded.eventName;
      const tick = decoded.tick;
      if (!name || !lifecycleNames.has(name) || tick === null) return null;

      const candidates = decoded.candidateSteamIds;
      const stableCandidates = [...new Set(candidates.filter((value) => roster.has(value)))];
      return {
        name,
        tick,
        order,
        playerId: stableCandidates.length === 1 ? stableCandidates[0]! : null,
        identityStatus: stableCandidates.length === 1
          ? 'STABLE_ROSTER_ID'
          : stableCandidates.length > 1
            ? 'AMBIGUOUS_ROSTER_ID'
            : candidates.length
              ? 'UNMATCHED_IDENTITY'
              : 'MISSING_IDENTITY',
      };
    })
    .filter((value): value is NonNullable<typeof value> => value !== null);

  return rounds.map((round) => {
    const baseBoundary = baseBoundaryByRound.get(round.id)!;
    const start = startAlive(snapshot, match, baseBoundary, allowIncompleteRoster);
    const roundDeaths = deaths.filter((death) => death.roundId === round.id);
    const initialState = aliveState(
      roundDeaths,
      teamIds,
      start.aliveByTeam,
      baseBoundary.liveStart,
      baseBoundary.liveEnd,
      allowIncompleteRoster,
      lifecycle,
      teamByPlayer,
    );
    const plantTick = Math.min(
      Infinity,
      ...plants.filter((plant) => plant.roundId === round.id).map((plant) => plant.tick),
    );
    const ctTeamId = teamIds.find((teamId) => round.sideByTeamId[teamId] === 'CT');
    const eliminationTick = start.complete && initialState.reliable
      ? initialState.snapshots.find((state) => teamIds.some((teamId) => (
          state.post[teamId] === 0
          && (teamId === ctTeamId || state.tick < plantTick)
        )))?.tick ?? null
      : null;
    const objective = objectiveTerminal(match, snapshot, round.id, baseBoundary);
    const liveEnd = Math.min(...[
      baseBoundary.liveEnd,
      eliminationTick,
      objective.tick,
    ].filter((value): value is number => Number.isInteger(value)));
    const terminalSource = liveEnd === objective.tick
      ? 'OBJECTIVE_TERMINAL'
      : liveEnd === eliminationTick
        ? 'ELIMINATION_TERMINAL'
        : baseBoundary.endSource;
    const boundary: Boundary = {
      ...baseBoundary,
      liveEnd,
      terminalSource,
      objective,
      eliminationTick,
      complete: baseBoundary.complete && objective.complete,
      reason: baseBoundary.complete && objective.complete
        ? null
        : baseBoundary.reason ?? 'OBJECTIVE_SOURCE_AMBIGUOUS',
    };
    const state = aliveState(
      roundDeaths,
      teamIds,
      start.aliveByTeam,
      boundary.liveStart,
      boundary.liveEnd,
      allowIncompleteRoster,
      lifecycle,
      teamByPlayer,
    );
    const lifecycleInside = lifecycle.filter((event) => (
      event.tick > boundary.liveStart && event.tick < boundary.liveEnd
    ));
    const lifecycleAtBoundary = lifecycle.filter((event) => (
      event.tick === boundary.liveStart || event.tick === boundary.liveEnd
    ));
    const uncertainBoundaryLifecycle = lifecycleAtBoundary.filter((event) => !(
      ['player_spawn', 'player_team'].includes(event.name) && start.complete
    ));
    const reasons: string[] = [];
    if (!boundary.complete) reasons.push(boundary.reason ?? 'BOUNDARY_INCOMPLETE');
    if (!start.complete && start.reason) reasons.push(start.reason);
    if (!state.reliable) reasons.push(...state.errors);
    if (
      !allowIncompleteRoster
      && lifecycleInside.some((event) => event.identityStatus === 'STABLE_ROSTER_ID')
    ) reasons.push('IN_LIVE_ROSTER_LIFECYCLE');
    if (lifecycleInside.some((event) => event.identityStatus !== 'STABLE_ROSTER_ID')) {
      reasons.push('UNKNOWN_IDENTITY_IN_LIVE_LIFECYCLE');
    }
    if (
      uncertainBoundaryLifecycle.some((event) => (
        event.identityStatus === 'STABLE_ROSTER_ID'
      ))
    ) reasons.push('LIFECYCLE_AT_LIVE_BOUNDARY');
    if (
      uncertainBoundaryLifecycle.some((event) => (
        event.identityStatus !== 'STABLE_ROSTER_ID'
      ))
    ) reasons.push('UNKNOWN_IDENTITY_AT_LIVE_BOUNDARY');

    return {
      roundId: round.id,
      boundary,
      clean: reasons.length === 0,
      reasons: [...new Set(reasons)],
      state,
    };
  });
}

const DEFAULT_PLAYER_HEALTH = 100;
const LETHAL_LINK_MAX_TICK_GAP = 1;
const TRADE_WINDOW_SECONDS = 5;

function hpLedger(hurts: MatchEvent[]) {
  const remainingHealth = new Map<string, number>();
  const values = new Map<string, number>();
  const invalid: string[] = [];
  const orderedHurts = [...hurts]
    .sort((left, right) => left.tick - right.tick || rowOrder(left) - rowOrder(right));

  for (const hurt of orderedHurts) {
    const rawDamage = hurt.attrs.rawHealthDamage;
    const healthAfter = hurt.attrs.healthAfter;
    if (
      !hurt.targetId
      || !finite(rawDamage)
      || !finite(healthAfter)
      || rawDamage < 0
      || healthAfter < 0
    ) {
      invalid.push(hurt.id);
      continue;
    }

    const healthKey = `${hurt.roundId}|${hurt.targetId}`;
    const healthBefore = remainingHealth.get(healthKey) ?? DEFAULT_PLAYER_HEALTH;
    values.set(hurt.id, Math.max(0, Math.min(rawDamage, healthBefore)));
    remainingHealth.set(healthKey, Math.max(0, healthAfter));
  }
  return { values, invalid };
}

function lethalLink(
  death: Death,
  hurts: MatchEvent[],
  damageByEvent: Map<string, number>,
) {
  const candidates = hurts.filter((hurt) => (
    hurt.roundId === death.roundId
    && hurt.actorId === death.actorId
    && hurt.targetId === death.targetId
    && (
      hurt.tick < death.tick
      || (hurt.tick === death.tick && rowOrder(hurt) < rowOrder(death))
    )
    && death.tick - hurt.tick <= LETHAL_LINK_MAX_TICK_GAP
    && hurt.attrs.healthAfter === 0
    && (damageByEvent.get(hurt.id) ?? 0) > 0
  ));
  return candidates.length === 1 ? candidates[0]!.id : null;
}

type TradeLink = { original: Death; revenge: Death; delaySeconds: number };
type TradeSolution = { links: TradeLink[]; delay: number; signature: string };

function tradeLinks(deaths: Death[], tickRate: number): TradeLink[] {
  const enemyDeaths = unique(deaths)
    .filter((death) => death.relation === 'ENEMY')
    .sort((left, right) => (
      left.roundId.localeCompare(right.roundId)
      || left.tick - right.tick
      || left.order - right.order
      || left.id.localeCompare(right.id)
    ));
  const selectedLinks: TradeLink[] = [];

  for (const roundId of [...new Set(enemyDeaths.map((death) => death.roundId))]) {
    const roundDeaths = enemyDeaths.filter((death) => death.roundId === roundId);
    const candidatesByOriginal = roundDeaths.map((original) => roundDeaths
      .flatMap((revenge): TradeLink[] => {
        const isRevenge = original.id !== revenge.id
          && revenge.targetId === original.actorId
          && Boolean(original.targetTeamId)
          && revenge.actorTeamId === original.targetTeamId;
        if (!isRevenge) return [];

        const delaySeconds = (revenge.tick - original.tick) / tickRate;
        return delaySeconds > 0 && delaySeconds <= TRADE_WINDOW_SECONDS
          ? [{ original, revenge, delaySeconds }]
          : [];
      })
      .sort((left, right) => (
        left.delaySeconds - right.delaySeconds
        || left.revenge.tick - right.revenge.tick
        || left.revenge.id.localeCompare(right.revenge.id)
      )));
    const memo = new Map<string, TradeSolution>();

    const solve = (index: number, usedRevengeIds: Set<string>): TradeSolution => {
      const key = `${index}|${[...usedRevengeIds].sort().join(',')}`;
      const cached = memo.get(key);
      if (cached) return cached;
      if (index === roundDeaths.length) return { links: [], delay: 0, signature: '' };

      let best = solve(index + 1, usedRevengeIds);
      for (const candidate of candidatesByOriginal[index] ?? []) {
        if (usedRevengeIds.has(candidate.revenge.id)) continue;

        const nextUsedRevengeIds = new Set(usedRevengeIds);
        nextUsedRevengeIds.add(candidate.revenge.id);
        const tail = solve(index + 1, nextUsedRevengeIds);
        const trial = {
          links: [candidate, ...tail.links],
          delay: candidate.delaySeconds + tail.delay,
          signature: `${candidate.original.id}>${candidate.revenge.id}|${tail.signature}`,
        };
        const hasMoreLinks = trial.links.length > best.links.length;
        const hasSameLinksWithBetterTieBreak = trial.links.length === best.links.length
          && (
            trial.delay < best.delay
            || (trial.delay === best.delay && trial.signature < best.signature)
          );
        if (hasMoreLinks || hasSameLinksWithBetterTieBreak) best = trial;
      }
      memo.set(key, best);
      return best;
    };

    selectedLinks.push(...solve(0, new Set()).links);
  }
  return selectedLinks;
}

function scenarioFor(snapshot:ParsedDemoSnapshot,mapName:string|null):'BOMB'|'HOSTAGE'|'UNKNOWN'{const mapScenario=participationScenarioForMap(mapName);if(mapScenario)return mapScenario;const names=new Set(snapshot.eventNames);const bomb=['bomb_beginplant','bomb_abortplant','bomb_planted','bomb_begindefuse','bomb_abortdefuse','bomb_defused','bomb_exploded','bomb_dropped','bomb_pickup'].some((n)=>names.has(n));const hostage=['hostage_follows','hostage_rescued','hostage_rescued_all','hostage_stops_following','hostage_hurt','hostage_killed','hostage_call_for_help'].some((n)=>names.has(n));return bomb&&!hostage?'BOMB':hostage&&!bomb?'HOSTAGE':'UNKNOWN';}

function buildProfiles(snapshot:ParsedDemoSnapshot,match:MatchData,paths:Trajectory[],hostageRows:UnknownRow[]){
  const scenario=scenarioFor(snapshot,match.map),clean=paths.filter((p)=>p.clean),boundaries=new Map(clean.map((p)=>[p.roundId,p.boundary])),cleanIds=new Set(boundaries.keys()),rounds=new Map(match.rounds.filter((r)=>r.isValid).map((r)=>[r.id,r])),teams=new Map(match.players.map((p)=>[p.id,p.teamId]));
  const events=unique(match.events.filter((e)=>e.context?.phase==='LIVE'&&cleanIds.has(e.roundId)&&inside(e,boundaries.get(e.roundId))));const deaths=events.filter((e)=>e.kind==='PLAYER_DEATH').map((e):Death=>({...e,order:rowOrder(e),relation:relation(teams,e.actorId,e.targetId),actorTeamId:e.actorId?teams.get(e.actorId):undefined,targetTeamId:e.targetId?teams.get(e.targetId):undefined}));const hurts=events.filter((e)=>e.kind==='PLAYER_HURT');const hp=hpLedger(hurts);
  const validRounds=match.rounds.filter((r)=>r.isValid);const profiles=new Map<string,Profile>(match.players.map((p,index)=>[p.id,{profileKey:`${match.matchId}:P${String(index+1).padStart(2,'0')}`,playerId:p.id,teamId:p.teamId,scenario,rounds:clean.length,validRounds:validRounds.length,liveMinutes:clean.reduce((s,t)=>s+(t.boundary.liveEnd-t.boundary.liveStart+1)/(match.tickRate??1)/60,0),tRounds:clean.filter((t)=>rounds.get(t.roundId)?.sideByTeamId[p.teamId]==='T').length,ctRounds:clean.filter((t)=>rounds.get(t.roundId)?.sideByTeamId[p.teamId]==='CT').length,requiredInputStatus:hp.invalid.length?'PARTIAL_HP_LEDGER':'COMPLETE',raw:{enemyHp:0,enemyKills:0,enemyArmor:0,assists:0,enemyBlind:0,ownDeaths:0,suicides:0,worldDeaths:0,allyHp:0,allyKills:0,allyBlind:0,allyArmor:0},objectives:{plants:0,defuses:0,hostageRescues:0,hostageHurts:0},episodes:[]} as Profile]));
  const deathTags=new Map(deaths.map((d)=>[d.id,new Set<ContextTag>()]));for(const roundId of cleanIds){const rows=deaths.filter((d)=>d.roundId===roundId&&d.relation==='ENEMY').sort((a,b)=>a.tick-b.tick||a.order-b.order||a.id.localeCompare(b.id));if(rows.length&&rows.filter((d)=>d.tick===rows[0]!.tick).length===1)deathTags.get(rows[0]!.id)?.add('OPENING');const byActor=new Map<string,Death[]>();for(const d of rows){if(!d.actorId)continue;const list=byActor.get(d.actorId)??[];list.push(d);byActor.set(d.actorId,list);}for(const list of byActor.values())if(list.length>=2)for(const d of list)deathTags.get(d.id)?.add('MULTI_KILL');}
  const trades=tradeLinks(deaths,match.tickRate??1);for(const link of trades)deathTags.get(link.revenge.id)?.add('TRADE');for(const t of clean)for(const s of t.state.snapshots)for(const id of s.eventIds){const d=deaths.find((x)=>x.id===id);if(d?.relation==='ENEMY'&&d.actorTeamId&&d.targetTeamId&&(s.pre[d.actorTeamId]??0)<(s.pre[d.targetTeamId]??0))deathTags.get(d.id)?.add('DISADVANTAGE');}
  const postplant=new Set<string>();for(const round of validRounds){const b=boundaries.get(round.id);const plants=events.filter((e)=>e.roundId===round.id&&e.kind==='BOMB_PLANTED');if(!b||plants.length!==1||plants[0]!.tick>=b.liveEnd)continue;for(const h of hurts.filter((e)=>e.roundId===round.id&&e.tick>plants[0]!.tick&&e.tick<=b.liveEnd&&relation(teams,e.actorId,e.targetId)==='ENEMY'&&hp.values.has(e.id)))postplant.add(h.id);}
  const used=new Set<string>();for(const d of deaths){const victim=d.targetId?profiles.get(d.targetId):undefined;if(victim){victim.raw.ownDeaths++;const cause=!d.actorId?'WORLD_DEATH':d.actorId===d.targetId?'SUICIDE':d.relation==='ALLY'?'TEAM_DEATH':'ENEMY_DEATH';if(cause==='SUICIDE')victim.raw.suicides++;if(cause==='WORLD_DEATH')victim.raw.worldDeaths++;victim.episodes.push({anchorId:d.id,axis:'ownDeaths',rawValue:1,tags:[]});}const actor=d.actorId?profiles.get(d.actorId):undefined;if(!actor||!['ENEMY','ALLY'].includes(d.relation))continue;const linked=lethalLink(d,hurts,hp.values),tags=[...(deathTags.get(d.id)??[])];if(linked&&postplant.has(linked)||postplant.has(d.id))tags.push('POSTPLANT');if(linked){used.add(linked);const amount=hp.values.get(linked)!;if(d.relation==='ENEMY'){actor.raw.enemyKills++;actor.raw.enemyHp+=amount;actor.episodes.push({anchorId:linked,components:{enemyHp:amount,enemyKills:1},tags});}else{actor.raw.allyKills++;actor.raw.allyHp+=amount;actor.episodes.push({anchorId:linked,components:{allyHp:amount,allyKills:1},tags:[]});}}else{const axis=d.relation==='ENEMY'?'enemyKills':'allyKills';actor.raw[axis]++;actor.episodes.push({anchorId:d.id,axis,rawValue:1,tags});actor.requiredInputStatus='UNVERIFIED_LETHAL_OVERLAP_UNVERIFIED_LINK';}if(d.relation==='ENEMY'&&d.assisterId&&profiles.has(d.assisterId)){const assist=profiles.get(d.assisterId)!;assist.raw.assists++;assist.episodes.push({anchorId:d.id,axis:'assists',rawValue:1,tags:d.attrs.assistedFlash===true?['FLASH_ASSIST']:[]});}}
  for(const h of hurts){if(used.has(h.id)||!hp.values.has(h.id))continue;const actor=h.actorId?profiles.get(h.actorId):undefined,rel=relation(teams,h.actorId,h.targetId);if(!actor||!['ENEMY','ALLY'].includes(rel))continue;const axis=rel==='ENEMY'?'enemyHp':'allyHp',amount=hp.values.get(h.id)!;actor.raw[axis]+=amount;actor.episodes.push({anchorId:h.id,axis,rawValue:amount,tags:postplant.has(h.id)?['POSTPLANT']:[]});}
  const blindGroups=new Map<string,Array<[number,number]>>();for(const e of events.filter((x)=>x.kind==='PLAYER_BLIND'&&x.actorId&&x.targetId&&finite(x.attrs.blindDuration))){const b=boundaries.get(e.roundId)!;const key=`${e.actorId}|${e.targetId}|${e.roundId}`,list=blindGroups.get(key)??[];list.push([e.tick/(match.tickRate??1),Math.min(e.tick/(match.tickRate??1)+(e.attrs.blindDuration as number),b.liveEnd/(match.tickRate??1))]);blindGroups.set(key,list);}for(const [key,ints] of blindGroups){const [actorId,targetId,roundId]=key.split('|') as [string,string,string];const rel=relation(teams,actorId,targetId);if(rel==='SELF')continue;const p=profiles.get(actorId);if(!p||!['ENEMY','ALLY'].includes(rel))continue;const ordered=[...ints].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let total=0,start=ordered[0]![0],end=ordered[0]![1];for(const [s,e] of ordered.slice(1)){if(s<=end)end=Math.max(end,e);else{total+=end-start;start=s;end=e;}}total+=end-start;const axis=rel==='ENEMY'?'enemyBlind':'allyBlind';p.raw[axis]+=total;p.episodes.push({anchorId:`${roundId}:blind:${hash(key).slice(0,12)}`,axis,rawValue:total,tags:[]});}
  for(const e of events){const p=e.actorId?profiles.get(e.actorId):undefined;if(!p)continue;if(e.kind==='BOMB_PLANTED'&&e.context?.actorSide==='T'){p.objectives.plants++;p.episodes.push({anchorId:e.id,axis:'plants',rawValue:1,tags:[]});}if(e.kind==='BOMB_DEFUSED'&&e.context?.actorSide==='CT'){p.objectives.defuses++;p.episodes.push({anchorId:e.id,axis:'defuses',rawValue:1,tags:[]});}}
  const armorRows:Array<{anchorId:string;roundId:string;playerId:string;relation:'ENEMY'|'ALLY';axis:'enemyArmor'|'allyArmor';value:number}>=[];for(const h of hurts.sort((a,b)=>a.tick-b.tick||rowOrder(a)-rowOrder(b))){const raw=h.attrs.rawArmorDamage,rel=relation(teams,h.actorId,h.targetId),p=h.actorId?profiles.get(h.actorId):undefined;if(!finite(raw)||raw<=0||!p||(rel!=='ENEMY'&&rel!=='ALLY'))continue;const axis=rel==='ENEMY'?'enemyArmor':'allyArmor';p.raw[axis]+=raw;const ep=p.episodes.find((e)=>e.anchorId===h.id);if(ep){ep.components??=ep.axis?{[ep.axis]:ep.rawValue!}:{};delete ep.axis;delete ep.rawValue;ep.components[axis]=raw;}else p.episodes.push({anchorId:h.id,axis,rawValue:raw,tags:[]});armorRows.push({anchorId:h.id,roundId:h.roundId,playerId:p.playerId,relation:rel,axis,value:raw});}
  const bySteam=new Map(match.players.map((p)=>[p.steamId,profiles.get(p.id)]));const hostageActions:C2S2PreparedSidecar['hostageActions']=[];const seenHostage=new Set<string>();for(const row of hostageRows){const decoded=decodeParticipationRow(row),name=decoded.eventName;if(name!=='hostage_hurt'&&name!=='hostage_rescued')continue;const tick=decoded.tick,steam=decoded.actorSteamId,hostage=decoded.hostageId;if(tick===null||!steam)continue;const round=validRounds.find((r)=>cleanIds.has(r.id)&&tick>=boundaries.get(r.id)!.liveStart&&tick<=boundaries.get(r.id)!.liveEnd),p=bySteam.get(steam);if(!round||!p)continue;const key=`${name}|${round.id}|${tick}|${steam}|${hostage??'unknown'}`;if(seenHostage.has(key))continue;seenHostage.add(key);if(name==='hostage_rescued'){if(round.sideByTeamId[p.teamId]!=='CT')continue;p.objectives.hostageRescues++;}else p.objectives.hostageHurts++;hostageActions.push({event:name,roundId:round.id,tick,playerId:p.playerId,hostage});}
  const anchorFor=new Map(deaths.map((d)=>[d.id,lethalLink(d,hurts,hp.values)??d.id]));for(const link of trades){if(link.delaySeconds<=1)addTag(profiles.get(link.revenge.actorId??''),anchorFor.get(link.revenge.id),'FAST_TRADE');}for(const t of clean)for(const s of t.state.snapshots)for(const id of s.eventIds){const d=deaths.find((x)=>x.id===id);if(d?.relation==='ENEMY'&&d.actorTeamId&&d.targetTeamId&&(s.pre[d.actorTeamId]??0)===(s.pre[d.targetTeamId]??0)&&(s.post[d.actorTeamId]??0)>(s.post[d.targetTeamId]??0))addTag(profiles.get(d.actorId??''),anchorFor.get(d.id),'ALIVE_LEAD_TAKEN');}
  const equipment=new Map(events.filter((e)=>e.kind==='ECONOMY_SNAPSHOT'&&e.actorId&&finite(e.attrs.equipmentValue)).map((e)=>[`${e.roundId}|${e.actorId}`,e.attrs.equipmentValue as number]));for(const e of [...hurts,...deaths].filter((x)=>relation(teams,x.actorId,x.targetId)==='ENEMY')){const av=e.actorId?equipment.get(`${e.roundId}|${e.actorId}`):undefined,team=e.actorId?teams.get(e.actorId):undefined;const opp=[...profiles.values()].filter((p)=>p.teamId!==team).map((p)=>equipment.get(`${e.roundId}|${p.playerId}`)).filter((v):v is number=>finite(v)).sort((a,b)=>a-b);const median=opp.length?opp[Math.floor(opp.length/2)]:null;if(finite(av)&&finite(median)&&median>=2500&&av<=.5*median)addTag(e.actorId?profiles.get(e.actorId):undefined,e.kind==='PLAYER_DEATH'?anchorFor.get(e.id):e.id,'LOW_EQUIP_COMBAT');}
  for(const [key,ints] of blindGroups){const [actorId,targetId,roundId]=key.split('|') as [string,string,string];if(relation(teams,actorId,targetId)!=='ENEMY')continue;const anchor=`${roundId}:blind:${hash(key).slice(0,12)}`,p=profiles.get(actorId);const contains=(e:MatchEvent)=>ints.some(([s,end])=>e.tick/(match.tickRate??1)>=s&&e.tick/(match.tickRate??1)<=end);if(events.some((e)=>e.roundId===roundId&&e.kind==='PLAYER_HURT'&&e.targetId===targetId&&e.actorId!==actorId&&teams.get(e.actorId??'')===teams.get(actorId)&&contains(e)))addTag(p,anchor,'FLASH_TEAM_DAMAGE_WINDOW');if(events.some((e)=>e.roundId===roundId&&e.kind==='PLAYER_DEATH'&&e.targetId===targetId&&e.actorId!==actorId&&teams.get(e.actorId??'')===teams.get(actorId)&&contains(e)))addTag(p,anchor,'FLASH_TEAM_KILL_WINDOW');}
  return{profiles:[...profiles.values()],hostageActions,armorRows};
}
function addTag(profile:Profile|undefined,anchorId:string|undefined,tag:ContextTag){const ep=profile?.episodes.find((e)=>e.anchorId===anchorId);if(ep&&!ep.tags.includes(tag))ep.tags=[...ep.tags,tag].sort() as ContextTag[];}

const PHYSICAL_REFS: Record<string, number> = {
  enemyHp: 28.237442028985516,
  enemyKills: .3197764705882353,
  enemyArmor: 5.049757894736842,
  assists: .1183588235294118,
  enemyBlind: .6614618600853558,
  ownDeaths: .1586729096989967,
  allyHp: .6540792744080582,
  allyKills: .012540613564485997,
  allyBlind: .303433612623422,
  allyArmor: .05294927459493805,
};
const PHYSICAL_WEIGHTS: Record<string, number> = {
  enemyHp: .14,
  enemyKills: .175,
  enemyArmor: .035,
  assists: .125,
  enemyBlind: .125,
  ownDeaths: .2,
  allyHp: .05,
  allyKills: .05,
  allyBlind: .05,
  allyArmor: .05,
};
const PHYSICAL_DIRECTIONS: Record<string, number> = {
  enemyHp: 1,
  enemyKills: 1,
  enemyArmor: 1,
  assists: 1,
  enemyBlind: 1,
  ownDeaths: -1,
  allyHp: -1,
  allyKills: -1,
  allyBlind: -1,
  allyArmor: -1,
};
const PHYSICAL_FAMILIES: Record<string, ParticipationPhysicalFamily> = {
  enemyHp: 'COMBAT',
  enemyKills: 'COMBAT',
  enemyArmor: 'COMBAT',
  assists: 'SUPPORT',
  enemyBlind: 'SUPPORT',
  ownDeaths: 'DEATH_RELATED',
  allyHp: 'DIRECT_HARM',
  allyKills: 'DIRECT_HARM',
  allyBlind: 'DIRECT_HARM',
  allyArmor: 'DIRECT_HARM',
};
const PHYSICAL_BASELINES = {
  COMBAT: .6301839531026205,
  SUPPORT: .36749503251163657,
  DEATH_RELATED: -.9163102943158531,
  DIRECT_HARM: 0,
};

type PhysicalAnchor = {
  anchorId: string;
  components: Record<string, number>;
  tags: string[];
};

type ObjectiveCounts = {
  plants: number;
  defuses: number;
  hostageRescues: number;
  hostageHurts: number;
};

export function prepareObjectiveSignals(
  scenario: Profile['scenario'],
  objectives: ObjectiveCounts,
  exposure: { rounds: number; tRounds: number; ctRounds: number },
): Record<string, number> {
  if (scenario === 'UNKNOWN') return {};
  if (scenario === 'BOMB') {
    return {
      'objective:plants': exposure.tRounds > 0
        ? .05 * objectives.plants / .12355 / exposure.tRounds
        : 0,
      'objective:defuses': exposure.ctRounds > 0
        ? .05 * objectives.defuses / .07155950973368645 / exposure.ctRounds
        : 0,
    };
  }
  return {
    'objective:hostageRescues': exposure.ctRounds > 0
      ? .08 * objectives.hostageRescues / .026835947523339676 / exposure.ctRounds
      : 0,
    'objective:hostageHurts': exposure.rounds > 0
      ? -.02 * objectives.hostageHurts / .22414985539395899 / exposure.rounds
      : 0,
  };
}

export function preparePhysicalFamilyContributions(
  anchors: readonly PhysicalAnchor[],
  rounds: number,
): {
  familyContributions: Record<ParticipationFamily, number>;
  episodeContributions: C2S2EpisodeContribution[];
} {
  const signals: Record<ParticipationPhysicalFamily, number> = {
    COMBAT: 0,
    SUPPORT: 0,
    DEATH_RELATED: 0,
    DIRECT_HARM: 0,
  };
  const episodeContributions: C2S2EpisodeContribution[] = [];

  for (const anchor of anchors) {
    const candidates = Object.entries(anchor.components)
      .filter(([axis, value]) => axis in PHYSICAL_REFS && finite(value))
      .map(([axis, value]) => ({
        axis,
        value: PHYSICAL_DIRECTIONS[axis]!
          * PHYSICAL_WEIGHTS[axis]!
          * value
          / PHYSICAL_REFS[axis]!
          / rounds,
      }))
      .sort((left, right) => Math.abs(right.value) - Math.abs(left.value)
        || left.axis.localeCompare(right.axis));
    const chosen = candidates[0];
    if (!chosen) continue;

    const family = PHYSICAL_FAMILIES[chosen.axis]!;
    signals[family] += chosen.value;
    episodeContributions.push({
      anchorId: anchor.anchorId,
      chosenAxis: chosen.axis,
      family,
      base: chosen.value,
      tags: anchor.tags,
    });
  }

  return {
    familyContributions: {
      COMBAT: .1 * (signals.COMBAT - PHYSICAL_BASELINES.COMBAT),
      SUPPORT: .1 * (signals.SUPPORT - PHYSICAL_BASELINES.SUPPORT),
      DEATH_RELATED: .1 * (signals.DEATH_RELATED - PHYSICAL_BASELINES.DEATH_RELATED),
      DIRECT_HARM: .1 * signals.DIRECT_HARM,
      CONTEXT: 0,
      OBJECTIVES: 0,
    },
    episodeContributions,
  };
}

function prepareFamilyProfile(profile: Profile): C2S2PreparedProfileDto {
  const unavailable = (
    status: 'WITHHELD_REQUIRED_INPUT' | 'UNKNOWN_APPLICABILITY',
    reason: string,
  ) => ({ status, reason });

  if (profile.requiredInputStatus !== 'COMPLETE') {
    return {
      ...profile,
      p4BPlus: unavailable('WITHHELD_REQUIRED_INPUT', profile.requiredInputStatus),
      p4CPlus: unavailable('WITHHELD_REQUIRED_INPUT', profile.requiredInputStatus),
    };
  }
  if (!(profile.rounds > 0)) {
    return {
      ...profile,
      p4BPlus: unavailable('WITHHELD_REQUIRED_INPUT', 'NO_VERIFIED_EXPOSURE'),
      p4CPlus: unavailable('WITHHELD_REQUIRED_INPUT', 'NO_VERIFIED_EXPOSURE'),
    };
  }

  const physicalAnchors = profile.episodes.map((episode) => ({
    anchorId: episode.anchorId,
    components: episode.components ?? (episode.axis ? { [episode.axis]: episode.rawValue! } : {}),
    tags: episode.tags,
  }));
  const physical = preparePhysicalFamilyContributions(physicalAnchors, profile.rounds);
  const p4BPlus = {
    status: 'CALCULATED_RESEARCH_ONLY' as const,
    reason: null,
    ...physical,
  };
  const p4CPlus: C2S2PreparedProfileDto['p4CPlus'] = {
    ...p4BPlus,
    objectiveSignals: prepareObjectiveSignals(
      profile.scenario,
      profile.objectives,
      {
        rounds: profile.rounds,
        tRounds: profile.tRounds,
        ctRounds: profile.ctRounds,
      },
    ),
  };

  return {
    profileKey: profile.profileKey,
    playerId: profile.playerId,
    teamId: profile.teamId,
    scenario: profile.scenario,
    rounds: profile.rounds,
    validRounds: profile.validRounds,
    tRounds: profile.tRounds,
    ctRounds: profile.ctRounds,
    requiredInputStatus: profile.requiredInputStatus,
    p4BPlus,
    p4CPlus,
  };
}

export function buildPreparedParticipationInput(snapshot:ParsedDemoSnapshot,match:MatchData,supplement:ParsedParticipationSupplement,options?:{allowIncompleteRoster?:boolean}):C2S2PreparedSidecar{
  const { lifecycleRows, hostageRows } = readPreparedParticipationSupplementRows(supplement);
  const paths = trajectories(
    snapshot,
    match,
    [...snapshot.events, ...lifecycleRows],
    options?.allowIncompleteRoster === true,
  );
  const built = buildProfiles(snapshot, match, paths, hostageRows);
  const prepared = built.profiles.map(prepareFamilyProfile);
  const physicalAnchors = built.profiles.flatMap((profile) => profile.episodes.map((episode) => ({
    profileKey: profile.profileKey,
    anchorId: episode.anchorId,
    components: episode.components ?? (episode.axis ? { [episode.axis]: episode.rawValue! } : {}),
    tags: episode.tags,
  })));
  const allowedTags = new Set<string>(CONTEXT_TAGS);
  const contextTags = physicalAnchors.flatMap((anchor) => anchor.tags
    .filter((tag): tag is ContextTag => allowedTags.has(tag))
    .map((tag) => ({ profileKey: anchor.profileKey, anchorId: anchor.anchorId, tag })));

  return c2s2PreparedSidecarSchema.parse({
    schemaVersion: C2S2_SIDECAR_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    binding: {
      matchId: match.matchId,
      fileSha256: match.fileSha256,
      parserVersion: PARSER_LIBRARY_VERSION,
      normalizerVersion: NORMALIZER_VERSION,
    },
    model: {
      modelVersion: C2S2_MODEL_VERSION,
      policyDigest: C2S2_POLICY_DIGEST,
      referenceVersion: C2S2_REFERENCE_VERSION,
    },
    scenario: scenarioFor(snapshot, match.map),
    roundEvidence: paths.map((path) => ({
      roundId: path.roundId,
      clean: path.clean,
      reasons: path.reasons,
      boundary: path.boundary,
    })),
    hostageActions: built.hostageActions,
    armorAxes: built.armorRows,
    physicalAnchors,
    contextTagRegistry: CONTEXT_TAGS,
    contextTags,
    preparedProfiles: prepared,
  });
}

