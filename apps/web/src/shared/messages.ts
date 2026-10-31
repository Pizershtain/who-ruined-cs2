import type { TFunction } from 'i18next';
import type { JobStatus } from '@who-ruined/contracts';
import { ApiClientError } from '../api.js';

export function statusLabel(status: JobStatus, t: TFunction): string {
  switch (status) {
    case 'QUEUED': return t('status-queued', 'Queued');
    case 'PARSING': return t('status-parsing', 'Reading demo events');
    case 'NORMALIZING': return t('status-normalizing', 'Reconstructing the match');
    case 'VALIDATING': return t('status-validating', 'Checking rounds and scores');
    case 'FEATURIZING': return t('status-featurizing', 'Calculating match metrics');
    case 'SCORING': return t('status-scoring', 'Preparing the analysis');
    case 'COMPLETED': return t('status-completed', 'Ready');
    case 'PARTIAL': return t('status-partial', 'Partial result');
    case 'FAILED': return t('status-failed', 'Analysis failed');
    case 'CANCELLED': return t('status-cancelled', 'Analysis cancelled');
  }
}
export function errorMessage(error: unknown, t: TFunction): string {
  return errorCodeMessage(error instanceof ApiClientError ? error.code : 'UNKNOWN', t);
}
export function errorCodeMessage(code: string, t: TFunction): string {
  switch (code) {
    case 'INVALID_DEMO': return t('error-invalid-demo', 'Choose a valid, non-empty CS2 .dem file.');
    case 'SIZE_LIMIT': return t('error-size-limit', 'This file exceeds the server upload limit.');
    case 'INGESTION_PERSISTENCE_FAILED': return t('error-ingestion-persistence', 'The upload could not be saved. Try again later.');
    case 'STORAGE_UNAVAILABLE': return t('error-storage-unavailable', 'The analysis storage is unavailable. Ask the operator to check the local service.');
    case 'PARSE_TIMEOUT': return t('error-timeout', 'The demo took too long to process. Try another demo.');
    case 'PARSE_FAILED': return t('error-parse', 'The demo could not be read. Try another demo.');
    case 'UNSUPPORTED_MODE': return t('error-mode', 'This game mode is not supported yet.');
    case 'INCOMPLETE_MATCH': return t('error-incomplete', 'The match analysis is not complete yet.');
    case 'MISSING_REQUIRED_EVENTS': return t('error-events', 'Required demo events are missing.');
    case 'VALIDATION_FAILED': return t('error-validation', 'The match data could not be validated.');
    case 'MATCH_NOT_FOUND': return t('error-match', 'This match could not be found.');
    case 'JOB_NOT_FOUND': return t('error-job', 'This analysis job could not be found.');
    case 'REPORT_NOT_READY': return t('error-report-not-ready', 'The rating is not ready yet. Wait for processing to finish and try again.');
    case 'REPORT_CORRUPT': return t('error-report-corrupt', 'The stored rating report could not be verified. Operator action is required.');
    case 'REPORT_POLICY_MISMATCH': return t('error-report-policy', 'The stored report does not match the active rating configuration. Operator action is required.');
    case 'INVALID_POLICY_SELECTOR': return t('error-policy-selector', 'The client requested an unsupported rating selector.');
    case 'EXPERIMENTAL_PARTICIPATION_RATING_DISABLED': return t('error-rating-disabled', 'The experimental participation rating is not enabled on this server.');
    case 'NETWORK_ERROR': return t('error-network', 'Cannot reach the analysis service. Check your connection and try again.');
    case 'UPLOAD_TIMEOUT': return t('error-upload-timeout', 'The upload timed out. Check your connection and try again.');
    case 'INVALID_RESPONSE': return t('error-response', 'The service returned an unsupported response.');
    default: return t('error-general', 'Something went wrong. Please try again.');
  }
}
