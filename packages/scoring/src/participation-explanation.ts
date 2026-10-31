import {
  participationExplanationReportSchema,
  type CanonicalMatchResult,
  type MatchEvent,
  type ParticipationExplanationFamilyRow,
  type ParticipationExplanationReport
} from '@who-ruined/contracts';
import { C2S2_POLICY, type C2S2EpisodeContribution, type C2S2Family } from './participation-family-kernel.js';
import {
  P72_POLICIES,
  projectP72ParticipationRatings,
  type P72CalculatedProjection,
  type P72ParticipationPreparedProfile
} from './participation-rating.js';
import { buildImportantMoments } from './important-moments.js';

const EPSILON = 1e-12;
const FAMILY_ORDER = ['COMBAT','SUPPORT','DEATH_RELATED','OBJECTIVES','CONTEXT','DIRECT_HARM'] as const;

type Calculated = P72CalculatedProjection;
type Source = ParticipationExplanationFamilyRow['sources'][number];
type Transform = ParticipationExplanationFamilyRow['transformations'][number];

function compactFamilies(value: { [K in C2S2Family]?: number | undefined } | null | undefined): Partial<Record<C2S2Family, number>> | null {
  if (!value) return null;
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === 'number')) as Partial<Record<C2S2Family, number>>;
}

function close(left: number, right: number, label: string): void {
  if (Math.abs(left - right) > EPSILON) throw new Error(`${label}_MISMATCH`);
}

function eventEvidence(
  anchorId: string,
  eventById: ReadonlyMap<string, MatchEvent>,
  roundIds: readonly string[]
): { roundIds: string[]; evidenceEventIds: string[] } {
  const event = eventById.get(anchorId);
  if (event) return { roundIds: [event.roundId], evidenceEventIds: [event.id] };
  const roundId = [...roundIds].sort((left, right) => right.length - left.length)
    .find((candidate) => anchorId === candidate || anchorId.startsWith(`${candidate}:`));
  return { roundIds: roundId ? [roundId] : [], evidenceEventIds: [] };
}

function sourceReason(family: C2S2Family): Source['reason'] {
  switch (family) {
    case 'COMBAT': return 'CONFIRMED_COMBAT_EVENT';
    case 'SUPPORT': return 'CONFIRMED_SUPPORT_EVENT';
    case 'DEATH_RELATED': return 'RECORDED_DEATH_EVENT';
    case 'DIRECT_HARM': return 'CONFIRMED_FRIENDLY_HARM';
    case 'CONTEXT': return 'CONTEXT_FACTOR';
    case 'OBJECTIVES': return 'OBJECTIVE_FACTOR';
  }
}

function finalPart(rawFamily: number, rawPart: number): number | null {
  return rawFamily >= 0 ? 10 * rawPart : null;
}

function physicalSources(
  family: Extract<C2S2Family, 'COMBAT' | 'SUPPORT' | 'DEATH_RELATED'>,
  rawInput: number,
  episodes: C2S2EpisodeContribution[],
  eventById: ReadonlyMap<string, MatchEvent>,
  roundIds: readonly string[]
): Source[] {
  const grouped = new Map<string, Source>();
  for (const episode of episodes.filter((item) => item.family === family)) {
    const evidence = eventEvidence(episode.anchorId, eventById, roundIds);
    const key = `${evidence.roundIds[0] ?? ''}\u0000${evidence.evidenceEventIds.length > 0 ? 'EVENT' : 'AGGREGATE'}`;
    const rawContribution = C2S2_POLICY.scoreScale * episode.base;
    const current = grouped.get(key);
    if (current) {
      current.rawContribution += rawContribution;
      current.finalContribution = finalPart(rawInput, current.rawContribution);
      current.evidenceEventIds = [...new Set([...current.evidenceEventIds, ...evidence.evidenceEventIds])];
    } else {
      grouped.set(key, {
        kind: evidence.evidenceEventIds.length > 0 ? 'EVENT' : 'AGGREGATE',
        reason: sourceReason(family),
        rawContribution,
        finalContribution: finalPart(rawInput, rawContribution),
        roundIds: evidence.roundIds,
        evidenceEventIds: evidence.evidenceEventIds
      });
    }
  }
  const sources = [...grouped.values()].sort((left, right) => (left.roundIds[0] ?? '').localeCompare(right.roundIds[0] ?? '') || left.kind.localeCompare(right.kind));
  const explained = sources.reduce((sum, source) => sum + source.rawContribution, 0);
  const residual = rawInput - explained;
  if (Math.abs(residual) > EPSILON) {
    sources.push({
      kind: 'BASELINE', reason: 'MODEL_BASELINE', rawContribution: residual,
      finalContribution: finalPart(rawInput, residual), roundIds: [], evidenceEventIds: []
    });
  }
  close(sources.reduce((sum, source) => sum + source.rawContribution, 0), rawInput, `${family}_SOURCE_RECONSTRUCTION`);
  return sources;
}

function objectiveEventKinds(factor: string): string[] {
  if (factor === 'objective:plants') return ['BOMB_PLANTED'];
  if (factor === 'objective:defuses') return ['BOMB_DEFUSED'];
  if (factor === 'objective:hostageRescues') return ['HOSTAGE_RESCUED'];
  if (factor === 'objective:hostageHurts') return ['HOSTAGE_HURT'];
  return [];
}

function aggregateSources(
  family: 'CONTEXT' | 'OBJECTIVES',
  projection: Calculated,
  playerId: string,
  events: MatchEvent[],
  roundIds: readonly string[]
): Source[] {
  const rawInput = projection.rawFamilyInputs[family];
  if (family === 'CONTEXT') {
    const anchors = Object.keys(projection.kernel.context.winningTagByAnchor);
    const evidence = anchors.map((anchor) => eventEvidence(anchor, new Map(events.map((event) => [event.id, event])), roundIds));
    return rawInput === 0 && anchors.length === 0 ? [] : [{
      kind: 'AGGREGATE', reason: 'CONTEXT_FACTOR', rawContribution: rawInput,
      finalContribution: finalPart(rawInput, rawInput),
      roundIds: [...new Set(evidence.flatMap((item) => item.roundIds))],
      evidenceEventIds: [...new Set(evidence.flatMap((item) => item.evidenceEventIds))]
    }];
  }
  const sources = Object.entries(projection.kernel.factorContributions.OBJECTIVES)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([factor, rawContribution]): Source => {
      const relevant = events.filter((event) => event.actorId === playerId && objectiveEventKinds(factor).includes(event.kind));
      return {
        kind: relevant.length > 0 ? 'EVENT' : 'AGGREGATE', reason: 'OBJECTIVE_FACTOR', rawContribution,
        finalContribution: finalPart(rawInput, rawContribution),
        roundIds: [...new Set(relevant.map((event) => event.roundId))],
        evidenceEventIds: relevant.map((event) => event.id)
      };
    });
  close(sources.reduce((sum, source) => sum + source.rawContribution, 0), rawInput, 'OBJECTIVES_SOURCE_RECONSTRUCTION');
  return sources;
}

function directHarmSources(
  projection: Calculated,
  episodes: C2S2EpisodeContribution[],
  eventById: ReadonlyMap<string, MatchEvent>,
  roundIds: readonly string[],
  multiplier: 1 | 2
): Source[] {
  const sources = Object.entries(projection.kernel.directHarmRoundAllocation).map(([anchorRoundId, rawContribution]): Source => {
    const allocationEvidence = eventEvidence(anchorRoundId, eventById, roundIds);
    const actualRoundId = allocationEvidence.roundIds[0] ?? (roundIds.includes(anchorRoundId) ? anchorRoundId : null);
    const related = episodes.filter((episode) => episode.family === 'DIRECT_HARM').flatMap((episode) => {
      const evidence = eventEvidence(episode.anchorId, eventById, roundIds);
      return evidence.roundIds.includes(actualRoundId ?? '') ? evidence.evidenceEventIds : [];
    });
    return {
      kind: related.length > 0 ? 'EVENT' : 'AGGREGATE', reason: 'CONFIRMED_FRIENDLY_HARM', rawContribution,
      finalContribution: multiplier * rawContribution,
      roundIds: actualRoundId ? [actualRoundId] : [],
      evidenceEventIds: [...new Set([...allocationEvidence.evidenceEventIds, ...related])]
    };
  });
  close(sources.reduce((sum, source) => sum + source.rawContribution, 0), projection.rawFamilyInputs.DIRECT_HARM, 'DIRECT_HARM_SOURCE_RECONSTRUCTION');
  return sources;
}

function transforms(family: C2S2Family, projection: Calculated, harmMultiplier: 1 | 2): Transform[] {
  const rawInput = projection.rawFamilyInputs[family];
  const finalAttribution = projection.finalAttribution[family];
  if (family === 'DIRECT_HARM') {
    return [
      {
        code: 'DIRECT_HARM_SOFTENING', scope: 'FAMILY', input: projection.kernel.directHarm.raw,
        output: projection.kernel.directHarm.soft, adjustment: projection.kernel.directHarm.adjustment
      },
      {
        code: 'DIRECT_HARM_MULTIPLIER', scope: 'FAMILY', input: rawInput,
        output: harmMultiplier * rawInput, adjustment: finalAttribution - rawInput
      }
    ];
  }
  const rows: Transform[] = [];
  if (family === 'CONTEXT') {
    rows.push({ code: 'CONTEXT_CENTERING', scope: 'FAMILY', input: projection.kernel.context.uncenteredSignal, output: rawInput, adjustment: null });
    if (projection.kernel.context.saturated) rows.push({ code: 'CONTEXT_SATURATION', scope: 'FAMILY', input: null, output: projection.kernel.context.uncenteredSignal, adjustment: null });
  }
  if (family === 'OBJECTIVES' && (projection.kernel.objectives.positiveCapped || projection.kernel.objectives.negativeCapped)) {
    rows.push({ code: 'OBJECTIVE_CAP', scope: 'FAMILY', input: null, output: rawInput, adjustment: null });
  }
  rows.push(rawInput < 0
    ? { code: 'NEGATIVE_MASS_SOFTENING', scope: 'CROSS_FAMILY', input: rawInput, output: finalAttribution, adjustment: finalAttribution - rawInput }
    : { code: 'POSITIVE_LINEAR_SCALE', scope: 'FAMILY', input: rawInput, output: finalAttribution, adjustment: finalAttribution - rawInput });
  return rows;
}

function familyRows(result: CanonicalMatchResult, projection: Calculated): ParticipationExplanationFamilyRow[] {
  const profile = result.internal.recomputeSeed.profiles.find((item) => item.profileKey === projection.profileKey);
  if (!profile) throw new Error('EXPLANATION_PROFILE_NOT_FOUND');
  const eventById = new Map(result.artifact.match.events.map((event) => [event.id, event]));
  const roundIds = result.artifact.match.rounds.map((round) => round.id);
  const episodes = profile.prepared.p4CPlus.episodeContributions ?? profile.prepared.p4BPlus.episodeContributions ?? [];
  const harmMultiplier = P72_POLICIES[result.internal.selectedPolicySelector].harmMultiplier;
  return FAMILY_ORDER.map((family) => {
    let sources: Source[];
    if (family === 'COMBAT' || family === 'SUPPORT' || family === 'DEATH_RELATED') {
      sources = physicalSources(family, projection.rawFamilyInputs[family], episodes, eventById, roundIds);
    } else if (family === 'DIRECT_HARM') {
      sources = directHarmSources(projection, episodes, eventById, roundIds, harmMultiplier);
    } else {
      sources = aggregateSources(family, projection, projection.playerId, result.artifact.match.events, roundIds);
    }
    return {
      family,
      rawInput: projection.rawFamilyInputs[family],
      finalAttribution: projection.finalAttribution[family],
      sources,
      transformations: transforms(family, projection, harmMultiplier)
    };
  });
}

export function buildParticipationExplanation(result: CanonicalMatchResult): ParticipationExplanationReport {
  const profiles: P72ParticipationPreparedProfile[] = result.internal.recomputeSeed.profiles.map((profile) => ({
    profileKey: profile.profileKey,
    playerId: profile.playerId,
    teamId: profile.teamId,
    status: profile.status,
    reason: profile.reason,
    prepared: {
      profileKey: profile.prepared.profileKey,
      scenario: profile.prepared.scenario,
      p4BPlus: {
        status: profile.prepared.p4BPlus.status,
        reason: profile.prepared.p4BPlus.reason ?? null,
        familyContributions: compactFamilies(profile.prepared.p4BPlus.familyContributions),
        objectiveSignals: profile.prepared.p4BPlus.objectiveSignals ?? null,
        episodeContributions: profile.prepared.p4BPlus.episodeContributions ?? null
      },
      p4CPlus: {
        status: profile.prepared.p4CPlus.status,
        reason: profile.prepared.p4CPlus.reason ?? null,
        familyContributions: compactFamilies(profile.prepared.p4CPlus.familyContributions),
        objectiveSignals: profile.prepared.p4CPlus.objectiveSignals ?? null,
        episodeContributions: profile.prepared.p4CPlus.episodeContributions ?? null
      }
    }
  }));
  const projections = new Map(projectP72ParticipationRatings(profiles, result.internal.selectedPolicySelector)
    .map((projection) => [projection.playerId, projection]));
  const moments = buildImportantMoments(result.artifact);
  const players = result.activeRating.players.map((activePlayer) => {
    const projection = projections.get(activePlayer.playerId);
    if (!projection) throw new Error('EXPLANATION_PROJECTION_NOT_FOUND');
    if (projection.status !== activePlayer.availability.status) throw new Error('EXPLANATION_AVAILABILITY_MISMATCH');
    if (projection.rating === null || activePlayer.rating === null) {
      if (projection.rating !== null || activePlayer.rating !== null) throw new Error('EXPLANATION_NULL_RATING_MISMATCH');
      return {
        playerId: activePlayer.playerId,
        teamId: activePlayer.teamId,
        availability: activePlayer.availability,
        rating: null,
        importantMoments: moments.byPlayer.get(activePlayer.playerId) ?? []
      };
    }
    close(projection.rating, activePlayer.rating.value, 'EXPLANATION_RATING');
    for (const family of FAMILY_ORDER) {
      close(projection.rawFamilyInputs[family], activePlayer.rating.rawFamilyInputs[family], `EXPLANATION_${family}_RAW`);
      close(projection.finalAttribution[family], activePlayer.rating.finalAttribution[family], `EXPLANATION_${family}_FINAL`);
    }
    const reconstructed = 1 + FAMILY_ORDER.reduce((sum, family) => sum + activePlayer.rating!.finalAttribution[family], 0);
    close(reconstructed, activePlayer.rating.value, 'EXPLANATION_ARITHMETIC');
    return {
      playerId: activePlayer.playerId,
      teamId: activePlayer.teamId,
      availability: activePlayer.availability,
      rating: {
        value: activePlayer.rating.value,
        arithmetic: { origin: 1 as const, reconstructed, tolerance: 1e-12 as const, exactWithinTolerance: true as const },
        aggregates: activePlayer.rating.aggregates,
        families: familyRows(result, projection)
      },
      importantMoments: moments.byPlayer.get(activePlayer.playerId) ?? []
    };
  });
  return participationExplanationReportSchema.parse({
    schemaVersion: 'm4.6-participation-explanation@1',
    reportVersion: 'match-result@1',
    matchId: result.artifact.match.matchId,
    experimental: true,
    calibrated: false,
    causalBlame: false,
    players,
    importantMoments: moments.match,
    provenance: { source: 'match-result@1', originalDemoParsedAtRequest: false }
  });
}
