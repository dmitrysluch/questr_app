import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import type { Express } from 'express';
import { createPool, type Pool } from '../../server/db.ts';
import { migrate } from '../../server/migrate.ts';
import { createApp } from '../../server/app.ts';
import { loadConfig } from '../../server/config.ts';
import { hash } from '../../server/auth.ts';
import { Interviewer } from '../../server/assistant.ts';
import { ContentReviewer } from '../../server/moderation.ts';

const connection = process.env.TEST_DATABASE_URL;
let admin: Pool, pool: Pool, app: Express;
const database = `questr_test_${randomUUID().replaceAll('-', '')}`;
before(async () => {
  if (!connection) return;
  admin = createPool(connection);
  await admin.query(`CREATE DATABASE "${database}"`);
  const url = new URL(connection); url.pathname = `/${database}`;
  pool = createPool(url.toString());
  await migrate(pool); await migrate(pool);
  app = createApp(pool, { ...loadConfig(), authMode: 'demo', aiMode: 'demo' });
});
after(async () => {
  if (!connection) return;
  await pool?.end();
  await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
  await admin.end();
});
const integration = (name: string, fn: () => Promise<void>) => test(name, { skip: !connection }, fn);
async function browser(target: Express = app) {
  const agent = request.agent(target);
  const auth = await agent.post('/api/auth/demo').send({}).expect(200);
  const { body } = await agent.get('/api/me').expect(200);
  return { agent, state: body, cookie: auth.headers['set-cookie'][0].split(';')[0] };
}
async function registered(target: Express = app) {
  const { agent, state, cookie } = await browser(target);
  const result = await agent.post('/api/register').send({ displayName: 'Moss', invite: state.demoInvite, adult: true, terms: true, locale: 'en' }).expect(200);
  return { agent, state, cookie, draft: result.body.draft };
}
integration('unregistered access, foreign origins and non-JSON mutations are rejected', async () => {
  await request(app).get('/api/me').expect(401);
  await request(app).post('/api/auth/demo').set('Origin', 'https://foreign.example').send({}).expect(403);
  await request(app).post('/api/auth/demo').type('form').send('test=1').expect(415);
  const { agent } = await browser();
  await agent.put('/api/draft').send({}).expect(403);
});
integration('missing consent does not consume an invitation; successful registration is resumable and idempotent', async () => {
  const { agent, state } = await browser();
  const form = { displayName: 'Moss', invite: state.demoInvite, adult: true, terms: true, locale: 'en' };
  await agent.post('/api/register').send({ ...form, adult: false }).expect(400);
  await agent.post('/api/register').send(form).expect(200);
  await agent.post('/api/register').send(form).expect(200);
  const result = (await agent.get('/api/me').expect(200)).body;
  assert.equal(result.user.status, 'onboarding'); assert.equal(result.draft.displayName, 'Moss');
  assert.equal((await pool.query('SELECT * FROM user_consents WHERE user_id=$1', [state.user.id])).rowCount, 2);
});
integration('an invitation can be redeemed by only one account under concurrent requests', async () => {
  const a = await browser(), b = await browser();
  const code = `race-${randomUUID()}`;
  await pool.query("INSERT INTO invites(token_hash,expires_at) VALUES($1,now()+interval '1 day')", [hash(code)]);
  const form = { displayName: 'Racer', invite: code, adult: true, terms: true, locale: 'en' };
  const results = await Promise.all([a.agent.post('/api/register').send(form), b.agent.post('/api/register').send(form)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 400]);
});
integration('expired and revoked invitations are rejected', async () => {
  const { agent } = await browser();
  for (const expired of [true, false]) {
    const code = randomUUID();
    await pool.query('INSERT INTO invites(token_hash,expires_at,revoked_at) VALUES($1,$2,$3)', [hash(code), new Date(Date.now() + (expired ? -1000 : 86400000)), expired ? null : new Date()]);
    await agent.post('/api/register').send({ displayName: 'Moss', invite: code, adult: true, terms: true, locale: 'en' }).expect(400);
  }
});
integration('draft versions prevent lost updates; publication round-trips long Markdown and custom tags', async () => {
  const { agent, draft } = await registered();
  const text = '## A real story\n\nMy **own words** — café, שלום, привет.\n\n'.repeat(1600);
  const updated = { ...draft, avatarId: 'moss', introMarkdown: text, tags: [{ kind: 'catalog', code: 'edm' }, { kind: 'custom', label: 'Tiny games', emoji: '🧑‍💻', locale: 'en' }] };
  const saved = (await agent.put('/api/draft').send(updated).expect(200)).body.draft;
  await agent.put('/api/draft').send({ ...updated, introMarkdown: 'stale' }).expect(409);
  const profile = (await agent.post('/api/profile/publish').send({ revision: saved.revision }).expect(200)).body.profile;
  assert.equal(profile.introMarkdown, text); assert.deepEqual(profile.tags, updated.tags);
  const state = (await agent.get('/api/me').expect(200)).body;
  assert.equal(state.user.status, 'active'); assert.equal(state.draft.introMarkdown, text);
  assert.ok(!JSON.stringify(state).includes('telegram_user_id'));
});
integration('AI needs explicit consent; retries do not duplicate answers and offline proposals require approval', async () => {
  const { agent, draft } = await registered();
  const content = 'I go bouldering on Tuesdays. Usually I fall off a lot, and then get coffee.';
  const body = { requestId: randomUUID(), content };
  await agent.post('/api/assistant/messages').send(body).expect(403);
  await agent.post('/api/assistant/start').send({ consent: true }).expect(200);
  await agent.post('/api/assistant/messages').send(body).expect(200);
  const conversation = (await agent.post('/api/assistant/messages').send(body).expect(200)).body.conversation;
  assert.equal(conversation.messages.filter((m: any) => m.role === 'user').length, 1);
  assert.equal(conversation.messages.filter((m: any) => m.role === 'assistant').length, 2);
  const proposal = (await agent.post('/api/assistant/proposals').send({}).expect(200)).body.proposal;
  assert.ok(proposal.introMarkdown.includes(content));
  const applied = (await agent.post(`/api/assistant/proposals/${proposal.id}/apply`).send({ revision: draft.revision, tagCodes: [] }).expect(200)).body.draft;
  assert.equal(applied.introMarkdown, content);
});
integration('stale AI proposals cannot overwrite manual edits and other users cannot approve them', async () => {
  const { agent, draft } = await registered();
  const other = await registered();
  await agent.post('/api/assistant/start').send({ consent: true }).expect(200);
  await agent.post('/api/assistant/messages').send({ requestId: randomUUID(), content: 'I like coffee and long walks on slow mornings.' }).expect(200);
  const proposal = (await agent.post('/api/assistant/proposals').send({}).expect(200)).body.proposal;
  await other.agent.post(`/api/assistant/proposals/${proposal.id}/apply`).send({ revision: 0, tagCodes: [] }).expect(404);
  const saved = (await agent.put('/api/draft').send({ ...draft, introMarkdown: 'A manual edit worth keeping.' }).expect(200)).body.draft;
  await agent.post(`/api/assistant/proposals/${proposal.id}/apply`).send({ revision: saved.revision, tagCodes: [] }).expect(409);
  assert.equal((await agent.get('/api/me')).body.draft.introMarkdown, 'A manual edit worth keeping.');
  assert.equal((await other.agent.get('/api/me')).body.conversation, null);
});
integration('disabled accounts cannot read or mutate profiles through existing sessions', async () => {
  const { agent, state } = await registered();
  await pool.query("UPDATE users SET status='blocked' WHERE id=$1", [state.user.id]);
  await agent.get('/api/me').expect(403);
  await agent.post('/api/profile/publish').send({ revision: 0 }).expect(403);
});

integration('signed Telegram login and retried bot starts share one private identity', async () => {
  const botToken = '123456:test-only-token';
  const telegramApp = createApp(pool, { ...loadConfig(), authMode: 'telegram', botToken, webhookSecret: 'test-webhook-secret' });
  const telegramId = 123456789;
  const update = { update_id: 123, message: { text: '/start', from: { id: telegramId } } };
  await request(telegramApp).post('/api/auth/demo').send({}).expect(404);
  await request(telegramApp).post('/api/telegram/webhook').send(update).expect(401);
  for (let i = 0; i < 2; i++) {
    await request(telegramApp).post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', 'test-webhook-secret').send(update).expect(200);
  }
  const data = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: telegramId, first_name: 'Private Telegram name' }) });
  const check = [...data.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  data.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  const agent = request.agent(telegramApp);
  await agent.post('/api/auth/telegram').send({ initData: data.toString() }).expect(200);
  const state = (await agent.get('/api/me').expect(200)).body;
  const account = (await pool.query('SELECT * FROM telegram_accounts WHERE telegram_user_id=$1', [telegramId])).rows;
  assert.equal(account.length, 1);
  assert.equal(account[0].user_id, state.user.id);
  assert.ok(account[0].bot_started_at);
  assert.equal((await pool.query('SELECT * FROM bot_updates WHERE update_id=123')).rowCount, 1);
  assert.ok(!JSON.stringify(state).includes(String(telegramId)));
  assert.ok(!JSON.stringify(state).includes('Private Telegram name'));
  data.set('user', JSON.stringify({ id: telegramId + 1 }));
  await request(telegramApp).post('/api/auth/telegram').send({ initData: data.toString() }).expect(401);
});

integration('OpenRouter uses saved bio at start, retains demo history, and applies a rewritten draft only after approval', async () => {
  const { agent: demo, cookie, draft } = await registered();
  await demo.post('/api/assistant/start').send({ consent: true }).expect(200);
  await demo.post('/api/assistant/messages').send({ requestId: randomUUID(), content: 'I keep a notebook of ideas for tiny train games.' }).expect(200);
  const existing = 'I make tiny games. Coffee is non-negotiable.';
  let saved = (await demo.put('/api/draft').send({ ...draft, introMarkdown: existing }).expect(200)).body.draft;
  let questionCalls = 0;
  const config = { ...loadConfig(), authMode: 'demo' as const, aiMode: 'openrouter' as const, openrouterApiKey: 'test' };
  const fetcher = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const input = JSON.parse(body.messages[1].content);
    let value;
    if (body.response_format.json_schema.name === 'questr_question') {
      assert.equal(input.currentBio, existing);
      assert.ok(input.transcript.some((m: any) => m.content.includes('notebook')));
      questionCalls++;
      value = { question: 'What is one idea from that notebook?' };
    } else {
      assert.equal(input.currentBio.markdown, existing);
      const evidence = input.transcript.find((m: any) => m.role === 'user');
      value = { introMarkdown: 'I make tiny games and keep a notebook of train-game ideas. Coffee is non-negotiable.', changeSummary: 'Wove the notebook detail into your existing bio.', sourceIds: ['bio', evidence.id], suggestedTags: [] };
    }
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }));
  }) as typeof fetch;
  const live = request.agent(createApp(pool, config, new Interviewer(config, fetcher), new ContentReviewer({ ...config, aiMode: 'demo' })));
  const get = () => live.get('/api/me').set('Cookie', cookie);
  const post = (path: string, body: object) => live.post(path).set('Cookie', cookie).send(body);
  assert.equal((await get()).body.conversation, null);
  await post('/api/assistant/proposals', {}).expect(403);
  const conversation = (await post('/api/assistant/start', { consent: true }).expect(200)).body.conversation;
  assert.equal(conversation.messages.filter((m: any) => m.role === 'user').length, 1);
  assert.equal(conversation.messages.at(-1).content, 'What is one idea from that notebook?');
  await post('/api/assistant/start', { consent: true }).expect(200);
  assert.equal(questionCalls, 1);
  const proposal = (await post('/api/assistant/proposals', {}).expect(200)).body.proposal;
  assert.equal(proposal.baseMarkdown, existing);
  assert.equal((await get()).body.draft.introMarkdown, existing);
  const resumed = (await get()).body.proposal;
  assert.equal(resumed.changeSummary, proposal.changeSummary);
  assert.deepEqual(resumed.sourceIds, proposal.sourceIds);
  saved = (await post(`/api/assistant/proposals/${proposal.id}/apply`, { revision: saved.revision, tagCodes: [] }).expect(200)).body.draft;
  assert.equal(saved.introMarkdown, proposal.introMarkdown);
  assert.equal(saved.introMarkdown.match(/tiny games/g).length, 1);
});

integration('a failed generated opening is retryable and never inserts a scripted substitute', async () => {
  let calls = 0;
  const config = { ...loadConfig(), authMode: 'demo' as const, aiMode: 'openrouter' as const, openrouterApiKey: 'test' };
  const fetcher = (async () => {
    if (++calls === 1) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ question: 'What did you enjoy doing this week?' }) } }] }));
  }) as typeof fetch;
  const { agent } = await registered(createApp(pool, config, new Interviewer(config, fetcher), new ContentReviewer({ ...config, aiMode: 'demo' })));
  await agent.post('/api/assistant/start').send({ consent: true }).expect(503);
  assert.equal((await agent.get('/api/me')).body.conversation, null);
  const result = (await agent.post('/api/assistant/start').send({ consent: true }).expect(200)).body;
  assert.equal(result.conversation.messages.length, 1);
  assert.equal(calls, 2);
});

integration('explicit manual bios are highlighted and cannot overwrite a saved profile, even through direct API requests', async () => {
  const { agent, draft } = await registered();
  let saved = (await agent.put('/api/draft').send({ ...draft, avatarId: 'moss', introMarkdown: 'I like quiet coffee breaks.' }).expect(200)).body.draft;
  await agent.post('/api/profile/publish').send({ revision: saved.revision }).expect(200);
  const phrase = 'I want to have **sex** with you.';
  const text = `☕ I like **coffee**.\n\n${phrase}`;
  saved = (await agent.put('/api/draft').send({ ...saved, introMarkdown: text }).expect(200)).body.draft;
  const review = (await agent.post('/api/draft/validate').send({ revision: saved.revision }).expect(200)).body.bioReview;
  assert.equal(review.status, 'blocked');
  assert.equal(text.slice(review.spans[0].start, review.spans[0].end), phrase);
  const rejected = (await agent.post('/api/profile/publish').send({ revision: saved.revision }).expect(422)).body;
  assert.equal(rejected.error, 'CONTENT_REQUIRES_CHANGES');
  assert.equal(rejected.details.bioReview.introMarkdown, text);
  let state = (await agent.get('/api/me')).body;
  assert.equal(state.draft.introMarkdown, text);
  assert.equal(state.profile.introMarkdown, 'I like quiet coffee breaks.');
  assert.equal(state.bioReview.status, 'blocked');
  saved = (await agent.put('/api/draft').send({ ...saved, introMarkdown: 'I am gay, enjoy coffee and am open to dating.' }).expect(200)).body.draft;
  assert.equal((await agent.get('/api/me')).body.bioReview, null);
  await agent.post('/api/profile/publish').send({ revision: saved.revision }).expect(200);
  state = (await agent.get('/api/me')).body;
  assert.equal(state.bioReview.status, 'approved');
  assert.equal(state.profile.introMarkdown, saved.introMarkdown);
});

integration('chat flags survive reload, historical answers can be reviewed, and retries do not duplicate the redirection', async () => {
  const { agent } = await registered();
  await agent.post('/api/assistant/start').send({ consent: true }).expect(200);
  const content = 'I want to have sex with you.';
  const message = { requestId: randomUUID(), content };
  let conversation = (await agent.post('/api/assistant/messages').send(message).expect(200)).body.conversation;
  const userMessage = conversation.messages.find((m: any) => m.role === 'user');
  assert.equal(userMessage.contentReview.status, 'blocked');
  assert.match(conversation.messages.at(-1).content, /Please keep explicitly sexual messages out/);
  await agent.post('/api/assistant/messages').send(message).expect(200);
  await pool.query('UPDATE ai_messages SET content_review=NULL,review_version=NULL WHERE id=$1', [userMessage.id]);
  await agent.post('/api/assistant/review').send({}).expect(200);
  conversation = (await agent.get('/api/me')).body.conversation;
  assert.equal(conversation.messages.filter((m: any) => m.role === 'user').length, 1);
  assert.equal(conversation.messages.length, 3);
  assert.equal(conversation.messages[1].contentReview.status, 'blocked');
  assert.equal(conversation.messages[1].content, content);
});

integration('a moderation outage blocks profile publication without losing the private draft', async () => {
  const config = { ...loadConfig(), aiMode: 'demo' as const, authMode: 'demo' as const };
  const reviewer = new ContentReviewer({ ...config, aiMode: 'openrouter', openrouterModel: 'unavailable-test' }, (async () => new Response('{}', { status: 503 })) as typeof fetch);
  const { agent, draft } = await registered(createApp(pool, config, new Interviewer(config), reviewer));
  const saved = (await agent.put('/api/draft').send({ ...draft, avatarId: 'moss', introMarkdown: 'My words are still mine.' }).expect(200)).body.draft;
  const result = (await agent.post('/api/profile/publish').send({ revision: saved.revision }).expect(503)).body;
  assert.equal(result.error, 'CONTENT_REVIEW_UNAVAILABLE');
  const state = (await agent.get('/api/me')).body;
  assert.equal(state.profile, null); assert.equal(state.draft.introMarkdown, saved.introMarkdown);
});

integration('a bio edited while the reviewer runs cannot use the old text approval', async () => {
  const config = { ...loadConfig(), aiMode: 'demo' as const, authMode: 'demo' as const };
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const reviewer = new ContentReviewer({ ...config, aiMode: 'openrouter', openrouterModel: 'race-review-test' }, (async () => {
    entered(); await gate;
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"explicit":false,"excerpts":[]}' } }] }));
  }) as typeof fetch);
  const { agent, draft } = await registered(createApp(pool, config, new Interviewer(config), reviewer));
  const saved = (await agent.put('/api/draft').send({ ...draft, avatarId: 'moss', introMarkdown: 'Original safe bio.' }).expect(200)).body.draft;
  const pending = agent.post('/api/profile/publish').send({ revision: saved.revision }).then(result => result);
  await started;
  await agent.put('/api/draft').send({ ...saved, introMarkdown: 'Changed during the review.' }).expect(200);
  release();
  const result = await pending;
  assert.equal(result.status, 409); assert.equal(result.body.error, 'REVIEW_STALE');
  assert.equal((await agent.get('/api/me')).body.profile, null);
});

integration('explicit model-generated proposals are rejected before storage or application', async () => {
  const config = { ...loadConfig(), authMode: 'demo' as const, aiMode: 'openrouter' as const, openrouterApiKey: 'test' };
  const fetcher = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    const result = body.response_format.json_schema.name === 'questr_question' ? { question: 'What did you enjoy about your last coffee break?' } : {
      introMarkdown: 'I want to have sex with you.', sourceIds: ['bio'], suggestedTags: [], changeSummary: 'Updated your bio.',
    };
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }));
  }) as typeof fetch;
  const { agent, draft } = await registered(createApp(pool, config, new Interviewer(config, fetcher), new ContentReviewer({ ...config, aiMode: 'demo' })));
  const saved = (await agent.put('/api/draft').send({ ...draft, introMarkdown: 'I love quiet coffee breaks.' }).expect(200)).body.draft;
  await agent.post('/api/assistant/start').send({ consent: true }).expect(200);
  const result = (await agent.post('/api/assistant/proposals').send({}).expect(422)).body;
  assert.equal(result.error, 'ASSISTANT_DRAFT_REJECTED');
  const state = (await agent.get('/api/me')).body;
  assert.equal(state.proposal, null); assert.equal(state.draft.introMarkdown, saved.introMarkdown);
});

integration('topic-change retries retain one control event, preserve the bio and never create source material', async () => {
  let fail = true;
  const config = { ...loadConfig(), authMode: 'demo' as const, aiMode: 'openrouter' as const, openrouterApiKey: 'test' };
  const fetcher = (async (_url: string, init: RequestInit) => {
    const input = JSON.parse(JSON.parse(init.body as string).messages[1].content);
    if (input.topicChangeRequested && fail) { fail = false; return new Response('{}', { status: 503 }); }
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ question: input.topicChangeRequested ? 'What kind of music do you enjoy?' : 'What do you enjoy about climbing?' }) } }] }));
  }) as typeof fetch;
  const { agent, draft } = await registered(createApp(pool, config, new Interviewer(config, fetcher), new ContentReviewer({ ...config, aiMode: 'demo' })));
  await agent.post('/api/assistant/start').send({ consent: true }).expect(200);
  const input = { requestId: randomUUID(), action: 'change_topic' };
  await agent.post('/api/assistant/messages').send(input).expect(503);
  let state = (await agent.get('/api/me')).body;
  assert.equal(state.conversation.messages.at(-1).kind, 'change_topic');
  await agent.post('/api/assistant/messages').send(input).expect(200);
  await agent.post('/api/assistant/messages').send(input).expect(200);
  await agent.post('/api/assistant/messages').send({ requestId: input.requestId, content: 'Different content' }).expect(409);
  await agent.post('/api/assistant/messages').send({ ...input, content: 'Mixed payload' }).expect(400);
  await agent.post('/api/assistant/proposals').send({}).expect(422);
  state = (await agent.get('/api/me')).body;
  assert.equal(state.conversation.messages.length, 3);
  assert.equal(state.conversation.messages.at(-1).content, 'What kind of music do you enjoy?');
  assert.equal(state.conversation.messages[1].contentReview, null);
  assert.equal(state.draft.introMarkdown, draft.introMarkdown);
});
