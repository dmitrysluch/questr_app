import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import sharp from 'sharp';
import { createPool, type Pool } from '../../server/db.ts';
import { migrate } from '../../server/migrate.ts';
import { createApp } from '../../server/app.ts';
import { loadConfig } from '../../server/config.ts';
import { wallTime } from '../../shared/events.ts';
import { cleanupDatePhotoDeletions, type DatePhotoStorage } from '../../server/date-photo-storage.ts';
import { EventBot } from '../../server/event-bot.ts';

const connection = process.env.TEST_DATABASE_URL;
const database = `questr_dates_${randomUUID().replaceAll('-', '')}`;
const config = { ...loadConfig(), authMode: 'demo' as const, aiMode: 'demo' as const, botToken: 'fake', webhookSecret: 'test-secret', publicAppUrl: 'https://questr.example' };
const locationCatalog = fileURLToPath(new URL('../fixtures/locations.json', import.meta.url));
const communityCatalog = fileURLToPath(new URL('../fixtures/communities.json', import.meta.url));
const files = new Map<string, Buffer>();
const storage: DatePhotoStorage = {
  async put(key, body) { files.set(key, body); },
  async get(key) { const value = files.get(key); if (!value) throw new Error('Missing test object'); return value; },
  async delete(key) { files.delete(key); },
};
let admin: Pool, pool: Pool, app: ReturnType<typeof createApp>;
let photo: string;
before(async () => {
  if (!connection) return;
  admin = createPool(connection);
  await admin.query(`CREATE DATABASE "${database}"`);
  const url = new URL(connection); url.pathname = `/${database}`;
  pool = createPool(url.toString());
  await migrate(pool, locationCatalog, communityCatalog);
  app = createApp(pool, config, undefined, undefined, undefined, undefined, storage);
  photo = (await sharp({ create: { width: 500, height: 500, channels: 3, background: '#83604f' } }).jpeg().toBuffer()).toString('base64');
});
after(async () => { if (!connection) return; await pool?.end(); await admin.query(`DROP DATABASE IF EXISTS "${database}"`); await admin.end(); });
const integration = (name: string, fn: () => Promise<void>) => test(name, { skip: !connection }, fn);
async function person(name: string, gender: 'woman' | 'man', interestedIn: ('woman' | 'man')[]) {
  const agent = request.agent(app);
  await agent.post('/api/auth/demo').send({}).expect(200);
  const state = (await agent.get('/api/me').expect(200)).body;
  const registered = (await agent.post('/api/register').send({ displayName: name, invite: state.demoInvite, adult: true, terms: true, locale: 'en' }).expect(200)).body;
  const draft = (await agent.put('/api/draft').send({ ...registered.draft, avatarId: 'moss', introMarkdown: `${name} likes music and coffee.`, spokenLanguages: ['en'] }).expect(200)).body.draft;
  await agent.put('/api/discovery').send({ revision: 0, locationIds: ['country:IL'], languageCodes: ['en'] }).expect(200);
  await agent.post('/api/profile/publish').send({ revision: draft.revision }).expect(200);
  const romance = (await agent.get('/api/me/romance').expect(200)).body.romance;
  await agent.put('/api/me/romance').send({ revision: romance.revision, gender, interestedIn, consent: true }).expect(200);
  await agent.put('/api/dates/me/settings').send({ enabled: true, paused: false, revision: 0, consent: true }).expect(200);
  return { agent, id: state.user.id as string };
}
async function approve(who: Awaited<ReturnType<typeof person>>, curator: Awaited<ReturnType<typeof person>>) {
  await who.agent.put('/api/dates/me/photo').send({ base64: photo }).expect(200);
  const queue = (await curator.agent.get('/api/dates/admin/photos').expect(200)).body.photos;
  const entry = queue.find((row: any) => row.userId === who.id);
  assert.ok(entry);
  await curator.agent.post(`/api/dates/admin/photos/${who.id}/review`).send({ photoId: entry.id, decision: 'approved' }).expect(200);
}
function input(overrides = {}) {
  const day = wallTime(new Date(Date.now() + 3 * 86400000).toISOString(), 'Asia/Jerusalem').slice(0, 10);
  return { requestId: randomUUID(), title: 'Coffee and an art-house film', description: 'We can pick a film and talk about it afterwards.',
    locationId: 'city:294801', languageCode: 'en', communityId: null, timeZone: 'Asia/Jerusalem', costNote: 'Cafe bill',
    privatePlace: 'Cafe at 12 Example Street', windows: [{ day, period: 'evening' }], ...overrides };
}

integration('date photos stay private until review and disappear immediately on deletion', async () => {
  const curator = await person('Curator', 'woman', ['man']);
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Dates test')", [curator.id]);
  const host = await person('Host', 'woman', ['man']);
  const guest = await person('Guest', 'man', ['woman']);
  const incompatible = await person('Incompatible', 'woman', ['woman']);
  await host.agent.put('/api/dates/me/photo').send({ base64: photo }).expect(200);
  const ownPending = await host.agent.get('/api/dates/me/photo').expect(200);
  assert.equal(ownPending.headers['content-type'], 'image/jpeg');
  assert.equal(ownPending.headers['cache-control'], 'private, no-store');
  assert.ok(ownPending.body.length > 0);
  await guest.agent.get('/api/dates/me/photo').expect(404);
  await host.agent.post('/api/dates').send(input()).expect(403);
  const queue = (await curator.agent.get('/api/dates/admin/photos').expect(200)).body.photos;
  await curator.agent.post(`/api/dates/admin/photos/${host.id}/review`).send({ photoId: queue.find((r: any) => r.userId === host.id).id, decision: 'approved' }).expect(200);
  await approve(guest, curator);
  await approve(incompatible, curator);
  const created = (await host.agent.post('/api/dates').send(input()).expect(201)).body.date;
  assert.equal(created.privatePlace, 'Cafe at 12 Example Street');
  assert.equal((await guest.agent.get('/api/dates').expect(200)).body.dates.length, 1);
  assert.equal((await guest.agent.get(`/api/dates/${created.id}`).expect(200)).body.date.privatePlace, null);
  await incompatible.agent.get(`/api/dates/${created.id}`).expect(404);
  const image = await guest.agent.get(`/api/dates/${created.id}/photo/${host.id}`).expect(200);
  assert.equal(image.headers['content-type'], 'image/jpeg');
  await incompatible.agent.get(`/api/dates/${created.id}/photo/${host.id}`).expect(404);
  await host.agent.delete('/api/dates/me/photo').send({}).expect(200);
  await host.agent.get('/api/dates/me/photo').expect(404);
  await guest.agent.get(`/api/dates/${created.id}/photo/${host.id}`).expect(404);
  assert.equal((await guest.agent.get('/api/dates').expect(200)).body.dates.length, 0);
  await cleanupDatePhotoDeletions(pool, storage);
  assert.equal([...files.keys()].some(key => key.startsWith(`date-photos/${host.id}/`)), false);
});

integration('concurrent create retries return one date and reject changed payloads', async () => {
  const curator = await person('Create admin', 'woman', ['man']);
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Dates test')", [curator.id]);
  const host = await person('Create host', 'woman', ['man']);
  await approve(host, curator);
  const payload = input();
  const [a, b] = await Promise.all([
    host.agent.post('/api/dates').send(payload),
    host.agent.post('/api/dates').send(payload),
  ]);
  assert.deepEqual([a.status, b.status], [201, 201]);
  assert.equal(a.body.date.id, b.body.date.id);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM dates WHERE owner_id=$1', [host.id])).rows[0].n, 1);
  await host.agent.post('/api/dates').send({ ...payload, title: 'Changed plan' }).expect(409);
});

integration('only one concurrent match succeeds; time and chat stay inside that match', async () => {
  const curator = await person('Review admin', 'woman', ['man']);
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Dates test')", [curator.id]);
  const host = await person('Date host', 'woman', ['man']);
  const first = await person('First guest', 'man', ['woman']);
  const second = await person('Second guest', 'man', ['woman']);
  for (const who of [host, first, second]) await approve(who, curator);
  const created = (await host.agent.post('/api/dates').send(input()).expect(201)).body.date;
  const firstResponse = (await first.agent.post(`/api/dates/${created.id}/responses`).send({ requestId: randomUUID(), message: 'I would love to see a film and discuss its ending.' }).expect(200)).body.date.myResponse;
  const secondResponse = (await second.agent.post(`/api/dates/${created.id}/responses`).send({ requestId: randomUUID(), message: 'I have a favorite art-house film to suggest for us.' }).expect(200)).body.date.myResponse;
  const [a, b] = await Promise.all([
    host.agent.post(`/api/dates/${created.id}/responses/${firstResponse.id}`).send({ action: 'accept' }),
    host.agent.post(`/api/dates/${created.id}/responses/${secondResponse.id}`).send({ action: 'accept' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const chosen = a.status === 200 ? first : second, other = a.status === 200 ? second : first;
  const matched = (await chosen.agent.get(`/api/dates/${created.id}`).expect(200)).body.date;
  assert.equal(matched.status, 'matched');
  assert.equal(matched.privatePlace, 'Cafe at 12 Example Street');
  assert.equal(matched.match.partnerId, chosen.id);
  assert.equal((await other.agent.get(`/api/dates/${created.id}`).expect(200)).body.date.match, null);
  await other.agent.post(`/api/dates/${created.id}/messages`).send({ requestId: randomUUID(), body: 'Hello' }).expect(404);
  const windowId = matched.windows[0].id;
  await host.agent.put(`/api/dates/${created.id}/votes`).send({ windowIds: [windowId] }).expect(200);
  await chosen.agent.put(`/api/dates/${created.id}/votes`).send({ windowIds: [windowId] }).expect(200);
  const localStart = `${matched.windows[0].day}T19:00`;
  await host.agent.post(`/api/dates/${created.id}/time`).send({ windowId, localStart, durationMinutes: 90 }).expect(200);
  await chosen.agent.post(`/api/dates/${created.id}/time/confirm`).send({}).expect(200);
  const message = (await chosen.agent.post(`/api/dates/${created.id}/messages`).send({ requestId: randomUUID(), body: 'That cafe sounds good to me.' }).expect(200)).body.date;
  assert.equal(message.messages.at(-1).body, 'That cafe sounds good to me.');
  await host.agent.post(`/api/dates/${created.id}/cancel`).send({ reason: 'plans_changed' }).expect(200);
  await chosen.agent.post(`/api/dates/${created.id}/messages`).send({ requestId: randomUUID(), body: 'Are we still meeting?' }).expect(409);
  const reopened = (await host.agent.post(`/api/dates/${created.id}/reopen`).send({ requestId: randomUUID(), windows: input().windows }).expect(200)).body.date;
  assert.notEqual(reopened.roundId, created.roundId);
  assert.equal((await other.agent.get('/api/dates').expect(200)).body.dates.some((d: any) => d.id === created.id), true);
});

integration('a match gets distinct Telegram topics and messages relay only through that date', async () => {
  const curator = await person('Telegram admin', 'woman', ['man']);
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Dates test')", [curator.id]);
  const host = await person('Topic host', 'woman', ['man']);
  const guest = await person('Topic guest', 'man', ['woman']);
  for (const who of [host, guest]) await approve(who, curator);
  const date = (await host.agent.post('/api/dates').send(input()).expect(201)).body.date;
  const response = (await guest.agent.post(`/api/dates/${date.id}/responses`).send({ requestId: randomUUID(), message: 'I would be happy to talk about films over coffee.' }).expect(200)).body.date.myResponse;
  const match = (await host.agent.post(`/api/dates/${date.id}/responses/${response.id}`).send({ action: 'accept' }).expect(200)).body.date.match;
  for (const [who, telegramId] of [[host, 771001], [guest, 771002]] as const) {
    await pool.query('INSERT INTO telegram_accounts(user_id,telegram_user_id,bot_started_at) VALUES($1,$2,now())', [who.id, telegramId]);
  }
  let nextThread = 800, nextMessage = 900;
  const calls: Array<{ method: string; body: any }> = [];
  const fakeFetch = (async (url: string, options: any) => {
    const method = url.split('/').at(-1)!;
    const body = JSON.parse(options.body);
    calls.push({ method, body });
    const result = method === 'createForumTopic' ? { message_thread_id: ++nextThread } : { message_id: ++nextMessage };
    return new Response(JSON.stringify({ ok: true, result }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const bot = new EventBot(pool, config, fakeFetch);
  for (let i = 0; i < 60; i++) if (!await bot.outbox()) break;
  const topics = (await pool.query('SELECT user_id,thread_id FROM date_bot_topics WHERE match_id=$1 ORDER BY user_id', [match.id])).rows;
  assert.equal(topics.length, 2);
  assert.notEqual(topics[0].thread_id, topics[1].thread_id);
  const guestThread = topics.find(row => row.user_id === guest.id).thread_id;
  const updateId = 887001;
  await pool.query('INSERT INTO bot_updates(update_id) VALUES($1)', [updateId]);
  await pool.query('INSERT INTO bot_inbox(update_id,user_id,text,thread_id) VALUES($1,$2,$3,$4)',
    [updateId, guest.id, 'A film about an old cinema sounds fun.', guestThread]);
  await bot.inbox();
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM date_messages WHERE match_id=$1', [match.id])).rows[0].n, 1);
  for (let i = 0; i < 20; i++) if (!await bot.outbox()) break;
  const hostThread = topics.find(row => row.user_id === host.id).thread_id;
  assert.ok(calls.some(call => call.method === 'sendMessage' && call.body.message_thread_id === Number(hostThread)
    && String(call.body.text).includes('A film about an old cinema')));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM dm_messages')).rows[0].n, 0);
  await pool.query('INSERT INTO bot_updates(update_id) VALUES($1)', [updateId + 1]);
  await pool.query('INSERT INTO bot_inbox(update_id,user_id,text,thread_id) VALUES($1,$2,$3,$4)', [updateId + 1, guest.id, '/chats', guestThread]);
  await bot.inbox();
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM date_messages WHERE match_id=$1', [match.id])).rows[0].n, 1);
});

integration('a date report blocks the pair and gives admins a photo-removal path', async () => {
  const curator = await person('Safety admin', 'woman', ['man']);
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Dates test')", [curator.id]);
  const host = await person('Photo host', 'woman', ['man']);
  const guest = await person('Photo guest', 'man', ['woman']);
  for (const who of [host, guest]) await approve(who, curator);
  const date = (await host.agent.post('/api/dates').send(input()).expect(201)).body.date;
  await guest.agent.post(`/api/dates/${date.id}/report`).send({ targetId: host.id, reason: 'photo' }).expect(200);
  await guest.agent.get(`/api/dates/${date.id}`).expect(404);
  const reports = (await curator.agent.get('/api/dates/admin/reports').expect(200)).body.reports;
  const report = reports.find((row: any) => row.targetId === host.id);
  assert.ok(report);
  await curator.agent.post(`/api/dates/admin/reports/${report.id}`).send({ action: 'remove_photo' }).expect(200);
  assert.equal((await host.agent.get('/api/dates/me/settings').expect(200)).body.settings.photoStatus, null);
});
