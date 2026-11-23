import { storedParticipationExplanationSchema, type StoredParticipationExplanation } from '@who-ruined/contracts';
import { ApiClientError, request } from '../../shared/api/transport.js';

export async function getParticipationExplanation(id: string, signal: AbortSignal): Promise<StoredParticipationExplanation> {
  const result = await request(`/api/v1/matches/${encodeURIComponent(id)}/experimental-participation-explanation`, { signal }, storedParticipationExplanationSchema);
  if (result.matchId !== id) throw new ApiClientError('INVALID_RESPONSE');
  return result;
}
