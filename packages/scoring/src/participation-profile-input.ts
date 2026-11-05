import type { ParticipationSidecar } from '@who-ruined/contracts';
import type { ParticipationFamily } from './participation-family-kernel.js';
import type { ParticipationRatingPreparedProfile } from './participation-rating.js';

type PersistedProfile = ParticipationSidecar['profiles'][number];

function compactFamilies(
  value: { [K in ParticipationFamily]?: number | undefined } | null | undefined,
): Partial<Record<ParticipationFamily, number>> | null {
  if (!value) return null;
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] => typeof entry[1] === 'number',
    ),
  ) as Partial<Record<ParticipationFamily, number>>;
}

function preparedVariant(
  value: PersistedProfile['prepared']['p4BPlus'],
): ParticipationRatingPreparedProfile['prepared']['p4BPlus'] {
  return {
    status: value.status,
    reason: value.reason ?? null,
    familyContributions: compactFamilies(value.familyContributions),
    objectiveSignals: value.objectiveSignals ?? null,
    episodeContributions: value.episodeContributions ?? null,
  };
}

export function toParticipationRatingPreparedProfiles(
  profiles: readonly PersistedProfile[],
): ParticipationRatingPreparedProfile[] {
  return profiles.map((profile) => ({
    profileKey: profile.profileKey,
    playerId: profile.playerId,
    teamId: profile.teamId,
    status: profile.status,
    reason: profile.reason,
    prepared: {
      profileKey: profile.prepared.profileKey,
      scenario: profile.prepared.scenario,
      p4BPlus: preparedVariant(profile.prepared.p4BPlus),
      p4CPlus: preparedVariant(profile.prepared.p4CPlus),
    },
  }));
}
