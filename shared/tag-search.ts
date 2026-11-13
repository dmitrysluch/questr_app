import { tags, type CatalogTag, type TagCategory } from './interests.ts';

export function normalizeTagSearch(text: string) {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('en')
    .replace(/[’']/g, '').replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const index = tags.map(tag => ({ tag, label: normalizeTagSearch(tag.label), aliases: tag.keywords.map(normalizeTagSearch) }));

// A single missing, added, replaced or swapped character; only for words of 4+ letters.
function nearbyWord(a: string, b: string) {
  if (a.length < 4 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
    || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

export function searchTags(query: string, category?: TagCategory, excluded: ReadonlySet<string> = new Set(), translatedLabel?: (tag: CatalogTag) => string): CatalogTag[] {
  const normalized = normalizeTagSearch(query);
  const words = normalized.split(' ').filter(Boolean);
  const scored = index.flatMap(({ tag, label, aliases }) => {
    if ((category && tag.category !== category) || excluded.has(tag.code)) return [];
    const localLabel = translatedLabel ? normalizeTagSearch(translatedLabel(tag)) : label;
    const fields = [label, localLabel, ...aliases];
    let score = 0;
    if (normalized) {
      if (label === normalized || localLabel === normalized) score = 100;
      else if (aliases.includes(normalized)) score = 90;
      else if (label.startsWith(normalized) || localLabel.startsWith(normalized)) score = 80;
      else if (label.includes(normalized) || localLabel.includes(normalized)) score = 70;
      else if (aliases.some(alias => alias.startsWith(normalized))) score = 60;
      else if (fields.some(field => field.includes(normalized))) score = 50;
      else {
        const terms = fields.flatMap(field => field.split(' '));
        if (words.every(word => terms.some(term => term.startsWith(word)))) score = 40;
        else if (words.every(word => terms.some(term => term.startsWith(word) || nearbyWord(word, term)))) score = 10;
        else return [];
      }
    }
    return [{ tag, score }];
  });
  return scored.sort((a, b) => b.score - a.score || a.tag.label.localeCompare(b.tag.label, 'en')).map(item => item.tag);
}
