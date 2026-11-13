import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftInputSchema, selectedTagsSchema, tagSchema } from '../shared/schema.ts';

test('long Markdown and multilingual text have no short-bio length constraint', () => {
  const markdown = '# My story\n\n**Привет. שלום. Hello.**\n\n'.repeat(10000);
  const parsed = draftInputSchema.parse({ displayName: 'Coffee friend', avatarId: 'moss', introMarkdown: markdown, tags: [], revision: 0, mode: 'manual', currentStep: 'bio' });
  assert.equal(parsed.introMarkdown, markdown);
});
test('drafts can resume on the top-level languages and filters step', () => {
  const draft = { displayName: 'Coffee friend', avatarId: 'moss', introMarkdown: '', tags: [], revision: 0, mode: 'manual', currentStep: 'discovery' };
  assert.equal(draftInputSchema.parse(draft).currentStep, 'discovery');
});
test('custom emoji tags support grapheme sequences and reject invalid mixed tags', () => {
  const tag = { kind: 'custom', label: 'Indie games', emoji: '🧑‍💻', locale: 'en' };
  assert.ok(tagSchema.safeParse(tag).success);
  assert.ok(!tagSchema.safeParse({ ...tag, emoji: 'ab' }).success);
  assert.ok(!tagSchema.safeParse({ ...tag, emoji: '☕🎧' }).success);
  assert.ok(!tagSchema.safeParse({ ...tag, code: 'coffee' }).success);
  assert.ok(!selectedTagsSchema.safeParse([tag, { ...tag, label: 'indie GAMES' }]).success);
});
