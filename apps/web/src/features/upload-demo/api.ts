import { jobDtoSchema, jobStatusSchema, matchUploadResultSchema, qualitySchema, type JobDto, type MatchUploadResult } from '@who-ruined/contracts';
import { z } from 'zod';
import { ApiClientError, decodeResponse, request } from '../../shared/api/transport.js';

const matchesSchema = z.object({
  items: z.array(z.object({ id: z.string().min(1), map: z.string().nullable(), status: jobStatusSchema, quality: qualitySchema.nullable(), createdAt: z.string().datetime() })),
  nextCursor: z.string().optional(),
});

export type MatchList = z.infer<typeof matchesSchema>;
export interface UploadProgress { loaded: number; total: number | null; sent: boolean }

export function uploadDemo(file: File, signal: AbortSignal, onProgress: (progress: UploadProgress) => void) {
  return new Promise<MatchUploadResult>((resolve, reject) => {
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
      try { resolve(decodeResponse(xhr.response as unknown, xhr.status, matchUploadResultSchema)); }
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

export function getMatches(signal: AbortSignal, cursor?: string): Promise<MatchList> {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
  return request(`/api/v1/matches${query}`, { signal }, matchesSchema);
}
