import { describe, expect, it } from 'vitest';
import { maxUploadBytes, validateDemo } from './upload.js';

describe('demo upload validation', () => {
  it('rejects wrong extensions and empty demos', () => {
    expect(validateDemo({ name: 'match.txt', size: 10 })).toBe('INVALID_DEMO');
    expect(validateDemo({ name: 'match.dem', size: 0 })).toBe('INVALID_DEMO');
  });

  it('rejects files above the configured server limit', () => {
    expect(validateDemo({ name: 'match.dem', size: maxUploadBytes + 1 })).toBe('SIZE_LIMIT');
    expect(validateDemo({ name: 'MATCH.DEM', size: maxUploadBytes })).toBeNull();
  });
});
