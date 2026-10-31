import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import {
  createLocaleOptions, languagePreferenceModeKey, languageStorageKey,
  manualLanguagePreference, resolveInitialLanguage,
} from './settings.js';
import type { SupportedLanguage } from './locale-catalog.js';

// Keep only asset URLs in the bundle; fetch can retry a failed locale request.
const resources = import.meta.glob<string>('./locales/*/*.json', { query: '?url&no-inline', import: 'default', eager: true });
async function readLocale(language: string, namespace: string): Promise<Record<string, string>> {
  const url = resources[`./locales/${language}/${namespace}.json`];
  if (!url) throw new Error(`Unknown locale resource: ${language}/${namespace}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Locale request failed: ${response.status}`);
  const resource: unknown = await response.json();
  if (!resource || typeof resource !== 'object' || Array.isArray(resource) || !Object.keys(resource).length || Object.values(resource).some((value) => typeof value !== 'string')) throw new Error('Invalid locale resource');
  return resource as Record<string, string>;
}

function initialLanguage(): SupportedLanguage {
  let storedLanguage: string | null = null;
  let storedMode: string | null = null;
  try {
    storedLanguage = window.localStorage.getItem(languageStorageKey);
    storedMode = window.localStorage.getItem(languagePreferenceModeKey);
  } catch { /* Storage can be unavailable in privacy-restricted contexts. */ }
  const legacyNavigator = navigator as Navigator & { userLanguage?: string };
  const detected = [
    ...navigator.languages,
    legacyNavigator.userLanguage,
    navigator.language,
    Intl.DateTimeFormat().resolvedOptions().locale,
  ];
  return resolveInitialLanguage(storedLanguage, storedMode, detected);
}

export function rememberLanguagePreference(language: SupportedLanguage): void {
  try {
    window.localStorage.setItem(languageStorageKey, language);
    window.localStorage.setItem(languagePreferenceModeKey, manualLanguagePreference);
  } catch { /* The active language still changes when persistence is unavailable. */ }
}

export const i18n = createInstance();
export const i18nReady = i18n.use(initReactI18next).use(resourcesToBackend(readLocale)).init({
  ...createLocaleOptions(),
  lng: initialLanguage(),
});

/** Prepare the namespaces already in use without changing the active language.
 * Explicit reads also allow retries after i18next has marked a resource as failed. */
export async function prepareLanguage(language: SupportedLanguage): Promise<void> {
  const namespaces = typeof i18n.options.ns === 'string' ? [i18n.options.ns] : i18n.options.ns || ['translation'];
  const missing = namespaces.filter((namespace) => !i18n.hasResourceBundle(language, namespace));
  const loaded = await Promise.all(missing.map(async (namespace) => ({ namespace, resource: await readLocale(language, namespace) })));
  for (const { namespace, resource } of loaded) i18n.addResourceBundle(language, namespace, resource);
}
