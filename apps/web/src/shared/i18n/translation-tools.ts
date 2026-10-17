import { createHash } from 'node:crypto';

export type LocaleTree = { [key: string]: string | LocaleTree };
export type FlatLocale = Record<string, string>;
export interface TranslationRecord { sourceHash: string; targetHash: string; stale: boolean }
export type TranslationSnapshot = Record<string, TranslationRecord>;
export const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

export function flatten(value: unknown, prefix = ''): FlatLocale {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Locale must be an object');
  const result: FlatLocale = {};
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || key.includes('.')) throw new Error('Invalid locale key: ' + key);
    const full = prefix ? prefix + '.' + key : key;
    if (typeof child === 'string') result[full] = child;
    else Object.assign(result, flatten(child, full));
  }
  return result;
}

export function unflatten(flat: FlatLocale): LocaleTree {
  const root: LocaleTree = {};
  for (const [key, value] of Object.entries(flat).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    const parts = key.split('.');
    let node = root;
    for (const part of parts.slice(0, -1)) {
      const child = node[part];
      if (typeof child === 'string') throw new Error('Conflicting translation key: ' + key);
      node = child ?? (node[part] = {});
    }
    const last = parts.at(-1);
    if (last) node[last] = value;
  }
  return root;
}

const pluralPattern = /^(.*)_(zero|one|two|few|many|other)$/;
export function sourceForLanguage(source: FlatLocale, language: string): FlatLocale {
  const result: FlatLocale = {};
  const emitted = new Set<string>();
  for (const [key, value] of Object.entries(source)) {
    const base = pluralPattern.exec(key)?.[1];
    if (!base || source[base + '_one'] === undefined || source[base + '_other'] === undefined) {
      result[key] = value;
      continue;
    }
    if (emitted.has(base)) continue;
    emitted.add(base);
    const categories = new Set<string>(new Intl.PluralRules(language).resolvedOptions().pluralCategories);
    if (source[base + '_zero'] !== undefined) categories.add('zero');
    for (const category of categories) result[base + '_' + category] = source[base + '_' + category] ?? source[base + '_other'] ?? '';
  }
  return result;
}

export function tokens(value: string): string[] {
  return [...value.matchAll(/{{\s*([^}]+)\s*}}|<\/?([a-zA-Z0-9]+)\s*\/?\s*>/g)]
    .map((match) => match[0].replace(/\s/g, '')).sort();
}

export function reconcile(source: FlatLocale, target: FlatLocale, previous: TranslationSnapshot = {}, acknowledge = false) {
  const locale: FlatLocale = {};
  const snapshot: TranslationSnapshot = {};
  const tasks: FlatLocale = {};
  const errors: string[] = [];
  for (const [key, text] of Object.entries(source)) {
    const current = target[key] ?? '';
    const before = previous[key];
    const sourceHash = digest(text);
    const targetHash = digest(current);
    const stale = !acknowledge && !!before && (before.sourceHash !== sourceHash || (before.stale && before.targetHash === targetHash));
    locale[key] = current;
    if (!current.trim() || stale) tasks[key] = text;
    if (current && JSON.stringify(tokens(current)) !== JSON.stringify(tokens(text))) errors.push(key);
    snapshot[key] = { sourceHash, targetHash, stale };
  }
  return { locale, snapshot, tasks, errors };
}
