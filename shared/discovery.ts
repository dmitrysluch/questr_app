import { z } from 'zod';
import languageData from './languages.json';

const english = new Intl.DisplayNames(['en'], { type: 'language' });
export const languages = languageData.map(language => {
  let native = language.label;
  try { native = new Intl.DisplayNames([language.code], { type: 'language' }).of(language.code) ?? native; } catch { /* Keep the catalog label. */ }
  return { ...language, label: english.of(language.code) ?? language.label, native };
}).sort((a, b) => a.label.localeCompare(b.label, 'en'));
const languageCodes = new Set(languages.map(language => language.code));
export const languageCodeSchema = z.string().refine(code => languageCodes.has(code), 'Unknown language');
export const spokenLanguagesSchema = z.array(languageCodeSchema).max(50).refine(items => new Set(items).size === items.length, 'Languages must be unique');
export const locationIdSchema = z.string().regex(/^(online|country:[A-Z]{2}|city:[0-9]+)$/);
export const communityFilterSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('all') }).strict(),
  z.object({ mode: z.literal('mine') }).strict(),
  z.object({ mode: z.literal('community'), communityId: z.string().regex(/^[a-z][a-z0-9_]*$/) }).strict(),
]);
export type CommunityFilter = z.infer<typeof communityFilterSchema>;
export const discoveryFilterSchema = z.object({
  locationIds: z.array(locationIdSchema).max(50).refine(ids => new Set(ids).size === ids.length),
  languageCodes: spokenLanguagesSchema,
  communityFilter: communityFilterSchema.default({ mode: 'all' }),
}).strict();
export const discoveryInputSchema = discoveryFilterSchema.extend({ revision: z.number().int().nonnegative() });
export type DiscoveryFilter = z.infer<typeof discoveryFilterSchema>;
export type DiscoveryPreferences = z.infer<typeof discoveryInputSchema>;
export interface Location { id: string; name: string; kind: 'country' | 'city' | 'online'; parentId: string | null; countryName?: string }
export const normalizeSearch = (text: string) => text.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
