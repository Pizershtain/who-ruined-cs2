import type { ParticipationClass } from './participation-model.js';

export interface ParticipationEvidenceInput {
  globalComplete: boolean;
  liveStart: number;
  liveEnd: number;
  startObserved: boolean;
  startAlive: boolean | null;
  startTeamNum: number | null;
  expectedTeamNum: number;
  disconnectedBeforeStart: boolean;
  reconnectedBeforeStart: boolean;
  deathTick: number | null;
  lifecycle: Array<{ kind: string; tick: number }>;
  gameplayEventCount: number;
}

export function classifyParticipation(
  evidence: ParticipationEvidenceInput,
): { classification: ParticipationClass; reason: string } {
  if (!evidence.globalComplete) {
    return {
      classification: 'ROUND_GLOBAL_EVIDENCE_MISSING',
      reason: 'GLOBAL_BOUNDARY_INCOMPLETE',
    };
  }
  const rows = [...evidence.lifecycle].sort(
    (left, right) => left.tick - right.tick || left.kind.localeCompare(right.kind),
  );
  const disconnects = rows.filter(
    (row) => row.kind === 'player_disconnect'
      && row.tick > evidence.liveStart
      && row.tick < evidence.liveEnd,
  );
  const entries = rows.filter(
    (row) => [
      'player_connect',
      'player_connect_full',
      'player_spawn',
      'player_team',
    ].includes(row.kind)
      && row.tick > evidence.liveStart
      && row.tick < evidence.liveEnd,
  );
  if (
    evidence.startObserved
    && evidence.startAlive === true
    && evidence.startTeamNum === evidence.expectedTeamNum
  ) {
    const material = disconnects.some(
      (row) => evidence.deathTick === null || row.tick < evidence.deathTick,
    );
    return {
      classification: material ? 'INTERRUPTED_PARTIAL_ROUND' : 'PRESENT_VERIFIED',
      reason: material
        ? 'DISCONNECT_WHILE_STILL_ALIVE'
        : disconnects.length
          ? 'DISCONNECT_AFTER_DEATH'
          : 'VERIFIED_ALIVE_ON_EXPECTED_SIDE_AT_LIVE_START',
    };
  }
  if (entries.length || evidence.gameplayEventCount > 0) {
    return {
      classification: 'INTERRUPTED_PARTIAL_ROUND',
      reason: entries.length
        ? 'LATE_ENTRY_OR_REENTRY_DURING_LIVE'
        : 'GAMEPLAY_WITHOUT_VERIFIED_START',
    };
  }
  if (
    evidence.startObserved
    && evidence.startAlive === false
    && ![2, 3].includes(evidence.startTeamNum ?? -1)
    && evidence.disconnectedBeforeStart
    && !evidence.reconnectedBeforeStart
  ) {
    return {
      classification: 'ABSENT_FULL_ROUND_VERIFIED',
      reason: 'DISCONNECTED_AND_NONPLAYING_FOR_FULL_LIVE_INTERVAL',
    };
  }
  return {
    classification: 'PARTICIPATION_UNKNOWN',
    reason: evidence.startObserved
      ? 'START_STATE_NOT_SUFFICIENT_FOR_PRESENCE_OR_ABSENCE'
      : 'START_SNAPSHOT_MISSING',
  };
}
