import { replayMetadataSchema, replayRoundArtifactSchema, type ReplayMetadata, type ReplayRoundArtifact } from '@who-ruined/contracts';
import { ApiClientError, request } from '../../shared/api/transport.js';

export async function getReplayMetadata(id: string, signal: AbortSignal): Promise<ReplayMetadata> {
  const result = await request(`/api/v1/matches/${encodeURIComponent(id)}/replay?version=2`, { signal }, replayMetadataSchema);
  if (result.matchId !== id) throw new ApiClientError('INVALID_RESPONSE');
  return result;
}

export async function getReplayRound(id: string, roundId: string, signal: AbortSignal): Promise<ReplayRoundArtifact> {
  const result = await request(`/api/v1/matches/${encodeURIComponent(id)}/replay/rounds/${encodeURIComponent(roundId)}`, { signal }, replayRoundArtifactSchema);
  if (result.binding.matchId !== id || result.round.id !== roundId) throw new ApiClientError('INVALID_RESPONSE');
  return result;
}
