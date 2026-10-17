import type { InitOptions } from 'i18next';
import { supportedLanguages, type SupportedLanguage } from './locale-catalog.js';

export { supportedLanguages, languageNames, type SupportedLanguage } from './locale-catalog.js';
export const fallbackLng = 'en';
export const defaultNS = 'translation';
export const languageStorageKey = 'wrc.language';

export function isSupportedLanguage(value: string): value is SupportedLanguage {
  return supportedLanguages.some((language) => language === value);
}

export function createLocaleOptions(): InitOptions {
  return {
    supportedLngs: [...supportedLanguages], fallbackLng, defaultNS, fallbackNS: defaultNS,
    ns: [defaultNS], load: 'languageOnly', nsSeparator: false, keySeparator: '.',
    returnNull: false, returnEmptyString: false, saveMissing: false,
    interpolation: { escapeValue: false }, react: { useSuspense: true },
  };
}
