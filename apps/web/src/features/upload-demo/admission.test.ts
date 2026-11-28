import { afterEach, expect, it, vi } from 'vitest';
import { matchUploadResultSchema } from '@who-ruined/contracts';
import { ApiClientError, decodeResponse } from '../../shared/api/transport.js';
import { uploadDestination, uploadRecovery } from './admission.js';
import { uploadDemo } from './api.js';

const ids = { matchId: 'saved-match', jobId: 'existing-parse', duplicate: true };
afterEach(() => vi.unstubAllGlobals());

it('only skips polling for an explicitly ready reused report', () => {
  const ready = decodeResponse({ ...ids, reuseStatus: 'RESULT_READY' }, 202, matchUploadResultSchema);
  expect(uploadDestination(ready)).toEqual({ to: '/matches/saved-match', state: { reuse: 'RESULT_READY' } });
  expect(uploadDestination({ ...ids, reuseStatus: 'ANALYSIS_IN_PROGRESS' })).toEqual({ to: '/jobs/existing-parse', state: { reuse: 'ANALYSIS_IN_PROGRESS' } });
  expect(uploadDestination({ ...ids, duplicate: false, reuseStatus: 'ACCEPTED' }).to).toBe('/jobs/existing-parse');
  expect(uploadDestination(ids)).toEqual({ to: '/jobs/existing-parse', state: null });
});

it('only offers a recovery link for an explicit valid stored match in a conflict', () => {
  for (const code of ['REPORT_NOT_READY', 'REPORT_CORRUPT', 'REPORT_POLICY_MISMATCH']) {
    expect(uploadRecovery(new ApiClientError(code, 409, undefined, { matchId: ids.matchId, recovery: 'DELETE_AND_REUPLOAD' }))).toMatchObject({ matchId: ids.matchId });
  }
  for (const code of ['MATCH_ACTIVE', 'UPSTREAM_UNAVAILABLE', 'NETWORK_ERROR']) {
    expect(uploadRecovery(new ApiClientError(code))).toBeNull();
  }
  expect(uploadRecovery(new ApiClientError('REPORT_CORRUPT', 409, undefined, { matchId: '../other', recovery: 'DELETE_AND_REUPLOAD' }))).toBeNull();
});

it('uses measured XHR progress and preserves cancellation, network failure and Gateway errors', async () => {
  const xhr = {
    upload: { onprogress: undefined as ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | undefined },
    open: vi.fn(), send: vi.fn(), status: 503, response: { error: { code: 'UPSTREAM_UNAVAILABLE' } },
    onabort: undefined as (() => void) | undefined, onerror: undefined as (() => void) | undefined,
    onload: undefined as (() => void) | undefined,
    abort() { this.onabort?.(); },
  };
  vi.stubGlobal('XMLHttpRequest', function () { return xhr; });
  const file = new File(['synthetic payload'], 'fixture.dem');
  const onProgress = vi.fn();
  const cancel = new AbortController();
  const stopped = expect(uploadDemo(file, cancel.signal, onProgress)).rejects.toMatchObject({ name: 'AbortError' });
  xhr.upload.onprogress?.({ loaded: 2, total: 8, lengthComputable: true });
  expect(onProgress).toHaveBeenCalledWith({ loaded: 2, total: 8, sent: false });
  cancel.abort();
  await stopped;

  const network = expect(uploadDemo(file, new AbortController().signal, onProgress)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  xhr.onerror?.();
  await network;
  const gateway = expect(uploadDemo(file, new AbortController().signal, onProgress)).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', status: 503 });
  xhr.onload?.();
  await gateway;
});
