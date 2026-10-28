import { describe, expect, it, vi } from 'vitest';
import { activeUploadCount, assertUploadAdmission, tryAcquireUploadSlot } from '../src/upload-admission.interceptor.js';
import {
  DEFAULT_MAX_UPLOAD_BYTES,
  DEFAULT_MIN_UPLOAD_FREE_BYTES,
  MULTIPART_OVERHEAD_ALLOWANCE_BYTES,
  parseContentLength,
  resolveUploadConfig
} from '../src/upload-config.js';

describe('upload configuration and admission', () => {
  it('applies finite in-process backpressure and releases slots idempotently', () => {
    const release = tryAcquireUploadSlot(1);
    expect(release).not.toBeNull();
    expect(tryAcquireUploadSlot(1)).toBeNull();
    expect(activeUploadCount()).toBe(1);
    release!(); release!();
    expect(activeUploadCount()).toBe(0);
  });
  it('uses the measured finite defaults', () => {
    expect(resolveUploadConfig({})).toEqual({
      maxUploadBytes: DEFAULT_MAX_UPLOAD_BYTES,
      minUploadFreeBytes: DEFAULT_MIN_UPLOAD_FREE_BYTES,
      multipartOverheadAllowanceBytes: MULTIPART_OVERHEAD_ALLOWANCE_BYTES
    });
  });

  it.each(['0', '-1', '1.5', 'NaN', '9007199254740992', '2147483649'])(
    'rejects invalid MAX_UPLOAD_BYTES=%s',
    (value) => expect(() => resolveUploadConfig({ MAX_UPLOAD_BYTES: value })).toThrow(/MAX_UPLOAD_BYTES/)
  );

  it('accepts an explicit safe integer size and validates the reserve separately', () => {
    expect(resolveUploadConfig({ MAX_UPLOAD_BYTES: '1048576', MIN_UPLOAD_FREE_BYTES: '524288' })).toMatchObject({
      maxUploadBytes: 1_048_576,
      minUploadFreeBytes: 524_288
    });
    expect(() => resolveUploadConfig({ MIN_UPLOAD_FREE_BYTES: 'none' })).toThrow(/MIN_UPLOAD_FREE_BYTES/);
  });

  it('parses missing and valid content lengths without guessing', () => {
    expect(parseContentLength(undefined)).toBeNull();
    expect(parseContentLength('0')).toBe(0);
    expect(parseContentLength('123')).toBe(123);
    expect(() => parseContentLength('12x')).toThrow('INVALID_CONTENT_LENGTH');
    expect(() => parseContentLength(['12', '13'])).toThrow('INVALID_CONTENT_LENGTH');
  });

  it('rejects an early oversized request with a stable 413', async () => {
    const config = { maxUploadBytes: 100, minUploadFreeBytes: 20, multipartOverheadAllowanceBytes: 10 };
    const disk = vi.fn(async () => 10_000);
    await expect(assertUploadAdmission({ 'content-length': '111' }, 'unused', config, disk)).rejects.toMatchObject({ code: 'SIZE_LIMIT', status: 413 });
    expect(disk).not.toHaveBeenCalled();
  });

  it('allows missing or low declared lengths to continue to the streaming counter', async () => {
    const config = { maxUploadBytes: 100, minUploadFreeBytes: 20, multipartOverheadAllowanceBytes: 10 };
    await expect(assertUploadAdmission({}, 'unused', config, async () => 1_000)).resolves.toBeUndefined();
    await expect(assertUploadAdmission({ 'content-length': '1' }, 'unused', config, async () => 1_000)).resolves.toBeUndefined();
  });

  it('rejects bad headers and unavailable or insufficient storage without exposing disk details', async () => {
    const config = { maxUploadBytes: 100, minUploadFreeBytes: 20, multipartOverheadAllowanceBytes: 10 };
    await expect(assertUploadAdmission({ 'content-length': 'forged' }, 'private', config)).rejects.toMatchObject({ code: 'INVALID_DEMO', status: 422 });
    await expect(assertUploadAdmission({}, 'private', config, async () => { throw new Error('private-path'); })).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', status: 507 });
    await expect(assertUploadAdmission({ 'content-length': '50' }, 'private', config, async () => 69)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', status: 507 });
  });
});
