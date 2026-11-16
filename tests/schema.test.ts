import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { askMeTopicsSchema, draftInputSchema, selectedTagsSchema, tagSchema } from '../shared/schema.ts';
import { appearanceForPreset, avatarAppearanceSchema, isPresetAppearance } from '../shared/avatar.ts';
import { avatars } from '../shared/catalog.ts';
import { Character } from '../src/components/Character.tsx';

test('avatar appearance has stable selectable values and rejects unknown equipment', () => {
  const appearance = appearanceForPreset('moss');
  assert.deepEqual(avatarAppearanceSchema.parse(appearance), appearance);
  assert.equal(isPresetAppearance('moss', appearance), true);
  assert.equal(isPresetAppearance('moss', { ...appearance, silhouette: 'masculine' }), true);
  assert.equal(isPresetAppearance('moss', { ...appearance, hairColor: 'pink' }), false);
  assert.equal(avatarAppearanceSchema.safeParse({ ...appearance, hairColor: 'neon-green' }).success, false);
  assert.equal(avatarAppearanceSchema.safeParse({ ...appearance, crown: 'paid' }).success, false);
  assert.equal(draftInputSchema.parse({ displayName: 'Alex', avatarId: 'moss', avatarAppearance: appearance, introMarkdown: '', tags: [], revision: 0, mode: 'manual', currentStep: 'avatar' }).avatarAppearance?.hairStyle, appearance.hairStyle);
});

test('old avatar shapes and null appearances use the same narrow sprite geometry', () => {
  for (const avatar of avatars) assert.equal(appearanceForPreset(avatar.id).silhouette, 'feminine');
  const appearance = { ...appearanceForPreset('moss'), hairStyle: 'curly' as const, headwear: 'headphones' as const, earrings: true };
  const sprite = renderToStaticMarkup(createElement(Character, { id: 'moss', appearance }));
  for (const silhouette of ['masculine', 'androgynous'] as const) {
    assert.equal(renderToStaticMarkup(createElement(Character, { id: 'moss', appearance: { ...appearance, silhouette } })), sprite);
  }
  assert.match(renderToStaticMarkup(createElement(Character, { id: 'moss' })), /<svg\b/);
});

test('long Markdown and multilingual text have no short-bio length constraint', () => {
  const markdown = '# My story\n\n**Привет. שלום. Hello.**\n\n'.repeat(10000);
  const parsed = draftInputSchema.parse({ displayName: 'Coffee friend', avatarId: 'moss', introMarkdown: markdown, tags: [], revision: 0, mode: 'manual', currentStep: 'bio' });
  assert.equal(parsed.introMarkdown, markdown);
});
test('drafts can resume on the top-level languages and filters step', () => {
  const draft = { displayName: 'Coffee friend', avatarId: 'moss', introMarkdown: '', tags: [], revision: 0, mode: 'manual', currentStep: 'discovery' };
  assert.equal(draftInputSchema.parse(draft).currentStep, 'discovery');
});
test('Ask me topics are optional, limited to three, and unique', () => {
  assert.deepEqual(askMeTopicsSchema.parse([]), []);
  assert.ok(askMeTopicsSchema.safeParse(['Ask me about the jam', 'Ask me about bouldering', 'Ask me about my train game']).success);
  assert.ok(!askMeTopicsSchema.safeParse(['Ask me about the jam', 'ask me about the jam']).success);
  assert.ok(!askMeTopicsSchema.safeParse(['one', 'two', 'three', 'four']).success);
  assert.ok(!askMeTopicsSchema.safeParse(['   ']).success);
});
test('custom emoji tags support grapheme sequences and reject invalid mixed tags', () => {
  const tag = { kind: 'custom', label: 'Indie games', emoji: '🧑‍💻', locale: 'en' };
  assert.ok(tagSchema.safeParse(tag).success);
  assert.ok(!tagSchema.safeParse({ ...tag, emoji: 'ab' }).success);
  assert.ok(!tagSchema.safeParse({ ...tag, emoji: '☕🎧' }).success);
  assert.ok(!tagSchema.safeParse({ ...tag, code: 'coffee' }).success);
  assert.ok(!selectedTagsSchema.safeParse([tag, { ...tag, label: 'indie GAMES' }]).success);
});
