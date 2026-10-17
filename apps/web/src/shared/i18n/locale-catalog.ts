/** WRC Locale Kit — language catalogue for Who Ruined CS2. */
export const localeKit = { id: 'wrc.locale-kit', version: 1 } as const;

export const localeCatalog = [
  { code: 'en', name: 'English', direction: 'ltr' },
  { code: 'ru', name: 'Русский', direction: 'ltr' },
  { code: 'uk', name: 'Українська', direction: 'ltr' },
  { code: 'fr', name: 'Français', direction: 'ltr' },
  { code: 'de', name: 'Deutsch', direction: 'ltr' },
  { code: 'es', name: 'Español', direction: 'ltr' },
  { code: 'pt', name: 'Português', direction: 'ltr' },
  { code: 'tr', name: 'Türkçe', direction: 'ltr' },
  { code: 'az', name: 'Azərbaycanca', direction: 'ltr' },
  { code: 'uz', name: 'O‘zbekcha', direction: 'ltr' },
  { code: 'bn', name: 'বাংলা', direction: 'ltr' },
  { code: 'zh', name: '中文', direction: 'ltr' },
  { code: 'id', name: 'Bahasa Indonesia', direction: 'ltr' },
  { code: 'kk', name: 'Қазақша', direction: 'ltr' },
  { code: 'ky', name: 'Кыргызча', direction: 'ltr' },
  { code: 'ro', name: 'Română', direction: 'ltr' },
  { code: 'hu', name: 'Magyar', direction: 'ltr' },
  { code: 'pl', name: 'Polski', direction: 'ltr' },
  { code: 'cs', name: 'Čeština', direction: 'ltr' },
  { code: 'sl', name: 'Slovenščina', direction: 'ltr' },
  { code: 'el', name: 'Ελληνικά', direction: 'ltr' },
  { code: 'sv', name: 'Svenska', direction: 'ltr' },
  { code: 'sk', name: 'Slovenčina', direction: 'ltr' },
  { code: 'ar', name: 'العربية', direction: 'rtl' },
  { code: 'nb', name: 'Norsk bokmål', direction: 'ltr' },
  { code: 'it', name: 'Italiano', direction: 'ltr' },
  { code: 'lv', name: 'Latviešu', direction: 'ltr' },
  { code: 'lt', name: 'Lietuvių', direction: 'ltr' },
  { code: 'et', name: 'Eesti', direction: 'ltr' },
  { code: 'fi', name: 'Suomi', direction: 'ltr' },
  { code: 'da', name: 'Dansk', direction: 'ltr' },
  { code: 'bg', name: 'Български', direction: 'ltr' },
  { code: 'hr', name: 'Hrvatski', direction: 'ltr' },
  { code: 'nl', name: 'Nederlands', direction: 'ltr' },
  { code: 'sw', name: 'Kiswahili', direction: 'ltr' },
  { code: 'am', name: 'አማርኛ', direction: 'ltr' },
  { code: 'lg', name: 'Luganda', direction: 'ltr' },
] as const;

export type SupportedLanguage = typeof localeCatalog[number]['code'];
export const supportedLanguages = localeCatalog.map(({ code }) => code);
export const languageNames = Object.fromEntries(localeCatalog.map(({ code, name }) => [code, name])) as Record<SupportedLanguage, string>;
