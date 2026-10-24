// Keep only asset URLs in the bundle; fetch can retry a failed locale request.
const resources = import.meta.glob<string>('./locales/*/*.json', { query: '?url&no-inline', import: 'default', eager: true });
export async function readLocale(language: string, namespace: string): Promise<Record<string, string>> {
  const url = resources[`./locales/${language}/${namespace}.json`];
  if (!url) throw new Error(`Unknown locale resource: ${language}/${namespace}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Locale request failed: ${response.status}`);
  const resource: unknown = await response.json();
  if (!resource || typeof resource !== 'object' || Array.isArray(resource) || !Object.keys(resource).length || Object.values(resource).some((value) => typeof value !== 'string')) throw new Error('Invalid locale resource');
  return resource as Record<string, string>;
}
