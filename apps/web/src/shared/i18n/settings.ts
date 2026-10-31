import type { InitOptions } from 'i18next';
import { supportedLanguages, type SupportedLanguage } from './locale-catalog.js';

export { supportedLanguages, languageNames, type SupportedLanguage } from './locale-catalog.js';
export const fallbackLng: SupportedLanguage = 'en';
export const defaultNS = 'translation';
export const languageStorageKey = 'wrc.language';
export const languagePreferenceModeKey = 'wrc.language.mode';
export const manualLanguagePreference = 'manual';

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return supportedLanguages.some((language) => language === value);
}

export function normalizeDetectedLanguage(value: string | null | undefined): SupportedLanguage | null {
  const base = value?.trim().toLowerCase().split(/[-_]/u, 1)[0];
  if (!base) return null;
  const normalized = base === 'no' ? 'nb' : base;
  return isSupportedLanguage(normalized) ? normalized : null;
}

/** A stored language is authoritative only after an explicit switch.
 * Older detector-written values have no mode marker and must not freeze browser detection. */
export function resolveInitialLanguage(
  storedLanguage: string | null | undefined,
  storedMode: string | null | undefined,
  detectedLanguages: readonly (string | null | undefined)[],
): SupportedLanguage {
  if (storedMode === manualLanguagePreference) {
    const preferred = normalizeDetectedLanguage(storedLanguage);
    if (preferred) return preferred;
  }
  for (const candidate of detectedLanguages) {
    const detected = normalizeDetectedLanguage(candidate);
    if (detected) return detected;
  }
  return fallbackLng;
}

export function createLocaleOptions(): InitOptions {
  return {
    supportedLngs: [...supportedLanguages], fallbackLng, defaultNS, fallbackNS: defaultNS,
    ns: [defaultNS], load: 'languageOnly', nsSeparator: false, keySeparator: '.',
    returnNull: false, returnEmptyString: false, saveMissing: false,
    interpolation: { escapeValue: false }, react: { useSuspense: true },
  };
}
