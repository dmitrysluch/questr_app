export const supportedLocales = ['en', 'ru'] as const;
export type Locale = typeof supportedLocales[number];

export function preferredLocale(languageCode: unknown): Locale {
  return typeof languageCode === 'string' && /^ru(?:-|$)/i.test(languageCode) ? 'ru' : 'en';
}
