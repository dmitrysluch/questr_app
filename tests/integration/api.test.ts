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
integration('browser language starts the interface, and an explicit choice survives another login', async () => {
  const agent = request.agent(app);
  await agent.post('/api/auth/demo').send({ browserLanguage: 'ru-RU' }).expect(200);
  const initial = (await agent.get('/api/me').expect(200)).body;
  assert.equal(initial.user.locale, 'ru');
  await agent.put('/api/locale').send({ locale: 'en' }).expect(200);
  await agent.post('/api/auth/demo').send({ browserLanguage: 'ru-RU' }).expect(200);
  assert.equal((await agent.get('/api/me').expect(200)).body.user.locale, 'en');
  assert.equal((await pool.query('SELECT locale_source FROM users WHERE id=$1', [initial.user.id])).rows[0].locale_source, 'manual');
  await agent.put('/api/locale').send({ locale: 'de' }).expect(400);
});
async function browser(target: Express = app) {
  const agent = request.agent(target);
  const auth = await agent.post('/api/auth/demo').send({}).expect(200);
  const { body } = await agent.get('/api/me').expect(200);
  return { agent, state: body, cookie: auth.headers['set-cookie'][0].split(';')[0] };
}
async function registered(target: Express = app, withDiscovery = true) {
  const { agent, state, cookie } = await browser(target);
  const result = await agent.post('/api/register').send({ displayName: 'Moss', invite: state.demoInvite, adult: true, terms: true, locale: 'en' }).expect(200);
  if (withDiscovery) await agent.put('/api/discovery').send({ revision: 0, locationIds: ['country:IL'], languageCodes: ['en'] }).expect(200);
  return { agent, state, cookie, draft: result.body.draft };
}
integration('first publication requires saved adventure locations and languages', async () => {
  const { agent, draft } = await registered(app, false);
  const saved = (await agent.put('/api/draft').send({ ...draft, avatarId: 'moss' }).expect(200)).body.draft;
  const publish = () => agent.post('/api/profile/publish').send({ revision: saved.revision });
  assert.equal((await publish().expect(422)).body.error, 'DISCOVERY_REQUIRED');
  await agent.put('/api/discovery').send({ revision: 0, locationIds: ['country:IL'], languageCodes: [] }).expect(200);
  assert.equal((await publish().expect(422)).body.error, 'DISCOVERY_REQUIRED');
  await agent.put('/api/discovery').send({ revision: 1, locationIds: [], languageCodes: ['en'] }).expect(200);
  assert.equal((await publish().expect(422)).body.error, 'DISCOVERY_REQUIRED');
  await agent.put('/api/discovery').send({ revision: 2, locationIds: ['country:IL'], languageCodes: ['en'] }).expect(200);
  await publish().expect(200);
  assert.equal((await agent.get('/api/me')).body.user.status, 'active');
});
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
  const updated = { ...draft, avatarId: 'moss', introMarkdown: text, askMeTopics: ['Ask me how I ended up at the jam', 'Ask me about the train game I am making'], tags: [{ kind: 'catalog', code: 'edm' }, { kind: 'custom', label: 'Tiny games', emoji: '🧑‍💻', locale: 'en' }] };
  const saved = (await agent.put('/api/draft').send(updated).expect(200)).body.draft;
  await agent.put('/api/draft').send({ ...updated, introMarkdown: 'stale' }).expect(409);
  const profile = (await agent.post('/api/profile/publish').send({ revision: saved.revision }).expect(200)).body.profile;
  assert.equal(profile.introMarkdown, text); assert.deepEqual(profile.tags, updated.tags); assert.deepEqual(profile.askMeTopics, updated.askMeTopics);
  const state = (await agent.get('/api/me').expect(200)).body;
  assert.equal(state.user.status, 'active'); assert.equal(state.draft.introMarkdown, text);
  assert.ok(!JSON.stringify(state).includes('telegram_user_id'));
});
integration('explicit Ask me topics are highlighted and cannot be published', async () => {
  const { agent, draft } = await registered();
  const topic = 'I want to have sex with you.';
  const saved = (await agent.put('/api/draft').send({ ...draft, avatarId: 'moss', askMeTopics: [topic] }).expect(200)).body.draft;
  const review = (await agent.post('/api/draft/validate').send({ revision: saved.revision }).expect(200)).body.bioReview;
  assert.equal(review.topicReviews[0].status, 'blocked');
  assert.deepEqual(review.topicReviews[0].spans, [{ start: 0, end: topic.length }]);
  const result = (await agent.post('/api/profile/publish').send({ revision: saved.revision }).expect(422)).body;
  assert.equal(result.error, 'CONTENT_REQUIRES_CHANGES');
  assert.equal(result.details.bioReview.askMeTopics[0], topic);
  assert.equal((await agent.get('/api/me')).body.profile, null);
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
  const data = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: telegramId, first_name: 'Private Telegram name', language_code: 'ru' }) });
  const check = [...data.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(botToken).digest();
  data.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  const agent = request.agent(telegramApp);
  await agent.post('/api/auth/telegram').send({ initData: data.toString(), browserLanguage: 'en-US' }).expect(200);
  const state = (await agent.get('/api/me').expect(200)).body;
  assert.equal(state.user.locale, 'ru');
  const account = (await pool.query('SELECT * FROM telegram_accounts WHERE telegram_user_id=$1', [telegramId])).rows;
  assert.equal(account.length, 1);
  assert.equal(account[0].user_id, state.user.id);
  assert.ok(account[0].bot_started_at);
  assert.equal((await pool.query('SELECT * FROM bot_updates WHERE update_id=123')).rowCount, 1);
  assert.ok(!JSON.stringify(state).includes(String(telegramId)));
  assert.ok(!JSON.stringify(state).includes('Private Telegram name'));
  await agent.put('/api/locale').send({ locale: 'en' }).expect(200);
  await agent.post('/api/auth/telegram').send({ initData: data.toString() }).expect(200);
  assert.equal((await agent.get('/api/me').expect(200)).body.user.locale, 'en');
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
      value = { introMarkdown: 'I make tiny games and keep a notebook of train-game ideas. Coffee is non-negotiable.', changeSummary: 'Wove the notebook detail into your existing bio.', sourceIds: ['bio', evidence.id], suggestedTags: [], suggestedAskMeTopics: [{ text: 'Ask me about the train game ideas in my notebook', sourceId: evidence.id }] };
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
  assert.deepEqual((await get()).body.draft.askMeTopics, []);
  await post(`/api/assistant/proposals/${proposal.id}/apply`, { revision: saved.revision, tagCodes: [], askMeTopicIndexes: [1] }).expect(400);
  saved = (await post(`/api/assistant/proposals/${proposal.id}/apply`, { revision: saved.revision, tagCodes: [], askMeTopicIndexes: [0] }).expect(200)).body.draft;
  assert.equal(saved.introMarkdown, proposal.introMarkdown);
  assert.deepEqual(saved.askMeTopics, ['Ask me about the train game ideas in my notebook']);
  assert.equal((await get()).body.profile, null);
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
      introMarkdown: 'I want to have sex with you.', sourceIds: ['bio'], suggestedTags: [], suggestedAskMeTopics: [], changeSummary: 'Updated your bio.',
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

integration('spoken languages round-trip publicly; discovery stays private, separate and versioned', async () => {
  const { agent, draft, state } = await registered(app, false);
  const updated = { ...draft, avatarId: 'moss', spokenLanguages: ['ru', 'en'], introMarkdown: 'Coffee and climbing.' };
  const saved = (await agent.put('/api/draft').send(updated).expect(200)).body.draft;
  assert.deepEqual(saved.spokenLanguages, ['ru', 'en']);
  await agent.put('/api/draft').send({ ...saved, spokenLanguages: ['en', 'en'] }).expect(400);
  await agent.put('/api/draft').send({ ...saved, spokenLanguages: ['unknown'] }).expect(400);
  await agent.put('/api/draft').send({ ...saved, roles: ['admin'] }).expect(400);
  const preferences = { revision: 0, locationIds: ['city:294801', 'city:293397', 'online'], languageCodes: ['en', 'ru'] };
  const discovery = (await agent.put('/api/discovery').send(preferences).expect(200)).body.discovery;
  await agent.put('/api/discovery').send(preferences).expect(409);
  await agent.put('/api/discovery').send({ ...discovery, locationIds: ['city:999999999'] }).expect(400);
  await agent.put('/api/discovery').send({ ...discovery, languageCodes: ['xx'] }).expect(400);
  const profile = (await agent.post('/api/profile/publish').send({ revision: saved.revision }).expect(200)).body.profile;
  assert.deepEqual(profile.spokenLanguages, ['ru', 'en']);
  assert.ok(!('discovery' in profile)); assert.ok(!('locationIds' in profile));
  const current = (await agent.get('/api/me')).body;
  assert.equal(current.user.locale, 'en');
  assert.equal(current.draft.revision, saved.revision); // Filters don't invalidate bio proposals.
  assert.deepEqual(current.discovery, discovery);
  const stranger = await registered(app, false);
  assert.deepEqual((await stranger.agent.get('/api/me')).body.discovery.locationIds, []);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM role_assignments WHERE user_id=$1 AND role_code='member'", [state.user.id])).rows[0].count, 1);
});

integration('location search supports aliases, hierarchy and Online without crossing countries', async () => {
  const { agent } = await registered();
  for (const query of ['Haifa', 'Хайфа', 'חיפה']) {
    const locations = (await agent.get('/api/locations').query({ q: query }).expect(200)).body.locations;
    assert.ok(locations.some((location: any) => location.id === 'city:294801' && location.parentId === 'country:IL'));
  }
  const telAviv = (await agent.get('/api/locations').query({ q: 'Tel-Aviv' }).expect(200)).body.locations;
  assert.ok(telAviv.some((location: any) => location.id === 'city:293397'));
  const israel = (await agent.get('/api/locations').query({ q: 'ישראל' }).expect(200)).body.locations;
  assert.ok(israel.some((location: any) => location.id === 'country:IL'));
  const cities = (await agent.get('/api/locations').query({ parentId: 'country:IL' }).expect(200)).body.locations;
  assert.ok(cities.length); assert.ok(cities.every((location: any) => location.kind === 'city' && location.parentId === 'country:IL'));
  const online = (await agent.get('/api/locations').query({ ids: 'online' }).expect(200)).body.locations;
  assert.equal(online[0].parentId, null);
  await agent.get('/api/locations').query({ ids: 'malformed' }).expect(400);
});

integration('event discovery combines country descendants or exact cities/Online with event language', async () => {
  const { eventMatchesDiscovery, saveDiscovery } = await import('../../server/discovery.ts');
  const { agent, draft, state } = await registered();
  const saved = (await agent.put('/api/draft').send({ ...draft, avatarId: 'moss' }).expect(200)).body.draft;
  await agent.post('/api/profile/publish').send({ revision: saved.revision }).expect(200);
  let prefs = await saveDiscovery(pool, state.user.id, { revision: 1, locationIds: [], languageCodes: [] });
  const events: Record<string, string> = {};
  for (const [key, location, language] of [['haifa', 'city:294801', 'ru'], ['telAviv', 'city:293397', 'en'], ['jerusalem', 'city:281184', 'en'], ['amman', 'city:250441', 'en'], ['online', 'online', 'ru'], ['hebrew', 'city:294801', 'he']]) {
    events[key] = (await pool.query("INSERT INTO events(created_by,title,location_id,language_code,starts_at,ends_at,status) VALUES($1,'Test quest',$2,$3,now()+interval '1 day',now()+interval '1 day 2 hours','published') RETURNING id", [state.user.id, location, language])).rows[0].id;
  }
  const matches = async () => {
    const result: Record<string, boolean> = {};
    for (const [key, id] of Object.entries(events)) result[key] = await eventMatchesDiscovery(pool, state.user.id, id);
    return result;
  };
  assert.ok(Object.values(await matches()).every(value => !value));
  prefs = await saveDiscovery(pool, state.user.id, { ...prefs, locationIds: ['country:IL'], languageCodes: ['ru', 'en'] });
  assert.deepEqual(await matches(), { haifa: true, telAviv: true, jerusalem: true, amman: false, online: false, hebrew: false });
  prefs = await saveDiscovery(pool, state.user.id, { ...prefs, locationIds: ['city:294801', 'city:293397', 'online'] });
  assert.deepEqual(await matches(), { haifa: true, telAviv: true, jerusalem: false, amman: false, online: true, hebrew: false });
  await saveDiscovery(pool, state.user.id, { ...prefs, languageCodes: [] });
  assert.deepEqual(await matches(), { haifa: true, telAviv: true, jerusalem: false, amman: false, online: true, hebrew: true });
  await assert.rejects(pool.query("INSERT INTO events(created_by,title,location_id,language_code,starts_at,ends_at) VALUES($1,'Country is a filter','country:IL','en',now(),now()+interval '2 hours')", [state.user.id]), /city or Online/);
});

integration('permissions enforce ownership, location/event scopes, expiry, revocation and blocked accounts', async () => {
  const { can } = await import('../../server/permissions.ts');
  const { agent, draft, state } = await registered();
  const id = state.user.id;
  assert.equal(await can(pool, id, 'profile.edit', { type: 'profile', id }), true);
  assert.equal(await can(pool, id, 'profile.edit', { type: 'profile', id: randomUUID() }), false);
  assert.equal(await can(pool, id, 'events.create', { type: 'location', id: 'online' }), false); // onboarding
  const saved = (await agent.put('/api/draft').send({ ...draft, avatarId: 'moss' }).expect(200)).body.draft;
  await agent.post('/api/profile/publish').send({ revision: saved.revision }).expect(200);
  // Restrict both global grants to Israel to exercise ancestry.
  await pool.query("UPDATE role_assignments SET location_id='country:IL' WHERE user_id=$1", [id]);
  assert.equal(await can(pool, id, 'profile.edit', { type: 'profile', id }), true);
  assert.equal(await can(pool, id, 'events.create', { type: 'location', id: 'city:294801' }), true);
  assert.equal(await can(pool, id, 'events.create', { type: 'location', id: 'city:250441' }), false);
  assert.equal(await can(pool, id, 'events.create', { type: 'location', id: 'online' }), false);
  assert.equal(await can(pool, id, 'events.create', { type: 'location', id: 'city:999999999' }), false);
  const event = (await pool.query("INSERT INTO events(created_by,title,location_id,language_code,starts_at,ends_at) VALUES($1,'Scoped quest','online','en',now(),now()+interval '2 hours') RETURNING id", [id])).rows[0].id;
  const grant = (await pool.query("INSERT INTO role_assignments(user_id,role_code,event_id,reason) VALUES($1,'organizer',$2,'Test host') RETURNING id", [id, event])).rows[0].id;
  assert.equal(await can(pool, id, 'events.edit', { type: 'event', id: event }), true);
  assert.equal(await can(pool, id, 'events.edit', { type: 'event', id: randomUUID() }), false);
  assert.equal(await can(pool, id, 'events.group_chat', { type: 'event', id: event }), false); // Drafts and a role alone do not open a party chat.
  await pool.query("UPDATE role_assignments SET valid_from=now()+interval '1 day' WHERE id=$1", [grant]);
  assert.equal(await can(pool, id, 'events.edit', { type: 'event', id: event }), false);
  await pool.query("UPDATE role_assignments SET valid_from=now()-interval '2 days',valid_until=now()-interval '1 day' WHERE id=$1", [grant]);
  assert.equal(await can(pool, id, 'events.edit', { type: 'event', id: event }), false);
  await pool.query('UPDATE role_assignments SET valid_until=NULL,revoked_at=now() WHERE id=$1', [grant]);
  assert.equal(await can(pool, id, 'events.edit', { type: 'event', id: event }), false);
  await pool.query("UPDATE events SET status='completed' WHERE id=$1", [event]);
  assert.equal(await can(pool, id, 'events.view', { type: 'event', id: event }), false);
  await pool.query("INSERT INTO role_assignments(user_id,role_code,event_id,reason) VALUES($1,'participant',$2,'Accepted participant')", [id, event]);
  assert.equal(await can(pool, id, 'events.view', { type: 'event', id: event }), true);
  assert.equal(await can(pool, id, 'events.edit', { type: 'event', id: event }), false);
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Explicit admin test')", [id]);
  assert.equal(await can(pool, id, 'admin', { type: 'global' }), true);
  assert.equal(await can(pool, id, 'dm.message', { type: 'profile', id }), false);
  await pool.query("UPDATE users SET status='blocked' WHERE id=$1", [id]);
  assert.equal(await can(pool, id, 'admin', { type: 'global' }), false);
  await agent.get('/api/me').expect(403);
});

integration('budgets are atomic, rolling, retry-safe, rollback-safe and survive overlapping/replaced grants', async () => {
  const { consumeCapability } = await import('../../server/permissions.ts');
  const { transaction } = await import('../../server/db.ts');
  const { agent, draft, state } = await registered();
  const id = state.user.id;
  const saved = (await agent.put('/api/draft').send({ ...draft, avatarId: 'moss' }).expect(200)).body.draft;
  await agent.post('/api/profile/publish').send({ revision: saved.revision }).expect(200);
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'event_creator','Overlapping grant')", [id]);
  await pool.query("UPDATE capability_budgets SET max_uses=1 WHERE user_id=$1 AND capability='events.create'", [id]);
  const consume = (requestId: string, location = 'online') => transaction(pool, db => consumeCapability(db, id, 'events.create', { type: 'location', id: location }, requestId));
  const key = randomUUID();
  await assert.rejects(transaction(pool, async db => { await consumeCapability(db, id, 'events.create', { type: 'location', id: 'online' }, key); throw new Error('Action failed'); }), /Action failed/);
  const outcomes = await Promise.allSettled([consume(key), consume(randomUUID()), consume(randomUUID())]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  const usedKey = (await pool.query("SELECT request_id FROM capability_usage WHERE user_id=$1", [id])).rows[0].request_id;
  assert.equal(await consume(usedKey), 'replay');
  await assert.rejects(consume(usedKey, 'city:294801'), (error: any) => error.code === 'REQUEST_CONFLICT');
  await pool.query("DELETE FROM role_assignments WHERE user_id=$1", [id]);
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'event_creator','Replacement grant')", [id]);
  await assert.rejects(consume(randomUUID()), (error: any) => error.code === 'BUDGET_EXHAUSTED');
  await pool.query("UPDATE capability_budgets SET max_uses=2 WHERE user_id=$1 AND capability='events.create'", [id]);
  assert.equal(await consume(randomUUID()), 'new');
  await assert.rejects(consume(randomUUID()), (error: any) => error.code === 'BUDGET_EXHAUSTED');
  await pool.query("UPDATE capability_usage SET used_at=now()-interval '8 days' WHERE user_id=$1", [id]);
  assert.equal(await consume(randomUUID()), 'new');
  await pool.query("UPDATE capability_budgets SET max_uses=0 WHERE user_id=$1 AND capability='events.create'", [id]);
  await assert.rejects(consume(randomUUID()), (error: any) => error.code === 'BUDGET_EXHAUSTED');
});

integration('demo account creation stays limited while existing sessions can resume', async () => {
  const target = createApp(pool, { ...loadConfig(), authMode: 'demo', aiMode: 'demo' });
  const existing = request.agent(target);
  await existing.post('/api/auth/demo').send({}).expect(200);
  for (let index = 0; index < 35; index++) await existing.post('/api/auth/demo').send({}).expect(200);
  for (let index = 0; index < 29; index++) await request(target).post('/api/auth/demo').send({}).expect(200);
  await request(target).post('/api/auth/demo').send({}).expect(429);
  await existing.post('/api/auth/demo').send({}).expect(200);
});
