import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { supportedLanguages } from './settings.js';
import { flatten, type FlatLocale } from './translation-tools.js';

export const i18nDirectory = path.dirname(fileURLToPath(import.meta.url));
export async function readJson<T>(file: string, missing: T): Promise<T> {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) as T; }
  catch (cause) {
    if (cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT') return missing;
    throw cause;
  }
}
export async function writeJson(file: string, value: unknown): Promise<void> {
  const text = JSON.stringify(value, null, 2) + '\n';
  let current: string | undefined;
  try { current = await fs.readFile(file, 'utf8'); } catch (cause) {
    if (!(cause && typeof cause === 'object' && 'code' in cause && cause.code === 'ENOENT')) throw cause;
  }
  if (current === text) return;
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf8');
}
export function options(argv: string[]) {
  const args = argv.filter((arg) => arg !== '--');
  const allowed = ['--check', '--dry-run', '--acknowledge'];
  for (const arg of args) if (!allowed.includes(arg) && !/^--(langs|files|ratio|max-words)=/.test(arg)) throw new Error('Unknown option: ' + arg);
  const list = (name: string) => args.find((arg) => arg.startsWith(name + '='))?.slice(name.length + 1).split(',').filter(Boolean);
  const languages = list('--langs') ?? supportedLanguages.filter((language) => language !== 'en');
  if (languages.some((language) => !(supportedLanguages as readonly string[]).includes(language) || language === 'en')) throw new Error('Unknown target language');
  const files = list('--files')?.map((name) => name.endsWith('.json') ? name : name + '.json');
  if (files?.some((name) => !/^[a-z][a-z0-9-]*\.json$/.test(name))) throw new Error('Invalid namespace');
  if (args.includes('--acknowledge') && (!list('--langs') || !files)) throw new Error('--acknowledge requires explicit --langs and --files');
  return { args, languages, files, check: args.includes('--check'), dryRun: args.includes('--dry-run'), acknowledge: args.includes('--acknowledge') };
}
export async function sourceFiles(selected?: string[]): Promise<Record<string, FlatLocale>> {
  const names = (await fs.readdir(path.join(i18nDirectory, 'locales/en'))).filter((name) => name.endsWith('.json')).sort();
  if (selected?.some((name) => !names.includes(name))) throw new Error('Unknown namespace');
  const sources: Record<string, FlatLocale> = {};
  for (const name of names.filter((name) => !selected || selected.includes(name))) {
    sources[name] = flatten(await readJson(path.join(i18nDirectory, 'locales/en', name), {}));
    if (Object.values(sources[name] ?? {}).some((text) => !text.trim())) throw new Error('English text must not be empty: ' + name);
  }
  return sources;
}
