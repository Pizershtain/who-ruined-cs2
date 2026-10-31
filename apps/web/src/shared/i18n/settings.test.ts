import { describe, expect, it } from 'vitest';
import { normalizeDetectedLanguage, resolveInitialLanguage } from './settings.js';

describe('initial language resolution', () => {
  it('uses an explicit saved preference before browser detection', () => {
    expect(resolveInitialLanguage('de-DE', 'manual', ['ru-RU', 'en-US'])).toBe('de');
  });

  it('ignores detector-written legacy storage and follows the current browser language', () => {
    expect(resolveInitialLanguage('en', null, ['uk-UA', 'ru-RU'])).toBe('uk');
  });

  it('normalizes region variants and supported aliases', () => {
    expect(normalizeDetectedLanguage('pt-BR')).toBe('pt');
    expect(normalizeDetectedLanguage('zh-Hans-CN')).toBe('zh');
    expect(normalizeDetectedLanguage('no-NO')).toBe('nb');
  });

  it('falls back to English when the browser languages are unsupported', () => {
    expect(resolveInitialLanguage(null, null, ['ja-JP'])).toBe('en');
  });
});
