import type { MatchUploadResult } from '@who-ruined/contracts';
import { z } from 'zod';
import { ApiClientError } from '../../shared/api/transport.js';

export function uploadDestination(result: MatchUploadResult) {
  if (result.reuseStatus === 'RESULT_READY') {
    return { to: `/matches/${encodeURIComponent(result.matchId)}`, state: { reuse: 'RESULT_READY' } };
  }
  return { to: `/jobs/${encodeURIComponent(result.jobId)}`,
    state: result.reuseStatus === 'ANALYSIS_IN_PROGRESS' ? { reuse: 'ANALYSIS_IN_PROGRESS' } : null };
}

const recoverySchema = z.object({
  matchId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,159}$/u),
  recovery: z.enum(['DELETE_AND_REUPLOAD', 'REBUILD_OR_DELETE_AND_REUPLOAD']),
});

export function uploadRecovery(error: unknown) {
  if (!(error instanceof ApiClientError) || error.status !== 409
    || !['REPORT_NOT_READY', 'REPORT_CORRUPT', 'REPORT_POLICY_MISMATCH'].includes(error.code)) return null;
  const recovery = recoverySchema.safeParse(error.details);
  return recovery.success ? recovery.data : null;
}
