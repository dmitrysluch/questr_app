import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContentReviewer, validateReview } from '../server/moderation.ts';
import { Interviewer } from '../server/assistant.ts';
import { loadConfig } from '../server/config.ts';

const config = () => ({ ...loadConfig(), aiMode: 'openrouter' as const, openrouterApiKey: 'test', openrouterModel: 'review/test' });
const response = (value: unknown) => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
test('moderation maps exact quotes to UTF-16 offsets, including emoji, Markdown and repeated fragments', () => {
  const quote = 'I want to have **sex** with you.';
  const text = `🧗 Coffee.\n\n${quote}\n\n${quote}`;
  const review = validateReview(text, { explicit: true, excerpts: [quote] });
  assert.equal(review.status, 'blocked'); assert.equal(review.spans.length, 2);
  for (const span of review.spans) assert.equal(text.slice(span.start, span.end), quote);
  assert.equal(review.spans[0].start, 12);
});
test('invented excerpts, inconsistent verdicts and malformed results fail closed', () => {
  for (const value of [{ explicit: true, excerpts: [] }, { explicit: false, excerpts: ['words'] }, { explicit: true, excerpts: ['invented'] }, { approved: true }]) {
    assert.throws(() => validateReview('Original words.', value), /CONTENT_REVIEW_UNAVAILABLE/);
  }
  assert.deepEqual(validateReview('I am gay and open to dating.', { explicit: false, excerpts: [] }), { status: 'approved', spans: [] });
});
test('long content is reviewed in overlapping chunks; one blocked chunk blocks the whole bio', async () => {
  const quote = 'I want to have sex with you.';
  const text = 'A neutral sentence. '.repeat(850) + quote;
  let calls = 0;
  const reviewer = new ContentReviewer(config(), (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string); const input = JSON.parse(body.messages[1].content);
    assert.equal(body.response_format.json_schema.name, 'questr_content_review');
    assert.equal(body.model, 'openai/gpt-6-luna');
    assert.deepEqual(body.reasoning, { effort: 'low', exclude: true });
    assert.ok(input.content.length <= 16000); calls++;
    return response({ explicit: input.content.includes(quote), excerpts: input.content.includes(quote) ? [quote] : [] });
  }) as typeof fetch);
  const review = await reviewer.review(text);
  assert.ok(calls > 1); assert.equal(review.status, 'blocked');
  assert.equal(text.slice(review.spans[0].start, review.spans[0].end), quote);
});
test('reviewer failures never return approval; empty text needs no provider request', async () => {
  let calls = 0;
  const reviewer = new ContentReviewer(config(), (async () => { calls++; throw new Error('offline'); }) as typeof fetch);
  assert.equal((await reviewer.review('')).status, 'approved'); assert.equal(calls, 0);
  await assert.rejects(reviewer.review('Some words.'), /CONTENT_REVIEW_UNAVAILABLE/);
});
test('blocked answers receive a gentle reminder and a new nonsexual question', async () => {
  const content = 'I want to have sex with you.';
  const assistant = new Interviewer({ ...loadConfig(), aiMode: 'demo' });
  const reply = await assistant.question([{ id: '1', role: 'user', content, createdAt: '', contentReview: { status: 'blocked', spans: [{ start: 0, end: content.length }] } }], '', true);
  assert.match(reply, /Please keep explicitly sexual messages out of your profile/);
  assert.match(reply, /What have you been listening to this week\?/);
  assert.match(reply, /\?/); assert.ok(!reply.includes(content));
  await assert.rejects(assistant.proposal([{ id: '1', role: 'user', content, createdAt: '', contentReview: { status: 'blocked', spans: [{ start: 0, end: content.length }] } }], ''), /MORE_DETAIL_NEEDED/);
});
