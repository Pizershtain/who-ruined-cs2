import { createInstance } from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import resourcesToBackend from 'i18next-resources-to-backend';
import { createLocaleOptions, languageStorageKey } from './settings.js';
import type { SupportedLanguage } from './locale-catalog.js';
import { readLocale } from './resources.js';

export const i18n = createInstance();
export const i18nReady = i18n.use(initReactI18next).use(LanguageDetector).use(resourcesToBackend(readLocale)).init({
  ...createLocaleOptions(),
  detection: { order: ['localStorage', 'navigator'], lookupLocalStorage: languageStorageKey, caches: ['localStorage'] },
});

/** Prepare the namespaces already in use without changing the active language.
 * Explicit reads also allow retries after i18next has marked a resource as failed. */
export async function prepareLanguage(language: SupportedLanguage): Promise<void> {
  const namespaces = typeof i18n.options.ns === 'string' ? [i18n.options.ns] : i18n.options.ns || ['translation'];
  const missing = namespaces.filter((namespace) => !i18n.hasResourceBundle(language, namespace));
  const loaded = await Promise.all(missing.map(async (namespace) => ({ namespace, resource: await readLocale(language, namespace) })));
  for (const { namespace, resource } of loaded) i18n.addResourceBundle(language, namespace, resource);
}
