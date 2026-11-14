import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tags, tagCategories } from '../shared/catalog.ts';
import { searchTags } from '../shared/tag-search.ts';
import { tagSchema } from '../shared/schema.ts';
import { tagLabelsRu } from '../src/locales/tags-ru.ts';

test('niche interests are found through names, aliases, accents, punctuation and small typos', () => {
  const examples = [
    ['molecular coctails', 'molecular_cocktails'], ['pole fitness', 'pole_dancing'],
    ["Shor's algorithm", 'shors_algorithm'], ['shor', 'shors_algorithm'],
    ['Charlotte Ginsbourg', 'charlotte_gainsbourg'], ['bjork', 'bjork'],
    ['Björk', 'bjork'], ['Agnes Varda', 'agnes_varda'],
    ['drum and bass', 'drum_and_bass'], ['d&d', 'dnd'], ['bouldering', 'indoor_climbing'],
    ['cofee', 'coffee'], ['cofefe', 'coffee'], ['cofffee', 'coffee'], ['coffwe', 'coffee'],
    ['machine', 'machine_learning'], ['ai', 'machine_learning'],
  ];
  for (const [query, code] of examples) assert.equal(searchTags(query)[0]?.code, code, query);
  assert.deepEqual(searchTags('zzqx nonexistent interest'), []);
});

test('topic filters and selected interests constrain search results', () => {
  assert.ok(searchTags('', 'music').length > 20);
  assert.ok(searchTags('', 'music').every(tag => tag.category === 'music'));
  assert.equal(searchTags('quantum', 'sports').length, 0);
  assert.ok(searchTags('coffee', undefined, new Set(['coffee'])).every(tag => tag.code !== 'coffee'));
  assert.equal(searchTags('techno')[0].code, 'techno');
});

test('specific people, titles, sports and practices are discoverable without replacing saved legacy tags', () => {
  const examples: [string, string, string][] = [
    ['биатлон', 'sports', 'biathlon'], ['синхронное плавание', 'sports', 'artistic_swimming'],
    ['cricket', 'sports', 'cricket'], ['vegan', 'food', 'vegan'],
    ['Taylor Swift', 'music', 'artist_taylor_swift'], ['Тейлор Свифт', 'music', 'artist_taylor_swift'],
    ['Christopher Nolan', 'films', 'director_christopher_nolan'], ['Spirited Away', 'films', 'screen_spirited_away'],
    ['Чунгкингский экспресс', 'films', 'film_chungking_express'],
    ['акварель', 'art', 'watercolor'], ['рисую мангу', 'art', 'manga_drawing'],
    ['читаю мангу', 'books', 'manga'], ['виолончель', 'creative', 'cello'],
    ['Baldur’s Gate 3', 'games', 'game_baldurs_gate_3'], ['Minecraft', 'games', 'game_minecraft'],
    ['Project Hail Mary', 'books', 'book_project_hail_mary'],
  ];
  for (const [query, category, code] of examples) assert.equal(searchTags(query, category as typeof tagCategories[number], new Set(),
    tag => tagLabelsRu[tag.code] ?? tag.label)[0]?.code, code, query);
  assert.ok(tagSchema.safeParse({ kind: 'catalog', code: 'cozy_games' }).success);
  assert.ok(!searchTags('cozy games').some(tag => tag.code === 'cozy_games'));
  assert.equal(tags.find(tag => tag.code === 'guitar')?.category, 'creative');
});

test('expanded catalog keeps old profile codes valid and has unique codes and usable emoji', () => {
  assert.ok(tags.length >= 800);
  assert.equal(new Set(tags.map(tag => tag.code)).size, tags.length);
  for (const code of ['programming', 'indoor_climbing', 'arthouse_cinema', 'edm', 'coffee', 'board_games', 'hiking', 'books', 'cooking', 'photography', 'live_music', 'art']) {
    assert.ok(tagSchema.safeParse({ kind: 'catalog', code }).success, code);
  }
  for (const tag of tags) {
    assert.match(tag.code, /^[a-z][a-z0-9_]+$/);
    assert.ok(tagSchema.safeParse({ kind: 'custom', label: tag.label, emoji: tag.emoji, locale: 'en' }).success, tag.code);
  }
  for (const category of tagCategories) assert.ok(tags.some(tag => tag.category === category));
});
