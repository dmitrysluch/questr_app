import { en } from './locales/en.ts';
import { ru } from './locales/ru.ts';
import { tagLabelsRu } from './locales/tags-ru.ts';
import { preferredLocale, supportedLocales, type Locale } from '../shared/locale.ts';
import languageData from '../shared/languages.json';

export type TranslationKey = keyof typeof en;
export { supportedLocales };
export type { Locale };
let locale: Locale = typeof navigator === 'undefined' ? 'en' : preferredLocale(navigator.languages?.[0] ?? navigator.language);
const dictionaries: Record<Locale, Record<TranslationKey, string>> = { en, ru };
export function getLocale(): Locale { return locale; }
export function setLocale(next: Locale): void {
  locale = next;
  if (typeof document !== 'undefined') document.documentElement.lang = next;
}
// Locale selection, fallback and interpolation live here; UI code never stores translated tag IDs.
export function t(key: TranslationKey, values: Record<string, string | number> = {}): string {
  let text = dictionaries[locale][key];
  for (const [name, value] of Object.entries(values)) text = text.replaceAll(`{${name}}`, String(value));
  return text;
}
const displayNames = {
  en: { language: new Intl.DisplayNames(['en'], { type: 'language' }), region: new Intl.DisplayNames(['en'], { type: 'region' }) },
  ru: { language: new Intl.DisplayNames(['ru'], { type: 'language' }), region: new Intl.DisplayNames(['ru'], { type: 'region' }) },
};
function upperFirst(value: string): string { return value.charAt(0).toLocaleUpperCase(locale) + value.slice(1); }
export function languageName(code: string): string {
  const fallback = languageData.find(language => language.code === code)?.label ?? code;
  try {
    const name = displayNames[locale].language.of(code);
    return upperFirst(name && name.toLowerCase() !== code.toLowerCase() ? name : fallback);
  } catch { return fallback; }
}
export function tagName(code: string, fallback: string): string {
  return locale === 'ru' ? tagLabelsRu[code] ?? fallback : fallback;
}
export function locationName(id: string, name: string): string {
  if (id === 'online') return t('events.online');
  if (id.startsWith('country:')) {
    try { return displayNames[locale].region.of(id.slice(8)) ?? name; } catch { return name; }
  }
  return locale === 'ru' ? cityNamesRu[name] ?? name : name;
}
const cityNamesRu: Record<string, string> = {
  'Tel Aviv': 'Тель-Авив', Haifa: 'Хайфа', Jerusalem: 'Иерусалим', 'Beer Sheva': 'Беэр-Шева',
  Eilat: 'Эйлат', Ashdod: 'Ашдод', Netanya: 'Нетания', 'Rishon LeZion': 'Ришон-ле-Цион',
  Moscow: 'Москва', 'Saint Petersburg': 'Санкт-Петербург', London: 'Лондон', Paris: 'Париж',
  Berlin: 'Берлин', Rome: 'Рим', Tokyo: 'Токио', 'New York City': 'Нью-Йорк',
};
export function errorText(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'SERVER_ERROR';
  const key = `error.${code}`;
  return key in en ? t(key as TranslationKey) : t('error.SERVER_ERROR');
}
