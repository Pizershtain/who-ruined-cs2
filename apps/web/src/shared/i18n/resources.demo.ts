// Demo build only (aliased in vite.config.ts): every locale is bundled into the single HTML file,
// so switching languages works offline and from disk.
const resources = import.meta.glob<Record<string, string>>('./locales/*/*.json', { eager: true, import: 'default' });

export async function readLocale(language: string, namespace: string): Promise<Record<string, string>> {
  const resource = resources[`./locales/${language}/${namespace}.json`];
  if (!resource) throw new Error(`Unknown locale resource: ${language}/${namespace}`);
  return resource;
}
