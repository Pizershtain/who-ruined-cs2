import { ApiClientError } from '../api.js';

const nonRetryableCodes = new Set([
  'REPORT_CORRUPT',
  'REPORT_POLICY_MISMATCH',
  'INVALID_POLICY_SELECTOR',
  'EXPERIMENTAL_PARTICIPATION_RATING_DISABLED',
]);

export function canRetryRatingError(error: unknown): boolean {
  return !(error instanceof ApiClientError && nonRetryableCodes.has(error.code));
}
