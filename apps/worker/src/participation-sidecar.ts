import type { C2S2PreparedProfileDto, MatchData } from '@who-ruined/contracts';
import { sha256Canonical } from '@who-ruined/artifacts';
import {
  NORMALIZER_VERSION,
  PARSER_LIBRARY_VERSION,
  readParticipationEvidenceFacts,
  type ParsedDemoSnapshot,
  type ParsedParticipationSupplement,
} from '@who-ruined/parser-adapter';
import {
  C2S2_MODEL_VERSION,
  C2S2_POLICY_DIGEST,
  C2S2_REFERENCE_VERSION,
} from '@who-ruined/scoring';
import {
  buildPreparedParticipationInput,
  prepareObjectiveSignals,
  preparePhysicalFamilyContributions,
} from './prepared-participation-input.js';
import { classifyParticipation } from './participation-evidence.js';
import {
  PARTICIPATION_SIDECAR_POLICIES,
  PARTICIPATION_SIDECAR_SCHEMA_VERSION,
  type ParticipationClass,
  type ParticipationProfile,
  type ParticipationRound,
  type ParticipationSidecar,
} from './participation-model.js';
import { validateParticipationSidecar } from './participation-sidecar-codec.js';

export * from './participation-evidence.js';
export * from './participation-model.js';
export * from './participation-sidecar-codec.js';

const CONTEXT_TAGS=['OPENING','TRADE','FAST_TRADE','MULTI_KILL','DISADVANTAGE','ALIVE_LEAD_TAKEN','POSTPLANT','FLASH_ASSIST','FLASH_TEAM_KILL_WINDOW','FLASH_TEAM_DAMAGE_WINDOW','LOW_EQUIP_COMBAT'];
const MATERIAL_KINDS=new Set(['PLAYER_DEATH','PLAYER_HURT','PLAYER_BLIND','BOMB_PLANTED','BOMB_DEFUSED','BOMB_EXPLODED','HOSTAGE_RESCUED','HOSTAGE_HURT']);
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v);
const digest=sha256Canonical;

type PreparedInput = ReturnType<typeof buildPreparedParticipationInput>;
type LifecycleEvidence = {
  playerId: string;
  tick: number;
  kind: string;
  order: number;
};

function anchorRound(
  anchorId: string,
  eventRounds: Map<string, string>,
  roundIds: readonly string[],
): string | null {
  const direct = eventRounds.get(anchorId);
  if (direct) return direct;
  return roundIds.find((roundId) => (
    anchorId === roundId || anchorId.startsWith(`${roundId}:`)
  )) ?? null;
}

function prepareProfile(
  base: PreparedInput,
  source: C2S2PreparedProfileDto,
  allowedRounds: Set<string>,
  roundById: Map<string, MatchData['rounds'][number]>,
  teamId: string,
  eventRounds: Map<string, string>,
): C2S2PreparedProfileDto {
  const tRounds = [...allowedRounds]
    .filter((roundId) => roundById.get(roundId)?.sideByTeamId[teamId] === 'T')
    .length;
  const ctRounds = [...allowedRounds]
    .filter((roundId) => roundById.get(roundId)?.sideByTeamId[teamId] === 'CT')
    .length;
  const unavailable = (
    status: 'WITHHELD_REQUIRED_INPUT' | 'UNKNOWN_APPLICABILITY',
    reason: string,
  ) => ({ status, reason });

  if (source.requiredInputStatus !== 'COMPLETE') {
    return {
      ...source,
      rounds: allowedRounds.size,
      tRounds,
      ctRounds,
      p4BPlus: unavailable('WITHHELD_REQUIRED_INPUT', source.requiredInputStatus),
      p4CPlus: unavailable('WITHHELD_REQUIRED_INPUT', source.requiredInputStatus),
    };
  }

  const roundIds = [...roundById.keys()];
  const physicalAnchors = base.physicalAnchors.filter((anchor) => (
    anchor.profileKey === source.profileKey
    && allowedRounds.has(anchorRound(anchor.anchorId, eventRounds, roundIds) ?? '')
  ));
  const physicalContributions = preparePhysicalFamilyContributions(
    physicalAnchors,
    allowedRounds.size,
  );
  const insufficientExposure = unavailable(
    'WITHHELD_REQUIRED_INPUT',
    'WITHHELD_INSUFFICIENT_VERIFIED_EXPOSURE',
  );
  const p4BPlus = allowedRounds.size
    ? {
        status: 'CALCULATED_RESEARCH_ONLY' as const,
        reason: null,
        ...physicalContributions,
      }
    : insufficientExposure;

  let p4CPlus: C2S2PreparedProfileDto['p4CPlus'];
  if (base.scenario === 'UNKNOWN') {
    p4CPlus = {
      ...p4BPlus,
      objectiveSignals: prepareObjectiveSignals(
        base.scenario,
        { plants: 0, defuses: 0, hostageRescues: 0, hostageHurts: 0 },
        { rounds: allowedRounds.size, tRounds, ctRounds },
      ),
    };
  } else if (!allowedRounds.size) {
    p4CPlus = insufficientExposure;
  } else {
    const plants = physicalAnchors
      .filter((anchor) => finite(anchor.components.plants))
      .reduce((total, anchor) => total + (anchor.components.plants ?? 0), 0);
    const defuses = physicalAnchors
      .filter((anchor) => finite(anchor.components.defuses))
      .reduce((total, anchor) => total + (anchor.components.defuses ?? 0), 0);
    const hostageActions = base.hostageActions.filter((action) => (
      action.playerId === source.playerId && allowedRounds.has(action.roundId)
    ));
    const rescues = hostageActions
      .filter((action) => action.event === 'hostage_rescued')
      .length;
    const hurts = hostageActions
      .filter((action) => action.event === 'hostage_hurt')
      .length;
    const objectiveSignals = prepareObjectiveSignals(
      base.scenario,
      {
        plants,
        defuses,
        hostageRescues: rescues,
        hostageHurts: hurts,
      },
      { rounds: allowedRounds.size, tRounds, ctRounds },
    );
    p4CPlus = { ...p4BPlus, objectiveSignals };
  }

  return {
    profileKey: source.profileKey,
    playerId: source.playerId,
    teamId: source.teamId,
    scenario: base.scenario,
    rounds: allowedRounds.size,
    validRounds: source.validRounds,
    tRounds,
    ctRounds,
    requiredInputStatus: 'COMPLETE',
    p4BPlus,
    p4CPlus,
  };
}

function mapLifecycleEvidence(
  match: MatchData,
  rows: ReturnType<typeof readParticipationEvidenceFacts>['lifecycle'],
): LifecycleEvidence[] {
  const playerBySteam = new Map(match.players.map((player) => [player.steamId, player.id]));
  const playerIds = new Set(match.players.map((player) => player.id));
  return rows.flatMap((row) => {
    const playerId = row.steamId
      ? playerBySteam.get(row.steamId) ?? (playerIds.has(row.steamId) ? row.steamId : null)
      : null;
    if (!playerId || row.tick === null || !row.kind) return [];
    return [{
      playerId,
      tick: row.tick,
      kind: row.kind,
      order: row.sourceRowIndex,
    }];
  }).sort((left, right) => left.tick - right.tick || left.order - right.order);
}

function groupByPlayer<T extends { playerId: string }>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const playerRows = grouped.get(row.playerId) ?? [];
    playerRows.push(row);
    grouped.set(row.playerId, playerRows);
  }
  return grouped;
}

function buildParticipationRows(
  match: MatchData,
  base: PreparedInput,
  evidenceFacts: ReturnType<typeof readParticipationEvidenceFacts>,
  lifecycleByPlayer: Map<string, LifecycleEvidence[]>,
): ParticipationRound[] {
  const boundaryByRound = new Map(base.roundEvidence.map((row) => [row.roundId, row]));
  const validRounds = match.rounds.filter((round) => round.isValid);
  const liveStartTicks = new Set(validRounds.map((round) => {
    const liveStart = boundaryByRound.get(round.id)?.boundary.liveStart;
    return finite(liveStart) ? liveStart : 0;
  }));
  const startsByTick = new Map<
    number,
    Map<string, typeof evidenceFacts.ticks>
  >();
  for (const row of evidenceFacts.ticks) {
    if (
      row.tick === null
      || row.steamId === null
      || !liveStartTicks.has(row.tick)
    ) continue;
    const bySteam = startsByTick.get(row.tick) ?? new Map();
    const playerStarts = bySteam.get(row.steamId) ?? [];
    playerStarts.push(row);
    bySteam.set(row.steamId, playerStarts);
    startsByTick.set(row.tick, bySteam);
  }

  const deathByRoundAndTarget = new Map<string, Map<string, MatchData['events'][number]>>();
  const gameplayCountByRoundAndPlayer = new Map<string, Map<string, number>>();
  for (const event of match.events) {
    if (event.context?.phase !== 'LIVE') continue;

    if (event.kind === 'PLAYER_DEATH' && event.targetId) {
      const deathsByTarget = deathByRoundAndTarget.get(event.roundId) ?? new Map();
      if (!deathsByTarget.has(event.targetId)) deathsByTarget.set(event.targetId, event);
      deathByRoundAndTarget.set(event.roundId, deathsByTarget);
    }
    if (!MATERIAL_KINDS.has(event.kind)) continue;

    const gameplayCounts = gameplayCountByRoundAndPlayer.get(event.roundId) ?? new Map();
    const involvedPlayers = new Set(
      [event.actorId, event.targetId, event.assisterId]
        .filter((playerId): playerId is string => playerId !== null),
    );
    for (const playerId of involvedPlayers) {
      gameplayCounts.set(playerId, (gameplayCounts.get(playerId) ?? 0) + 1);
    }
    gameplayCountByRoundAndPlayer.set(event.roundId, gameplayCounts);
  }

  const participation: ParticipationRound[] = [];

  for (const player of match.players) {
    const playerLifecycle = lifecycleByPlayer.get(player.id) ?? [];
    for (const round of validRounds) {
      const roundEvidence = boundaryByRound.get(round.id);
      const boundary = roundEvidence?.boundary;
      const liveStart = finite(boundary?.liveStart) ? boundary.liveStart : 0;
      const liveEnd = finite(boundary?.liveEnd) ? boundary.liveEnd : 0;
      const complete = Boolean(roundEvidence?.clean && boundary?.complete === true);
      const expectedTeamNumber = round.sideByTeamId[player.teamId] === 'T' ? 2 : 3;
      const starts = player.steamId === null
        ? []
        : startsByTick.get(liveStart)?.get(player.steamId) ?? [];
      const start = starts.length === 1 ? starts[0] : null;
      const aliveAtStart = start?.isAlive ?? null;
      const teamNumberAtStart = start?.sideNumber ?? null;
      const lifecycle = playerLifecycle.filter((row) => (
        row.tick >= liveStart && row.tick <= liveEnd
      ));
      const lastDisconnect = playerLifecycle
        .filter((row) => row.kind === 'player_disconnect' && row.tick < liveStart)
        .at(-1);
      const lastReconnect = playerLifecycle
        .filter((row) => (
          ['player_connect', 'player_connect_full'].includes(row.kind)
          && row.tick > (lastDisconnect?.tick ?? -1)
          && row.tick < liveStart
        ))
        .at(-1);
      const death = deathByRoundAndTarget.get(round.id)?.get(player.id);
      const gameplayEventCount = gameplayCountByRoundAndPlayer
        .get(round.id)
        ?.get(player.id) ?? 0;
      const classified = classifyParticipation({
        globalComplete: complete,
        liveStart,
        liveEnd,
        startObserved: Boolean(start),
        startAlive: aliveAtStart,
        startTeamNum: teamNumberAtStart,
        expectedTeamNum: expectedTeamNumber,
        disconnectedBeforeStart: Boolean(lastDisconnect && !lastReconnect),
        reconnectedBeforeStart: Boolean(lastReconnect),
        deathTick: death?.tick ?? null,
        lifecycle,
        gameplayEventCount,
      });

      participation.push({
        roundId: round.id,
        ordinal: round.ordinal,
        playerId: player.id,
        classification: classified.classification,
        reason: classified.reason,
        counted: classified.classification === 'PRESENT_VERIFIED',
        side: round.sideByTeamId[player.teamId] ?? null,
        boundary: { liveStart, liveEnd, complete },
        evidence: {
          startObserved: Boolean(start),
          startAlive: aliveAtStart,
          startTeamNum: teamNumberAtStart,
          deathTick: death?.tick ?? null,
          gameplayEventCount,
          lifecycle: lifecycle.map(({ kind, tick }) => ({ kind, tick })),
        },
      });
    }
  }
  return participation;
}

function buildParticipationProfiles(
  match: MatchData,
  base: PreparedInput,
  participation: ParticipationRound[],
): ParticipationProfile[] {
  const playerById = new Map(match.players.map((player) => [player.id, player]));
  const participationByPlayer = groupByPlayer(participation);
  const validRounds = match.rounds.filter((round) => round.isValid);
  const roundById = new Map(validRounds.map((round) => [round.id, round]));
  const eventRounds = new Map(match.events.map((event) => [event.id, event.roundId]));

  return base.preparedProfiles.map((source) => {
    const player = playerById.get(source.playerId)!;
    const playerParticipation = participationByPlayer.get(player.id) ?? [];
    const counts = new Map<ParticipationClass, number>();
    for (const row of playerParticipation) {
      counts.set(row.classification, (counts.get(row.classification) ?? 0) + 1);
    }
    const count = (classification: ParticipationClass) => counts.get(classification) ?? 0;
    const allowedRounds = new Set(
      playerParticipation.filter((row) => row.counted).map((row) => row.roundId),
    );
    const prepared = prepareProfile(
      base,
      source,
      allowedRounds,
      roundById,
      player.teamId,
      eventRounds,
    );

    let status: ParticipationProfile['status'] = 'ELIGIBLE';
    let reason: string | null = null;
    if (count('ABSENT_FULL_ROUND_VERIFIED') >= 3) {
      status = 'PARTICIPATION_ABSENT_GT_2_ROUNDS';
      reason = 'THREE_OR_MORE_VERIFIED_FULL_ROUND_ABSENCES';
    } else if (count('PARTICIPATION_UNKNOWN')) {
      status = 'PARTICIPATION_EVIDENCE_UNKNOWN';
      reason = 'PLAYER_ROUND_PARTICIPATION_UNKNOWN';
    } else if (prepared.p4CPlus.status === 'UNKNOWN_APPLICABILITY') {
      status = 'UNKNOWN_APPLICABILITY';
      reason = prepared.p4CPlus.reason ?? 'SCENARIO_UNKNOWN';
    } else if (prepared.p4CPlus.status !== 'CALCULATED_RESEARCH_ONLY') {
      status = 'WITHHELD_INSUFFICIENT_VERIFIED_EXPOSURE';
      reason = prepared.p4CPlus.reason ?? 'WITHHELD_INSUFFICIENT_VERIFIED_EXPOSURE';
    }

    return {
      profileKey: source.profileKey,
      playerId: player.id,
      teamId: player.teamId,
      status,
      reason,
      verifiedRounds: count('PRESENT_VERIFIED'),
      absentRounds: count('ABSENT_FULL_ROUND_VERIFIED'),
      partialRounds: count('INTERRUPTED_PARTIAL_ROUND'),
      unknownRounds: count('PARTICIPATION_UNKNOWN'),
      globalExcludedRounds: count('ROUND_GLOBAL_EVIDENCE_MISSING'),
      tRounds: prepared.tRounds,
      ctRounds: prepared.ctRounds,
      countedRoundIds: [...allowedRounds].sort(),
      excludedRoundIds: playerParticipation
        .filter((row) => !row.counted)
        .map((row) => row.roundId)
        .sort(),
      prepared,
    };
  });
}

export function buildParticipationSidecar(
  snapshot: ParsedDemoSnapshot,
  match: MatchData,
  supplement: ParsedParticipationSupplement,
): ParticipationSidecar {
  const evidenceFacts = readParticipationEvidenceFacts(snapshot, supplement);
  const base = buildPreparedParticipationInput(snapshot, match, supplement, {
    allowIncompleteRoster: true,
  });
  const lifecycle = mapLifecycleEvidence(match, evidenceFacts.lifecycle);
  const participation = buildParticipationRows(
    match,
    base,
    evidenceFacts,
    groupByPlayer(lifecycle),
  );
  const profiles = buildParticipationProfiles(match, base, participation);
  const stable = {
    binding: {
      matchId: match.matchId,
      fileSha256: match.fileSha256,
      parserVersion: PARSER_LIBRARY_VERSION,
      normalizerVersion: NORMALIZER_VERSION,
    },
    model: {
      preparedInputModel: C2S2_MODEL_VERSION,
      preparedInputDigest: C2S2_POLICY_DIGEST,
      referenceVersion: C2S2_REFERENCE_VERSION,
      policies: PARTICIPATION_SIDECAR_POLICIES,
    },
    scenario: base.scenario,
    participation,
    profiles,
    provenance: {
      source: 'RAW_DEMO_EVENTS_AND_TICKS' as const,
      lifecycleEvents: evidenceFacts.lifecycleEventNames,
      contextTags: CONTEXT_TAGS,
      s2AppliedBy: '@who-ruined/scoring scoreC2S2PreparedProfiles',
    },
  };
  return validateParticipationSidecar({
    schemaVersion: PARTICIPATION_SIDECAR_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    fingerprint: digest(stable),
    ...stable,
  });
}
