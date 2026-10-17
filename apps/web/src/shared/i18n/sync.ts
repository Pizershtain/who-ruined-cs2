import path from 'node:path';
import { i18nDirectory, options, readJson, sourceFiles, writeJson } from './tooling.js';
import { flatten, reconcile, sourceForLanguage, unflatten, type FlatLocale, type TranslationSnapshot } from './translation-tools.js';
import { localeKit } from './locale-catalog.js';

type State = Record<string, Record<string, TranslationSnapshot>>;
type Report = Record<string, { languages: string[]; keys: FlatLocale }>;

async function main() {
  const args = options(process.argv.slice(2));
  const sources = await sourceFiles(args.files);
  const statePath = path.join(i18nDirectory, '.translation-state.json');
  const state = await readJson<State>(statePath, {});
  const report: Report = {};
  const problems: string[] = [];
  for (const language of args.languages) {
    const previous = state[language] ?? {};
    const next = args.files ? { ...previous } : {};
    for (const [file, source] of Object.entries(sources)) {
      const targetPath = path.join(i18nDirectory, 'locales', language, file);
      const target = flatten(await readJson(targetPath, {}));
      const result = reconcile(sourceForLanguage(source, language), target, previous[file], args.acknowledge);
      next[file] = result.snapshot;
      if (Object.keys(result.tasks).length) {
        const bucket = report[file] ??= { languages: [], keys: {} };
        bucket.languages.push(language);
        Object.assign(bucket.keys, result.tasks);
      }
      for (const key of result.errors) problems.push(language + '/' + file + ': placeholder mismatch at ' + key);
      if (args.check && Object.keys(target).some((key) => result.locale[key] === undefined)) problems.push(language + '/' + file + ': obsolete keys');
      if (!args.dryRun && !args.check) await writeJson(targetPath, unflatten(result.locale));
    }
    state[language] = next;
  }
  if (!args.dryRun && !args.check) {
    await writeJson(statePath, state);
    // Filtered runs keep pending tasks from other languages/namespaces.
    const allSources = await sourceFiles();
    const allReport: Report = {};
    const { supportedLanguages } = await import('./settings.js');
    for (const language of supportedLanguages.filter((item) => item !== 'en')) {
      for (const [file, source] of Object.entries(allSources)) {
        const target = flatten(await readJson(path.join(i18nDirectory, 'locales', language, file), {}));
        const result = reconcile(sourceForLanguage(source, language), target, state[language]?.[file]);
        if (Object.keys(result.tasks).length) {
          const bucket = allReport[file] ??= { languages: [], keys: {} };
          bucket.languages.push(language);
          Object.assign(bucket.keys, result.tasks);
        }
      }
    }
    await writeJson(path.join(i18nDirectory, 'translation-tasks.json'), allReport);
  }
  console.log(JSON.stringify({ module: localeKit.id, version: localeKit.version, pending: report, errors: problems, readOnly: args.dryRun || args.check }, null, 2));
  if (problems.length || (args.check && Object.keys(report).length)) process.exitCode = 1;
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
