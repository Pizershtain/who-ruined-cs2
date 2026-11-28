const MIB = 1024 * 1024;

export const DEFAULT_MAX_UPLOAD_BYTES = 512 * MIB;
export const DEFAULT_MIN_UPLOAD_FREE_BYTES = 256 * MIB;
export const MAX_CONFIGURED_UPLOAD_BYTES = 2 * 1024 * MIB;
export const MULTIPART_OVERHEAD_ALLOWANCE_BYTES = 1 * MIB;

export interface UploadConfig {
  maxUploadBytes: number;
  minUploadFreeBytes: number;
  multipartOverheadAllowanceBytes: number;
}

function positiveSafeInteger(name: string, value: string | undefined, fallback: number, maximum: number): number {
  const candidate = value?.trim() || String(fallback);
  if (!/^[1-9][0-9]*$/.test(candidate)) {
    throw new Error(`${name} must be a positive integer byte count`);
  }
  const parsed = Number(candidate);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum} bytes`);
  }
  return parsed;
}

export function resolveUploadConfig(environment: NodeJS.ProcessEnv = process.env): UploadConfig {
  return {
    maxUploadBytes: positiveSafeInteger(
      'MAX_UPLOAD_BYTES',
      environment.MAX_UPLOAD_BYTES,
      DEFAULT_MAX_UPLOAD_BYTES,
      MAX_CONFIGURED_UPLOAD_BYTES
    ),
    minUploadFreeBytes: positiveSafeInteger(
      'MIN_UPLOAD_FREE_BYTES',
      environment.MIN_UPLOAD_FREE_BYTES,
      DEFAULT_MIN_UPLOAD_FREE_BYTES,
      MAX_CONFIGURED_UPLOAD_BYTES
    ),
    multipartOverheadAllowanceBytes: MULTIPART_OVERHEAD_ALLOWANCE_BYTES
  };
}

export function parseContentLength(value: string | string[] | undefined): number | null {
  if (value === undefined) return null;
  if (Array.isArray(value) || !/^[0-9]+$/.test(value)) throw new Error('INVALID_CONTENT_LENGTH');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('INVALID_CONTENT_LENGTH');
  return parsed;
}
