import { en } from './locales/en.ts';

export type TranslationKey = keyof typeof en;
export const supportedLocales = ['en'] as const;
// Locale selection, fallback and interpolation live here; UI code never stores translated tag IDs.
export function t(key: TranslationKey, values: Record<string, string | number> = {}): string {
  let text: string = en[key];
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}
export function errorText(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'SERVER_ERROR';
  const key = `error.${code}`;
  return key in en ? t(key as TranslationKey) : t('error.SERVER_ERROR');
}
