import type { ParticipationSidecar } from '@who-ruined/contracts';
import {
  C2S2_MODEL_VERSION,
  C2S2_POLICY_DIGEST,
  C2S2_REFERENCE_VERSION,
} from '@who-ruined/scoring';
import { syntheticValidMatch } from '@who-ruined/testkit';
import {
  PARTICIPATION_SIDECAR_POLICIES,
  PARTICIPATION_SIDECAR_SCHEMA_VERSION,
} from '../../src/participation-model.js';

export function syntheticParticipationSidecar(): ParticipationSidecar {
  const match = syntheticValidMatch();
  const profiles = match.players.map((player, index) => {
    const tRounds = match.rounds.filter(
      (round) => round.sideByTeamId[player.teamId] === 'T',
    ).length;
    const ctRounds = match.rounds.length - tRounds;
    const calculated = {
      status: 'CALCULATED_RESEARCH_ONLY' as const,
      reason: null,
      familyContributions: {
        COMBAT: 0,
        SUPPORT: 0,
        DEATH_RELATED: 0,
        DIRECT_HARM: 0,
        CONTEXT: 0,
        OBJECTIVES: 0,
      },
      episodeContributions: [],
    };
    const prepared = {
      profileKey: `${match.matchId}:P${String(index + 1).padStart(2, '0')}`,
      playerId: player.id,
      teamId: player.teamId,
      scenario: 'BOMB' as const,
      rounds: match.rounds.length,
      validRounds: match.rounds.length,
      tRounds,
      ctRounds,
      requiredInputStatus: 'COMPLETE',
      p4BPlus: calculated,
      p4CPlus: {
        ...calculated,
        objectiveSignals: { 'objective:plants': 0, 'objective:defuses': 0 },
      },
    };
    return {
      profileKey: prepared.profileKey,
      playerId: player.id,
      teamId: player.teamId,
      status: 'ELIGIBLE' as const,
      reason: null,
      verifiedRounds: match.rounds.length,
      absentRounds: 0,
      partialRounds: 0,
      unknownRounds: 0,
      globalExcludedRounds: 0,
      tRounds,
      ctRounds,
      countedRoundIds: match.rounds.map((round) => round.id),
      excludedRoundIds: [],
      prepared,
    };
  });
  return {
    schemaVersion: PARTICIPATION_SIDECAR_SCHEMA_VERSION,
    createdAt: '2026-11-05T00:00:00.000Z',
    fingerprint: 'f'.repeat(64),
    binding: {
      matchId: match.matchId,
      fileSha256: match.fileSha256,
      parserVersion: 'synthetic-parser',
      normalizerVersion: 'synthetic-normalizer',
    },
    model: {
      preparedInputModel: C2S2_MODEL_VERSION,
      preparedInputDigest: C2S2_POLICY_DIGEST,
      referenceVersion: C2S2_REFERENCE_VERSION,
      policies: PARTICIPATION_SIDECAR_POLICIES,
    },
    scenario: 'BOMB',
    participation: [],
    profiles,
    provenance: {
      source: 'RAW_DEMO_EVENTS_AND_TICKS',
      lifecycleEvents: [],
      contextTags: [],
      s2AppliedBy: 'synthetic-test',
    },
  };
}
