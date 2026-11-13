import { test } from 'node:test';
import assert from 'node:assert/strict';
import { en } from '../src/locales/en.ts';
import { ru } from '../src/locales/ru.ts';
import { tagLabelsRu } from '../src/locales/tags-ru.ts';
import { preferredLocale } from '../shared/locale.ts';
import { tags } from '../shared/interests.ts';
import { searchTags } from '../shared/tag-search.ts';
import { botText } from '../server/bot-copy.ts';

test('Russian catalog covers UI strings and every interest without losing placeholders', () => {
  assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(placeholders(ru[key]), placeholders(en[key]), key);
    assert.ok(ru[key].trim(), key);
  }
  assert.deepEqual(Object.keys(tagLabelsRu).sort(), tags.map(tag => tag.code).sort());
  assert.equal(searchTags('алгоритм шора', undefined, new Set(), tag => tagLabelsRu[tag.code])[0].code, 'shors_algorithm');
});
test('only supported Russian language tags select Russian', () => {
  assert.equal(preferredLocale('ru-RU'), 'ru');
  assert.equal(preferredLocale('RU'), 'ru');
  assert.equal(preferredLocale('en-US'), 'en');
  assert.equal(preferredLocale('uk-UA'), 'en');
  assert.equal(preferredLocale(undefined), 'en');
  assert.match(botText('ru', 'reminder', { title: 'Кофе', time: '18:00', zone: 'Asia/Jerusalem' }), /Напоминание.*Кофе/);
});
