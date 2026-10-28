import { PayloadTooLargeException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, SafeExceptionFilter } from '../src/safe-exception.filter.js';

function harness() {
  const json = vi.fn();
  const response = { status: vi.fn().mockReturnThis(), json, setHeader: vi.fn(), locals: {} };
  const host = { switchToHttp: () => ({ getResponse: () => response }) } as unknown as ArgumentsHost;
  return { host, response, json };
}

describe('safe exception envelope', () => {
  it('normalizes framework size errors without reflecting internal text', () => {
    const { host, response, json } = harness();
    new SafeExceptionFilter().catch(new PayloadTooLargeException('private-path'), host);
    expect(response.status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: { code: 'SIZE_LIMIT', message: 'Файл превышает допустимый размер.' } }));
    expect(JSON.stringify(json.mock.calls)).not.toContain('private-path');
  });

  it('preserves explicitly safe typed API errors', () => {
    const { host, response, json } = harness();
    new SafeExceptionFilter().catch(new ApiError('SIZE_LIMIT', 'Файл превышает допустимый размер.', 413, { maxBytes: 10 }), host);
    expect(response.status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: { code: 'SIZE_LIMIT', message: 'Файл превышает допустимый размер.', details: { maxBytes: 10 } } }));
  });

  it('does not expose unknown filesystem messages to HTTP or logs', () => {
    const { host, response, json } = harness();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    new SafeExceptionFilter().catch(new Error('ENOSPC at private-path'), host);
    expect(response.status).toHaveBeenCalledWith(500);
    expect(JSON.stringify(json.mock.calls)).not.toContain('private-path');
    expect(JSON.stringify(logged.mock.calls)).not.toContain('private-path');
    logged.mockRestore();
  });
});
