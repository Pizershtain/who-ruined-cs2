import { describe, expect, it } from 'vitest';
import { resolveApiBindHost } from '../src/runtime-config.js';

describe('API bind host', () => {
  it('binds local-only by default', () => {
    expect(resolveApiBindHost({})).toBe('127.0.0.1');
  });

  it('accepts an explicit container bind address', () => {
    expect(resolveApiBindHost({ API_BIND_HOST: '0.0.0.0' })).toBe('0.0.0.0');
  });

  it('does not treat whitespace as an explicit address', () => {
    expect(resolveApiBindHost({ API_BIND_HOST: '  ' })).toBe('127.0.0.1');
  });
});
