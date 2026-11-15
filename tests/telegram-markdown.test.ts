import { test } from 'node:test';
import assert from 'node:assert/strict';
import { relayMarkdown } from '../server/telegram-markdown.ts';

test('relay MarkdownV2 styles only the author and preserves literal message text', () => {
  assert.equal(
    relayMarkdown('Moss_[A]\\', 'Hello *party*!\nBring (tea).'),
    '*Moss\\_\\[A\\]\\\\*:\nHello \\*party\\*\\!\nBring \\(tea\\)\\.',
  );
});
