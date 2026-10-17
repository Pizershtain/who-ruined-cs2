import path from 'node:path';
import { i18nDirectory, options, readJson, sourceFiles, writeJson } from './tooling.js';
import { flatten, sourceForLanguage } from './translation-tools.js';

async function main() {
  const args = options(process.argv.slice(2));
  const number = (name: string, fallback: number) => {
    const raw = args.args.find((arg) => arg.startsWith(name + '='))?.split('=')[1];
    const value = raw ? Number(raw) : fallback;
    if (!Number.isFinite(value) || value <= 0) throw new Error('Invalid ' + name);
    return value;
  };
  const ratio = number('--ratio', 1.5);
  const maxWords = number('--max-words', 4);
  const comparable = (text: string) => text.replace(/{{[^}]+}}|<[^>]+>/g, '').trim();
  const report: Record<string, Record<string, { en: string; translations: Record<string, string> }>> = {};
  for (const [file, source] of Object.entries(await sourceFiles(args.files))) {
    for (const language of args.languages) {
      const target = flatten(await readJson(path.join(i18nDirectory, 'locales', language, file), {}));
      for (const [key, text] of Object.entries(sourceForLanguage(source, language))) {
        const en = comparable(text);
        const translation = target[key];
        if (!en || en.split(/\s+/).length > maxWords || !translation || [...comparable(translation)].length <= [...en].length * ratio) continue;
        const entry = (report[file] ??= {})[key] ??= { en: text, translations: {} };
        entry.translations[language] = translation;
      }
    }
  }
  if (!args.dryRun && !args.check) await writeJson(path.join(i18nDirectory, 'compaction-tasks.json'), report);
  console.log(JSON.stringify(report, null, 2));
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
