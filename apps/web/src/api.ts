import {
  activeParticipationRatingReportSchema, jobDtoSchema, jobStatusSchema, matchDataSchema, matchAnalyticsSchema,
  participationExplanationReportSchema, qualitySchema, replayMetadataSchema, replayRoundArtifactSchema, scoringReportSchema,
  type ActiveParticipationRatingReport, type JobDto, type MatchData, type ParticipationExplanationReport, type ReplayMetadata, type ReplayRoundArtifact, type ScoringReport
} from '@who-ruined/contracts';
import { z } from 'zod';

const uploadResultSchema = z.object({ matchId: z.string().min(1), jobId: z.string().min(1), duplicate: z.boolean() });
const matchesSchema = z.object({
  items: z.array(z.object({ id: z.string().min(1), map: z.string().nullable(), status: jobStatusSchema, quality: qualitySchema.nullable(), createdAt: z.string().datetime() })),
  nextCursor: z.string().optional(),
});
export type MatchList = z.infer<typeof matchesSchema>;

export class ApiClientError extends Error {
  constructor(public readonly code: string, public readonly status = 0, public readonly requestId?: string) { super(code); }
}

function decodeResponse<T>(body: unknown, status: number, schema: z.ZodType<T>): T {
  if (status < 200 || status >= 300) {
    const error = z.object({ error: z.object({ code: z.string() }), requestId: z.string().optional() }).safeParse(body);
    throw new ApiClientError(error.success ? error.data.error.code : 'SERVER_ERROR', status, error.success ? error.data.requestId : undefined);
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiClientError('INVALID_RESPONSE', status);
  return result.data;
}

async function request<T>(url: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
  let response: Response;
  try { response = await fetch(url, init); }
  catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiClientError('NETWORK_ERROR');
  }
  let body: unknown;
  try { body = await response.json(); }
  catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiClientError(response.ok ? 'INVALID_RESPONSE' : 'SERVER_ERROR', response.status);
  }
  return decodeResponse(body, response.status, schema);
}

export interface UploadProgress { loaded: number; total: number | null; sent: boolean }

export function uploadDemo(file: File, signal: AbortSignal, onProgress: (progress: UploadProgress) => void) {
  return new Promise<z.infer<typeof uploadResultSchema>>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Aborted', 'AbortError')); return; }
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => signal.removeEventListener('abort', abort);
    xhr.open('POST', '/api/v1/matches');
    xhr.responseType = 'json';
    xhr.timeout = 10 * 60 * 1000;
    xhr.upload.onprogress = (event) => onProgress({ loaded: event.loaded, total: event.lengthComputable ? event.total : null, sent: false });
    xhr.upload.onload = () => onProgress({ loaded: file.size, total: file.size, sent: true });
    xhr.onload = () => {
      cleanup();
      try { resolve(decodeResponse(xhr.response as unknown, xhr.status, uploadResultSchema)); }
      catch (error) { reject(error); }
    };
    xhr.onerror = () => { cleanup(); reject(new ApiClientError('NETWORK_ERROR')); };
    xhr.ontimeout = () => { cleanup(); reject(new ApiClientError('UPLOAD_TIMEOUT')); };
    xhr.onabort = () => { cleanup(); reject(new DOMException('Aborted', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    const form = new FormData(); form.append('demo', file);
    try { xhr.send(form); }
    catch { cleanup(); reject(new ApiClientError('NETWORK_ERROR')); }
  });
}
export async function getJob(id: string, signal: AbortSignal): Promise<JobDto> {
  const result = await request(`/api/v1/jobs/${encodeURIComponent(id)}`, { signal }, jobDtoSchema);
  if (result.id !== id) throw new ApiClientError('INVALID_RESPONSE');
  return result;
}
export async function getMatch(id: string, signal: AbortSignal): Promise<MatchData> {
  const result = await request(`/api/v1/matches/${encodeURIComponent(id)}`, { signal }, matchDataSchema);
  if (result.matchId !== id) throw new ApiClientError('INVALID_RESPONSE');
  return result;
}
export async function getMatchAnalytics(id: string, signal: AbortSignal) {
  const result = await request(`/api/v1/matches/${encodeURIComponent(id)}/analytics`, { signal }, matchAnalyticsSchema);
  if (result.matchId !== id) throw new ApiClientError('INVALID_RESPONSE');
  return result;
}
export async function getScoringReport(id: string, signal: AbortSignal): Promise<ScoringReport> {
  const result = await request(`/api/v1/matches/${encodeURIComponent(id)}/report`, { signal }, scoringReportSchema);
  if (result.matchId !== id) throw new ApiClientError('INVALID_RESPONSE');
  return result;
}
export async function getActiveParticipationRating(id: string, signal: AbortSignal): Promise<ActiveParticipationRatingReport> {
  const result = await request(`/api/v1/matches/${encodeURIComponent(id)}/experimental-participation-rating`, { signal }, activeParticipationRatingReportSchema);
  if (result.matchId !== id) throw new ApiClientError('INVALID_RESPONSE');
  return result;
}
export async function getParticipationExplanation(id: string, signal: AbortSignal): Promise<ParticipationExplanationReport> {
  const result = await request(`/api/v1/matches/${encodeURIComponent(id)}/experimental-participation-explanation`, { signal }, participationExplanationReportSchema);
  if (result.matchId !== id) throw new ApiClientError('INVALID_RESPONSE');
  return result;
}
export async function getReplayMetadata(id: string, signal: AbortSignal): Promise<ReplayMetadata> {
  const result = await request(`/api/v1/matches/${encodeURIComponent(id)}/replay`, { signal }, replayMetadataSchema);
  if (result.matchId !== id) throw new ApiClientError('INVALID_RESPONSE');
  return result;
}
export async function getReplayRound(id: string, roundId: string, signal: AbortSignal): Promise<ReplayRoundArtifact> {
  const result = await request(`/api/v1/matches/${encodeURIComponent(id)}/replay/rounds/${encodeURIComponent(roundId)}`, { signal }, replayRoundArtifactSchema);
  if (result.binding.matchId !== id || result.round.id !== roundId) throw new ApiClientError('INVALID_RESPONSE');
  return result;
}
export function getMatches(signal: AbortSignal, cursor?: string): Promise<MatchList> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return request(`/api/v1/matches${query}`, { signal }, matchesSchema);
}
