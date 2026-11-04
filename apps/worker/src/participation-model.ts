import {
  participationSidecarSchemaVersion,
  type ParticipationSidecar as ContractParticipationSidecar,
} from '@who-ruined/contracts';
import { PARTICIPATION_SIDECAR_POLICY_IDENTITIES } from '@who-ruined/scoring';

export const PARTICIPATION_SIDECAR_SCHEMA_VERSION = participationSidecarSchemaVersion;

export const PARTICIPATION_SIDECAR_POLICIES:
ContractParticipationSidecar['model']['policies'] = PARTICIPATION_SIDECAR_POLICY_IDENTITIES
  .map(({ id, digest, harmMultiplier }) => ({ id, digest, harmMultiplier }));

export type ParticipationSidecar = ContractParticipationSidecar;
export type ParticipationRound = ParticipationSidecar['participation'][number];
export type ParticipationClass = ParticipationRound['classification'];
export type ParticipationProfile = ParticipationSidecar['profiles'][number];
