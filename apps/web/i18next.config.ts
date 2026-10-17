import { defineConfig } from 'i18next-cli';

export default defineConfig({
  locales: ['en'],
  extract: {
    input: ['apps/web/src/**/*.{ts,tsx}'],
    ignore: ['**/*.d.ts', '**/*.test.*'],
    output: 'apps/web/src/shared/i18n/locales/{{language}}/{{namespace}}.json',
    defaultNS: 'translation', fallbackNS: 'translation', nsSeparator: false,
    keySeparator: '.', contextSeparator: '_', pluralSeparator: '_',
    sort: true, indentation: 2, removeUnusedKeys: true,
    transKeepBasicHtmlNodesFor: [], warnOnConflicts: 'error',
    defaultValue: (key, _namespace, _language, value) => value || key,
  },
});
