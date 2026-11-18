import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createPool, type Pool } from '../../server/db.ts';
import { migrate } from '../../server/migrate.ts';
import { createApp } from '../../server/app.ts';
import { loadConfig } from '../../server/config.ts';
import { can } from '../../server/permissions.ts';
import { EventBot } from '../../server/event-bot.ts';
import type { ProfileTag } from '../../shared/schema.ts';
import { appearanceForPreset, type AvatarAppearance } from '../../shared/avatar.ts';
import { googleMapsSearch } from '../../shared/event-links.ts';
const connection = process.env.TEST_DATABASE_URL;
const locationCatalogPath = fileURLToPath(new URL('../fixtures/locations.json', import.meta.url));
const communityCatalogPath = fileURLToPath(new URL('../fixtures/communities.json', import.meta.url));
const database = `questr_events_${randomUUID().replaceAll('-', '')}`;
const config = { ...loadConfig(), authMode: 'demo' as const, aiMode: 'demo' as const, botToken: 'fake-token', webhookSecret: 'test-secret', publicAppUrl: 'https://questr.example' };
let admin: Pool, pool: Pool;
let app: ReturnType<typeof createApp>;
before(async () => { if (!connection) return; admin = createPool(connection); await admin.query(`CREATE DATABASE "${database}"`); const url = new URL(connection); url.pathname = `/${database}`; pool = createPool(url.toString()); await migrate(pool, locationCatalogPath, communityCatalogPath); app = createApp(pool, config); });
after(async () => { if (!connection) return; await pool?.end(); await admin.query(`DROP DATABASE IF EXISTS "${database}"`); await admin.end(); });
const integration = (name: string, fn: () => Promise<void>) => test(name, { skip: !connection }, fn);
async function person(name = 'Moss', profile: { tags?: ProfileTag[]; askMeTopics?: string[]; openToRomance?: boolean; avatarAppearance?: AvatarAppearance } = {}) {
  const agent = request.agent(createApp(pool, config));
  const auth = await agent.post('/api/auth/demo').send({}).expect(200);
  const state = (await agent.get('/api/me').expect(200)).body;
  const { body } = await agent.post('/api/register').send({ displayName: name, invite: state.demoInvite, adult: true, terms: true, locale: 'en' }).expect(200);
  const draft = (await agent.put('/api/draft').send({ ...body.draft, avatarId: 'moss', introMarkdown: 'I like coffee, music and long walks.', spokenLanguages: ['en', 'ru'], ...profile }).expect(200)).body.draft;
  await agent.put('/api/discovery').send({ revision: 0, locationIds: ['country:IL'], languageCodes: ['en'] }).expect(200);
  await agent.post('/api/profile/publish').send({ revision: draft.revision }).expect(200);
  return { agent, id: state.user.id as string, cookie: auth.headers['set-cookie'][0].split(';')[0] as string };
}
function fields(extra = {}) { const start = Date.now() + 86400000; return { title: 'Coffee and records', activitySummary: 'Bring a record and listen over coffee.', descriptionMarkdown: 'Meet for coffee and bring a favourite record.', costEstimate: 'About ₪25', experienceNotes: 'No experience needed', onlinePlatform: 'Zoom', startsAt: new Date(start).toISOString(), endsAt: new Date(start + 7200000).toISOString(), timeZone: 'Asia/Jerusalem', locationId: 'city:294801', languageCode: 'en', capacity: 2, meetingDetails: 'Secret door 42, private meeting place', requestId: randomUUID(), ...extra }; }
const create = async (who: Awaited<ReturnType<typeof person>>, extra = {}) => (await who.agent.post('/api/events').send(fields(extra)).expect(201)).body.event;
const apply = async (who: Awaited<ReturnType<typeof person>>, id: string) => who.agent.post(`/api/events/${id}/applications`).send({ message: 'I would love to bring my new jazz record.' }).expect(200);
const decide = (who: Awaited<ReturnType<typeof person>>, id: string, target: string, action: string) => who.agent.post(`/api/events/${id}/members/${target}`).send({ action });

integration('community adventures are visible only to direct members and members of child communities', async () => {
  const curator = await person('Community curator'), ariel = await person('Ariel member');
  const israel = await person('Israeli universities member'), outsider = await person('Outsider');
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Test admin')", [curator.id]);
  for (const [member, communityId] of [[ariel, 'ariel_students'], [israel, 'israeli_university_students']] as const) {
    const inviteCode = `QUEST-${randomBytes(18).toString('base64url')}`;
    await curator.agent.post('/api/invites').send({ code: inviteCode, requestId: randomUUID(), expiresInDays: 7,
      communityIds: [communityId] }).expect(201);
    await member.agent.post('/api/invites/redeem').send({ code: inviteCode }).expect(200);
  }
  const arielEvent = await create(ariel, { title: 'Ariel coffee', communityId: 'ariel_students' });
  const israelEvent = await create(israel, { title: 'University coffee', communityId: 'israeli_university_students' });
  assert.equal(arielEvent.communityId, 'ariel_students');
  const visibleToAriel = (await ariel.agent.get('/api/events').expect(200)).body.events.map((event: any) => event.id);
  assert.ok(visibleToAriel.includes(arielEvent.id)); assert.ok(visibleToAriel.includes(israelEvent.id));
  const visibleToIsrael = (await israel.agent.get('/api/events').expect(200)).body.events.map((event: any) => event.id);
  assert.ok(visibleToIsrael.includes(israelEvent.id)); assert.ok(!visibleToIsrael.includes(arielEvent.id));
  assert.ok(!(await outsider.agent.get('/api/events').expect(200)).body.events.some((event: any) => event.id === arielEvent.id));
  await israel.agent.get(`/api/events/${arielEvent.id}`).expect(404);
  await outsider.agent.get(`/api/events/${arielEvent.id}/calendar.ics`).expect(404);
  await outsider.agent.post(`/api/events/${arielEvent.id}/applications`).send({ message: '' }).expect(404);
  await outsider.agent.post('/api/events').send(fields({ communityId: 'ariel_students' })).expect(403);
  const { requestId: _requestId, ...editedFields } = fields({ communityId: null });
  await ariel.agent.put(`/api/events/${arielEvent.id}`).send({ ...editedFields, revision: arielEvent.revision }).expect(409);
  const applicant = await person('Former Ariel member');
  const thirdCode = `QUEST-${randomBytes(18).toString('base64url')}`;
  await curator.agent.post('/api/invites').send({ code: thirdCode, requestId: randomUUID(), expiresInDays: 7,
    communityIds: ['ariel_students'] }).expect(201);
  await applicant.agent.post('/api/invites/redeem').send({ code: thirdCode }).expect(200);
  await applicant.agent.post(`/api/events/${arielEvent.id}/applications`).send({ message: '' }).expect(200);
  await pool.query('DELETE FROM user_community_grants WHERE user_id=$1', [applicant.id]);
  await ariel.agent.post(`/api/events/${arielEvent.id}/members/${applicant.id}`).send({ action: 'accept' }).expect(409);
  await applicant.agent.get(`/api/events/${arielEvent.id}`).expect(404);
  await pool.query('DELETE FROM user_community_grants WHERE user_id=$1', [ariel.id]);
  assert.equal(await can(pool, ariel.id, 'events.group_chat', { type: 'event', id: arielEvent.id }), false);
  await ariel.agent.get(`/api/events/${arielEvent.id}`).expect(404);
});

integration('manual public places are admin-owned and never reveal private meeting instructions', async () => {
  const curator = await person('Curator'), host = await person('Host'), guest = await person('Guest');
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Place catalog test')", [curator.id]);
  const input = { cityLocationId: 'city:294801', name: 'Record Room Cafe', address: '12 Music Street', active: true };
  await host.agent.post('/api/places/admin').send(input).expect(403);
  await host.agent.get('/api/places/admin').expect(403);
  const place = (await curator.agent.post('/api/places/admin').send(input).expect(201)).body.place;
  assert.equal(place.name, input.name);
  assert.deepEqual((await guest.agent.get('/api/places?cityId=city:294801&q=record').expect(200)).body.places.map((item: any) => item.id), [place.id]);
  assert.deepEqual((await guest.agent.get('/api/places?cityId=city:293397').expect(200)).body.places, []);
  const event = await create(host, { placeId: place.id, meetingDetails: 'Private apartment, door 42' });
  assert.equal(event.place.id, place.id);
  assert.equal(event.place.address, input.address);
  assert.match((await guest.agent.get(`/api/events/${event.id}/calendar.ics`).expect(200)).text, /Record Room Cafe/);
  assert.equal((await guest.agent.get(`/api/events/${event.id}`).expect(200)).body.event.meetingDetails, null);
  assert.ok(!JSON.stringify((await guest.agent.get('/api/events').expect(200)).body).includes('Private apartment'));
  await host.agent.post('/api/events').send(fields({ placeId: place.id, locationId: 'city:293397' })).expect(400);
  await curator.agent.put(`/api/places/admin/${place.id}`).send({ ...input, cityLocationId: 'city:293397', revision: place.revision }).expect(400);
  const archived = (await curator.agent.put(`/api/places/admin/${place.id}`).send({ ...input, active: false, revision: place.revision }).expect(200)).body.place;
  assert.equal(archived.active, false);
  assert.deepEqual((await guest.agent.get('/api/places?cityId=city:294801').expect(200)).body.places, []);
  assert.equal((await guest.agent.get(`/api/events/${event.id}`).expect(200)).body.event.place.name, input.name);
  const { requestId: _requestId, ...legacyEdit } = fields({ title: 'Coffee and records again' });
  const updated = (await host.agent.put(`/api/events/${event.id}`).send({ ...legacyEdit, revision: event.revision }).expect(200)).body.event;
  assert.equal(updated.place.id, place.id);
  await host.agent.post('/api/events').send(fields({ placeId: place.id })).expect(400);
});

integration('a Google search pick is a private meeting point and needs no public venue', async () => {
  const host = await person('Host'), guest = await person('Guest');
  const noVenue = await create(host, { meetingDetails: '' });
  assert.equal(noVenue.place, null);
  assert.equal('district' in noVenue, false);
  const meetingMapUrl = googleMapsSearch('meeting point', 'ChIJtestPrivatePoint');
  const event = await create(host, { meetingDetails: '', meetingMapUrl });
  assert.equal(event.place, null);
  assert.equal(event.meetingMapUrl, meetingMapUrl);
  const publicEvent = (await guest.agent.get(`/api/events/${event.id}`).expect(200)).body.event;
  assert.equal(publicEvent.meetingMapUrl, null);
  assert.equal(publicEvent.meetingDetails, null);
  assert.equal(publicEvent.place, null);
  assert.ok(!JSON.stringify((await guest.agent.get('/api/events').expect(200)).body).includes('ChIJtestPrivatePoint'));
});

integration('application note is optional and the host notification omits empty text', async () => {
  const host = await person('Host'), guest = await person('Quiet guest');
  const event = await create(host);
  const applied = (await guest.agent.post(`/api/events/${event.id}/applications`).send({}).expect(200)).body.event;
  assert.equal(applied.myStatus, 'pending');
  const applicant = (await host.agent.get(`/api/events/${event.id}`).expect(200)).body.event.applications[0];
  assert.equal(applicant.id, guest.id);
  assert.equal(applicant.applicationText, '');
  const notification = (await pool.query("SELECT body FROM bot_outbox WHERE event_id=$1 AND kind='application' AND application_user_id=$2", [event.id, guest.id])).rows[0];
  assert.equal(notification.body, `New application for ${event.title} from Quiet guest.`);
  await guest.agent.post(`/api/events/${event.id}/applications`).send({ message: 'x' }).expect(400);
  assert.equal((await host.agent.get(`/api/events/${event.id}`).expect(200)).body.event.applications.length, 1);
});

integration('party view shows shared tags, mutual romance and conversation topics only to the accepted party', async () => {
  const custom = (label: string): ProfileTag => ({ kind: 'custom', label, emoji: '💿', locale: 'en' });
  const hostLook = { ...appearanceForPreset('moss'), hairColor: 'blue' as const, headwear: 'headphones' as const };
  const guestLook = { ...appearanceForPreset('moss'), skinTone: 'deep' as const, top: 'plum_hoodie' as const };
  const host = await person('Host', { tags: [{ kind: 'catalog', code: 'coffee' }, custom('Record hunting')], askMeTopics: ['Ask me about my first record hunt.'], openToRomance: true, avatarAppearance: hostLook });
  const guest = await person('Guest', { tags: [custom('record HUNTING'), { kind: 'catalog', code: 'coffee' }], askMeTopics: ['Ask me which album I would bring.'], openToRomance: true, avatarAppearance: guestLook });
  const outsider = await person('Outsider');
  const event = await create(host);
  assert.deepEqual(event.host.avatarAppearance, hostLook);
  assert.deepEqual((await guest.agent.get(`/api/events/${event.id}`).expect(200)).body.event.participants, []);
  await apply(guest, event.id);
  assert.deepEqual((await guest.agent.get(`/api/events/${event.id}`).expect(200)).body.event.participants, []);
  await decide(host, event.id, guest.id, 'accept').expect(200);
  assert.equal((await guest.agent.get(`/api/events/${event.id}`).expect(200)).body.event.participants.find((person: any) => person.id === host.id).romanceMatch, false);
  await host.agent.put('/api/me/romance').send({ revision: (await host.agent.get('/api/me/romance').expect(200)).body.romance.revision, gender: 'man', interestedIn: ['woman'], consent: true }).expect(200);
  await guest.agent.put('/api/me/romance').send({ revision: (await guest.agent.get('/api/me/romance').expect(200)).body.romance.revision, gender: 'woman', interestedIn: ['man'], consent: true }).expect(200);
  const guestView = (await guest.agent.get(`/api/events/${event.id}`).expect(200)).body.event;
  const hostCard = guestView.participants.find((person: any) => person.id === host.id);
  assert.deepEqual(hostCard.avatarAppearance, hostLook);
  assert.deepEqual(hostCard.matchingTags, [{ kind: 'catalog', code: 'coffee' }, custom('Record hunting')]);
  assert.equal(hostCard.romanceMatch, true);
  assert.deepEqual(hostCard.askMeTopics, ['Ask me about my first record hunt.']);
  const selfCard = guestView.participants.find((person: any) => person.id === guest.id);
  assert.deepEqual(selfCard.avatarAppearance, guestLook);
  assert.deepEqual(selfCard.matchingTags, []); assert.equal(selfCard.romanceMatch, false);
  const hostView = (await host.agent.get(`/api/events/${event.id}`).expect(200)).body.event;
  assert.deepEqual(hostView.participants.find((person: any) => person.id === guest.id).matchingTags, [custom('record HUNTING'), { kind: 'catalog', code: 'coffee' }]);
  const publicProfile = (await guest.agent.get(`/api/events/${event.id}/profiles/${host.id}`).expect(200)).body.profile;
  assert.equal('gender' in publicProfile, false);
  assert.equal('interestedIn' in publicProfile, false);
  assert.equal('openToRomance' in publicProfile, false);
  assert.deepEqual((await outsider.agent.get(`/api/events/${event.id}`).expect(200)).body.event.participants, []);
  const guestSettings = (await guest.agent.get('/api/me/romance').expect(200)).body.romance;
  await guest.agent.put('/api/me/romance').send({ revision: guestSettings.revision, gender: 'woman', interestedIn: ['nonbinary'], consent: true }).expect(200);
  assert.equal((await host.agent.get(`/api/events/${event.id}`).expect(200)).body.event.participants.find((person: any) => person.id === guest.id).romanceMatch, false);
  await guest.agent.delete('/api/me/romance').send({}).expect(200);
  assert.equal((await host.agent.get(`/api/events/${event.id}`).expect(200)).body.event.participants.find((person: any) => person.id === guest.id).romanceMatch, false);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM romance_preferences WHERE user_id=$1', [guest.id])).rows[0].n, 0);
});

integration('Telegram Mini App submits applications directly; organizer buttons decide only live applications', async () => {
  const host = await person('Host'), guest = await person('Jazz guest'), other = await person('Other');
  const event = await create(host, { capacity: 3 });
  await pool.query('INSERT INTO telegram_accounts(user_id,telegram_user_id,bot_started_at) VALUES($1,4101,now()),($2,4102,now())', [host.id, other.id]);
  const telegramApp = createApp(pool, { ...config, authMode: 'telegram' });
  const applicationText = 'I can bring my Bill Evans record.';
  const applied = await request(telegramApp).post(`/api/events/${event.id}/applications`).set('Cookie', guest.cookie).send({ message: applicationText }).expect(200);
  assert.equal(applied.body.event.myStatus, 'pending');
  assert.equal((await pool.query('SELECT 1 FROM telegram_accounts WHERE user_id=$1', [guest.id])).rowCount, 0);
  const notification = (await pool.query("SELECT id,kind,body FROM bot_outbox WHERE event_id=$1 AND kind='application' AND application_user_id=$2", [event.id, guest.id])).rows[0];
  assert.match(notification.body, /Jazz guest/); assert.match(notification.body, /Bill Evans/);
  assert.ok(!notification.body.includes(event.meetingDetails));
  const calls: { method: string; body: any }[] = []; let messageId = 0;
  const fakeFetch = (async (url: string | URL | Request, options?: RequestInit) => {
    const method = String(url).split('/').at(-1)!; const body = JSON.parse(String(options?.body)); calls.push({ method, body });
    return Response.json({ ok: true, result: method === 'sendMessage' ? { message_id: ++messageId } : true });
  }) as typeof fetch;
  const bot = new EventBot(pool, config, fakeFetch);
  while (await bot.outbox()) { /* Drain any prior notifications. */ }
  const sent = calls.find(c => c.method === 'sendMessage' && c.body.text.includes(applicationText));
  assert.ok(sent); assert.equal(String(sent.body.chat_id), '4101');
  const buttons = sent.body.reply_markup.inline_keyboard[0];
  assert.deepEqual(buttons.map((b: any) => b.text), ['Accept', 'Decline']);
  const profileButton = sent.body.reply_markup.inline_keyboard[1][0];
  assert.equal(profileButton.text, 'View character');
  const profileUrl = new URL(profileButton.web_app.url);
  assert.equal(profileUrl.searchParams.get('route'), `adventures/${event.id}/character/${guest.id}`);
  assert.equal(sent.body.reply_markup.inline_keyboard.length, 2);
  assert.equal(buttons[0].callback_data, `application:accept:${notification.id}`);
  const sentId = (await pool.query('SELECT telegram_message_id FROM bot_outbox WHERE id=$1', [notification.id])).rows[0].telegram_message_id;
  const webhook = (update_id: number, telegramId: number, data: string, messageId = Number(sentId)) => request(telegramApp).post('/api/telegram/webhook')
    .set('X-Telegram-Bot-Api-Secret-Token', 'test-secret').send({ update_id, callback_query: { id: `callback-${update_id}`,
      from: { id: telegramId }, data, message: { message_id: messageId, chat: { id: telegramId, type: 'private' } } } }).expect(200);
  await webhook(41001, 4102, buttons[0].callback_data); await bot.inbox();
  assert.equal((await pool.query('SELECT status FROM event_memberships WHERE event_id=$1 AND user_id=$2', [event.id, guest.id])).rows[0].status, 'pending');
  await webhook(41002, 4101, buttons[0].callback_data); await webhook(41002, 4101, buttons[0].callback_data); await bot.inbox();
  assert.equal((await pool.query('SELECT status FROM event_memberships WHERE event_id=$1 AND user_id=$2', [event.id, guest.id])).rows[0].status, 'accepted');
  assert.ok(calls.some(c => c.method === 'answerCallbackQuery' && c.body.callback_query_id === 'callback-41002' && c.body.text === 'Accepted.'));
  assert.ok(calls.some(c => c.method === 'editMessageReplyMarkup' && Number(c.body.message_id) === Number(sentId) && c.body.reply_markup.inline_keyboard.length === 0));
  await webhook(41003, 4101, buttons[1].callback_data); await bot.inbox();
  assert.equal((await pool.query('SELECT status FROM event_memberships WHERE event_id=$1 AND user_id=$2', [event.id, guest.id])).rows[0].status, 'accepted');
  assert.ok(calls.some(c => c.method === 'answerCallbackQuery' && c.body.callback_query_id === 'callback-41003' && c.body.text.includes('no longer pending')));
  await guest.agent.post(`/api/events/${event.id}/leave`).send({}).expect(200);
  await request(telegramApp).post(`/api/events/${event.id}/applications`).set('Cookie', guest.cookie).send({ message: 'This time I will bring Coltrane.' }).expect(200);
  const nextNotice = (await pool.query("SELECT id,telegram_message_id FROM bot_outbox WHERE event_id=$1 AND kind='application' AND application_user_id=$2 ORDER BY id DESC LIMIT 1", [event.id, guest.id])).rows[0];
  assert.notEqual(nextNotice.id, notification.id);
  await webhook(41005, 4101, buttons[0].callback_data); await bot.inbox();
  assert.equal((await pool.query('SELECT status FROM event_memberships WHERE event_id=$1 AND user_id=$2', [event.id, guest.id])).rows[0].status, 'pending');
  assert.ok(calls.some(c => c.method === 'answerCallbackQuery' && c.body.callback_query_id === 'callback-41005' && c.body.text.includes('no longer pending')));
  while (await bot.outbox()) { /* Deliver the new application. */ }
  const currentMessageId = (await pool.query('SELECT telegram_message_id FROM bot_outbox WHERE id=$1', [nextNotice.id])).rows[0].telegram_message_id;
  await webhook(41006, 4101, `application:accept:${nextNotice.id}`, Number(currentMessageId)); await bot.inbox();
  assert.equal((await pool.query('SELECT status FROM event_memberships WHERE event_id=$1 AND user_id=$2', [event.id, guest.id])).rows[0].status, 'accepted');
  const declinedGuest = await person('Declined guest');
  await request(telegramApp).post(`/api/events/${event.id}/applications`).set('Cookie', declinedGuest.cookie).send({ message: 'I can bring some pastries.' }).expect(200);
  while (await bot.outbox()) { /* Deliver the next application. */ }
  const declinedNotice = calls.find(c => c.method === 'sendMessage' && c.body.text.includes('pastries'));
  assert.ok(declinedNotice);
  const declineButton = declinedNotice.body.reply_markup.inline_keyboard[0][1].callback_data;
  const declinedMessageId = (await pool.query("SELECT telegram_message_id FROM bot_outbox WHERE kind='application' AND application_user_id=$1", [declinedGuest.id])).rows[0].telegram_message_id;
  await webhook(41004, 4101, declineButton, Number(declinedMessageId)); await bot.inbox();
  assert.equal((await pool.query('SELECT status FROM event_memberships WHERE event_id=$1 AND user_id=$2', [event.id, declinedGuest.id])).rows[0].status, 'declined');
  assert.ok(calls.some(c => c.method === 'answerCallbackQuery' && c.body.callback_query_id === 'callback-41004' && c.body.text === 'Declined.'));
});

integration('creation is atomic, idempotent, budgeted and validates geography, time and content', async () => {
  const host = await person(); const body = fields();
  const initialAccess = (await host.agent.get('/api/events/create-access').expect(200)).body;
  assert.equal(initialAccess.hasRole, true); assert.equal(initialAccess.canCreate, true);
  assert.deepEqual(initialAccess.budget, { maxUses: 2, used: 0, windowDays: 7 });
  const results = await Promise.all([host.agent.post('/api/events').send(body), host.agent.post('/api/events').send(body)]);
  assert.deepEqual(results.map(r => r.status), [201, 201]); assert.equal(results[0].body.event.id, results[1].body.event.id);
  assert.equal(results[0].body.event.participantCount, 1); assert.equal(results[0].body.event.canChat, true);
  assert.equal(results[0].body.event.activitySummary, body.activitySummary);
  assert.equal(results[0].body.event.costEstimate, body.costEstimate);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM capability_usage WHERE user_id=$1", [host.id])).rows[0].n, 1);
  await host.agent.post('/api/events').send({ ...body, title: 'Different title' }).expect(409);
  for (const change of [{ locationId: 'country:IL' }, { locationId: 'online', meetingDetails: 'javascript:alert(1)' }, { district: '' }, { locationId: 'online', meetingDetails: 'http://meet.example/secret' }, { descriptionMarkdown: 'Meet at https://meet.example/secret at seven.' }, { startsAt: '2020-01-01T00:00:00Z' }, { endsAt: '2020-01-01T00:00:00Z' }, { meetingMapUrl: 'https://evil.example/maps/secret' }, { timeZone: 'Moon/Crater' }]) await host.agent.post('/api/events').send(fields(change)).expect(400);
  await host.agent.post('/api/events').send(fields({ descriptionMarkdown: 'I want to have sex with you.' })).expect(422);
  const online = await create(host, { locationId: 'online', meetingDetails: '', activitySummary: '', onlinePlatform: '', descriptionMarkdown: '## Coffee\n\nBring a favourite record.' });
  assert.equal(online.meetingDetails, ''); assert.equal(online.onlinePlatform, '');
  assert.equal(online.activitySummary, 'Coffee Bring a favourite record.');
  const { requestId: _requestId, ...editBody } = fields({ locationId: 'online', meetingDetails: 'https://us02web.zoom.us/j/123456789', activitySummary: '', onlinePlatform: '' });
  const edited = await host.agent.put(`/api/events/${online.id}`).send({ ...editBody, revision: online.revision }).expect(200);
  assert.equal(edited.body.event.onlinePlatform, 'Zoom');
  await host.agent.post('/api/events').send(fields()).expect(429);
  const exhausted = (await host.agent.get('/api/events/create-access').expect(200)).body;
  assert.equal(exhausted.hasRole, true); assert.equal(exhausted.canCreate, false);
  assert.equal(exhausted.budget.used, 2);
});
integration('creation access follows location-scoped roles before the form is opened', async () => {
  const host = await person();
  await pool.query("UPDATE role_assignments SET revoked_at=now() WHERE user_id=$1 AND role_code='event_creator'", [host.id]);
  assert.equal((await host.agent.get('/api/events/create-access').expect(200)).body.hasRole, false);
  await pool.query("INSERT INTO role_assignments(user_id,role_code,location_id,reason) VALUES($1,'event_creator','country:IL','Test scope')", [host.id]);
  assert.equal((await host.agent.get('/api/events/create-access').expect(200)).body.canCreate, true);
  assert.equal((await host.agent.get('/api/events/create-access?locationId=city:294801').expect(200)).body.canCreate, true);
  assert.equal((await host.agent.get('/api/events/create-access?locationId=online').expect(200)).body.hasRole, false);
  await host.agent.post('/api/events').send(fields({ locationId: 'online', meetingDetails: '' })).expect(403);
});
integration('discovery applies location ancestry and language together without exposing private details', async () => {
  const host = await person(), guest = await person();
  await pool.query("UPDATE capability_budgets SET max_uses=10 WHERE user_id=$1", [host.id]);
  const ids: string[] = [];
  for (const [locationId, languageCode] of [['city:294801','en'],['city:293397','ru'],['city:250441','en'],['online','en'],['city:294801','he']]) ids.push((await create(host, { locationId, languageCode, meetingDetails: locationId === 'online' ? 'https://meet.example/secret' : 'Secret door 42' })).id);
  await guest.agent.put('/api/discovery').send({ revision: 1, locationIds: ['country:IL'], languageCodes: ['en','ru'] }).expect(200);
  const first = (await guest.agent.get('/api/events')).body;
  assert.deepEqual(new Set(first.events.filter((e: any) => ids.includes(e.id)).map((e: any) => e.id)), new Set(ids.slice(0,2)));
  assert.ok(!JSON.stringify(first).includes('Secret door')); assert.ok(!JSON.stringify(first).includes('meetingDetails'));
  await guest.agent.put('/api/discovery').send({ revision: 2, locationIds: ['city:294801','online'], languageCodes: ['en'] }).expect(200);
  assert.deepEqual(new Set((await guest.agent.get('/api/events')).body.events.filter((e: any) => ids.includes(e.id)).map((e: any) => e.id)), new Set([ids[0],ids[3]]));
  await guest.agent.put('/api/discovery').send({ revision: 3, locationIds: ['country:IL'], languageCodes: [] }).expect(200);
  assert.deepEqual(new Set((await guest.agent.get('/api/events')).body.events.filter((e: any) => ids.includes(e.id)).map((e: any) => e.id)), new Set([ids[0],ids[1],ids[4]]));
  assert.equal((await guest.agent.get(`/api/events/${ids[0]}`)).body.event.meetingDetails, null);
  await guest.agent.get(`/api/events/${ids[0]}/profiles/${host.id}`).expect(200);
  await guest.agent.get(`/api/events/${ids[0]}/profiles/${randomUUID()}`).expect(404);
});
integration('closing recruitment stops new applications but lets the host decide pending ones', async () => {
  const host = await person(), pending = await person(), next = await person();
  const event = await create(host, { capacity: 3 });
  await apply(pending, event.id);
  await next.agent.put(`/api/events/${event.id}/recruitment`).send({ open: false, revision: 0 }).expect(403);
  const closed = (await host.agent.put(`/api/events/${event.id}/recruitment`).send({ open: false, revision: 0 }).expect(200)).body.event;
  assert.equal(closed.recruitmentOpen, false);
  assert.equal((await next.agent.get(`/api/events/${event.id}`).expect(200)).body.event.canApply, false);
  await next.agent.post(`/api/events/${event.id}/applications`).send({ message: 'I would like to join the record night.' }).expect(409);
  await decide(host, event.id, pending.id, 'accept').expect(200);
  await host.agent.put(`/api/events/${event.id}/recruitment`).send({ open: true, revision: 0 }).expect(409);
  const opened = (await host.agent.put(`/api/events/${event.id}/recruitment`).send({ open: true, revision: 1 }).expect(200)).body.event;
  assert.equal(opened.recruitmentOpen, true);
  await apply(next, event.id);
});
integration('withdrawn applications can be sent again, but declined ones cannot', async () => {
  const host = await person('Host'), guest = await person('Guest');
  const event = await create(host);
  await pool.query('INSERT INTO telegram_accounts(user_id,telegram_user_id,bot_started_at) VALUES($1,4201,now())', [host.id]);
  await apply(guest, event.id);
  await guest.agent.post(`/api/events/${event.id}/leave`).send({}).expect(200);
  const withdrawn = (await guest.agent.get(`/api/events/${event.id}`).expect(200)).body.event;
  assert.equal(withdrawn.myStatus, 'withdrawn'); assert.equal(withdrawn.canApply, true);
  assert.deepEqual((await host.agent.get(`/api/events/${event.id}`)).body.event.applications, []);
  const message = 'I can bring a different record this time.';
  const reapplied = (await guest.agent.post(`/api/events/${event.id}/applications`).send({ message }).expect(200)).body.event;
  assert.equal(reapplied.myStatus, 'pending'); assert.equal(reapplied.canApply, false);
  assert.equal((await host.agent.get(`/api/events/${event.id}`)).body.event.applications[0].applicationText, message);
  await guest.agent.post(`/api/events/${event.id}/applications`).send({ message }).expect(200);
  const notices = (await pool.query("SELECT id,state FROM bot_outbox WHERE event_id=$1 AND kind='application' AND application_user_id=$2 ORDER BY id", [event.id, guest.id])).rows;
  assert.equal(notices.length, 2);
  const sent: string[] = [];
  const bot = new EventBot(pool, config, (async (url: string | URL | Request, options?: RequestInit) => {
    if (String(url).endsWith('/sendMessage')) sent.push(JSON.parse(String(options?.body)).text);
    return Response.json({ ok: true, result: { message_id: sent.length + 1 } });
  }) as typeof fetch);
  while (await bot.outbox()) { /* Old application must be discarded; the new one is delivered. */ }
  const delivery = (await pool.query("SELECT state FROM bot_outbox WHERE id=ANY($1::bigint[]) ORDER BY id", [notices.map(row => row.id)])).rows;
  assert.deepEqual(delivery.map(row => row.state), ['discarded', 'sent']);
  assert.ok(sent.some(text => text.includes(message)));
  assert.ok(sent.every(text => !text.includes('I would love to bring my new jazz record.')));
  await decide(host, event.id, guest.id, 'decline').expect(200);
  const declined = (await guest.agent.get(`/api/events/${event.id}`)).body.event;
  assert.equal(declined.myStatus, 'declined'); assert.equal(declined.canApply, false);
  await guest.agent.post(`/api/events/${event.id}/applications`).send({ message }).expect(409);
});
integration('first contact rejects links before the host can receive them', async () => {
  const host = await person(), guest = await person();
  const event = await create(host);
  await guest.agent.post(`/api/events/${event.id}/applications`).send({ message: 'Join me at meet.google.com/secret' }).expect(400);
  assert.equal((await host.agent.get(`/api/events/${event.id}`).expect(200)).body.event.applications.length, 0);
});
integration('last-seat acceptance is serialized; exit revokes private details, chat and contextual profiles', async () => {
  const host = await person(), a = await person('Alex'), b = await person('Blair'), stranger = await person();
  const event = await create(host); await apply(a, event.id); await apply(b, event.id);
  assert.equal((await host.agent.get(`/api/events/${event.id}`)).body.event.applications.length, 2);
  const outcomes = await Promise.all([decide(host, event.id, a.id, 'accept'), decide(host, event.id, b.id, 'accept')]);
  assert.deepEqual(outcomes.map(o => o.status).sort(), [200,409]);
  const accepted = outcomes[0].status === 200 ? a : b;
  const pending = accepted === a ? b : a;
  const detail = (await accepted.agent.get(`/api/events/${event.id}`)).body.event;
  assert.equal(detail.participants.length, 2); assert.equal(detail.meetingDetails, event.meetingDetails); assert.equal(detail.canChat, true);
  await host.agent.get(`/api/events/${event.id}/profiles/${pending.id}`).expect(200);
  await accepted.agent.get(`/api/events/${event.id}/profiles/${pending.id}`).expect(404);
  await stranger.agent.get(`/api/events/${event.id}/profiles/${accepted.id}`).expect(404);
  await decide(stranger, event.id, pending.id, 'accept').expect(403);
  await host.agent.post(`/api/events/${event.id}/leave`).send({}).expect(400);
  await accepted.agent.post(`/api/events/${event.id}/leave`).send({}).expect(200);
  assert.equal(await can(pool, accepted.id, 'events.group_chat', { type: 'event', id: event.id }), false);
  const after = (await accepted.agent.get(`/api/events/${event.id}`)).body.event;
  assert.equal(after.meetingDetails, null); assert.deepEqual(after.participants, []); assert.equal(after.canApply, true);
  await accepted.agent.post(`/api/events/${event.id}/applications`).send({ message: 'Let me join again.' }).expect(200);
  assert.equal((await host.agent.get(`/api/events/${event.id}`)).body.event.applications.find((person: any) => person.id === accepted.id).applicationText, 'Let me join again.');
  await decide(host, event.id, pending.id, 'accept').expect(200);
  await decide(host, event.id, accepted.id, 'accept').expect(409);
  await decide(host, event.id, pending.id, 'remove').expect(200);
  assert.equal((await pending.agent.get(`/api/events/${event.id}`)).body.event.canChat, false);
  await decide(host, event.id, accepted.id, 'accept').expect(200);
  assert.equal((await accepted.agent.get(`/api/events/${event.id}`)).body.event.canChat, true);
  await host.agent.post(`/api/events/${event.id}/status`).send({ status: 'cancelled', revision: 0 }).expect(200);
  await stranger.agent.get(`/api/events/${event.id}`).expect(404);
  await accepted.agent.get(`/api/events/${event.id}`).expect(200); // Former applicants retain public history only.
});
integration('calendar exports only authorized meeting points and Telegram reminders follow live membership', async () => {
  const host = await person(), guest = await person(), stranger = await person();
  const event = await create(host, { meetingDetails: 'SECRET private climbing gym entrance', meetingMapUrl: 'https://maps.app.goo.gl/abc123' });
  assert.equal(Date.parse(event.endsAt) - Date.parse(event.startsAt), 7200000);
  const publicCalendar = (await guest.agent.get(`/api/events/${event.id}/calendar.ics`).expect(200)).text;
  assert.match(publicCalendar, /DTSTART:\d{8}T\d{6}Z/);
  assert.match(publicCalendar, /DTEND:\d{8}T\d{6}Z/);
  assert.ok(!publicCalendar.includes('SECRET'));
  await guest.agent.put(`/api/events/${event.id}/reminder`).send({ minutesBefore: 60 }).expect(403);
  await apply(guest, event.id); await decide(host, event.id, guest.id, 'accept').expect(200);
  assert.equal((await guest.agent.get(`/api/events/${event.id}`)).body.event.meetingMapUrl, 'https://maps.app.goo.gl/abc123');
  await guest.agent.put('/api/locale').send({ locale: 'ru' }).expect(200);
  const partyCalendar = (await guest.agent.get(`/api/events/${event.id}/calendar.ics`).expect(200)).text;
  assert.ok(partyCalendar.includes('SECRET'));
  assert.ok(partyCalendar.includes('maps.app.goo.gl/abc123'));
  assert.ok(partyCalendar.includes('Вылазка начнётся через час'));
  assert.ok(!(await stranger.agent.get(`/api/events/${event.id}/calendar.ics`).expect(200)).text.includes('SECRET'));
  await guest.agent.put(`/api/events/${event.id}/reminder`).send({ minutesBefore: 60 }).expect(200);
  assert.equal((await guest.agent.get(`/api/events/${event.id}`)).body.event.reminderMinutes, 60);
  await pool.query('UPDATE events SET starts_at=now()+interval \'30 minutes\' WHERE id=$1', [event.id]);
  const bot = new EventBot(pool, config, (async () => Response.json({ ok: true, result: { message_id: 1 } })) as typeof fetch);
  await bot.reminders();
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM bot_outbox WHERE kind='reminder' AND user_id=$1 AND event_id=$2", [guest.id, event.id])).rows[0].n, 1);
  assert.match((await pool.query("SELECT body FROM bot_outbox WHERE kind='reminder' AND user_id=$1 AND event_id=$2", [guest.id, event.id])).rows[0].body, /Напоминание/);
  await guest.agent.post(`/api/events/${event.id}/leave`).send({}).expect(200);
  while (await bot.outbox()) { /* Drain queued notifications and the revoked reminder. */ }
  assert.equal((await pool.query("SELECT state FROM bot_outbox WHERE kind='reminder' AND user_id=$1 AND event_id=$2", [guest.id, event.id])).rows[0].state, 'discarded');
  assert.ok(!(await guest.agent.get(`/api/events/${event.id}/calendar.ics`).expect(200)).text.includes('SECRET'));
});
integration('romance choices are private, consented, revision-protected and deleted on withdrawal', async () => {
  const personA = await person();
  const original = (await personA.agent.get('/api/me/romance').expect(200)).body.romance;
  assert.equal(original.enabled, false);
  assert.equal('openToRomance' in (await personA.agent.get('/api/me').expect(200)).body.profile, false);
  await personA.agent.put('/api/profile/romance').send({ revision: original.revision, openToRomance: true }).expect(409);
  const stranger = await person('Stranger');
  assert.equal((await stranger.agent.get('/api/me/romance').expect(200)).body.romance.enabled, false);
  await personA.agent.put('/api/me/romance').send({ revision: original.revision, gender: 'man', interestedIn: ['woman'] }).expect(400);
  await personA.agent.put('/api/me/romance').send({ revision: original.revision, gender: 'man', interestedIn: ['woman', 'woman'], consent: true }).expect(400);
  const updated = (await personA.agent.put('/api/me/romance').send({ revision: original.revision, gender: 'man', interestedIn: ['woman'], consent: true }).expect(200)).body.romance;
  assert.equal(updated.enabled, true);
  assert.equal(updated.gender, 'man');
  assert.deepEqual(updated.interestedIn, ['woman']);
  assert.equal('gender' in (await personA.agent.get('/api/me').expect(200)).body.profile, false);
  await personA.agent.put('/api/me/romance').send({ revision: original.revision, gender: 'man', interestedIn: ['woman'], consent: true }).expect(409);
  const disabled = (await personA.agent.delete('/api/me/romance').send({}).expect(200)).body.romance;
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.gender, null);
  assert.deepEqual(disabled.interestedIn, []);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM romance_preferences WHERE user_id=$1', [personA.id])).rows[0].n, 0);
  await personA.agent.put('/api/me/romance').send({ revision: updated.revision, gender: 'man', interestedIn: ['woman'], consent: true }).expect(409);
});
integration('editing uses revisions, preserves accepted seats and never puts a private address in notifications', async () => {
  const host = await person(), guest = await person(); const event = await create(host, { capacity: 3 });
  await apply(guest, event.id); await decide(host, event.id, guest.id, 'accept').expect(200);
  const { requestId: _, ...input } = fields({ title: 'Changed plan', meetingDetails: 'New PRIVATE address', revision: 0 });
  await guest.agent.put(`/api/events/${event.id}`).send(input).expect(403);
  await host.agent.put(`/api/events/${event.id}`).send(input).expect(200);
  await host.agent.put(`/api/events/${event.id}`).send(input).expect(409);
  assert.equal((await guest.agent.get(`/api/events/${event.id}`)).body.event.meetingDetails, 'New PRIVATE address');
  assert.ok(!(await pool.query('SELECT body FROM bot_outbox WHERE event_id=$1', [event.id])).rows.some(r => r.body.includes('PRIVATE address')));
  await host.agent.post(`/api/events/${event.id}/status`).send({ status: 'completed', revision: 1 }).expect(409);
  await pool.query("UPDATE events SET starts_at=now()-interval '1 hour' WHERE id=$1", [event.id]);
  await host.agent.post(`/api/events/${event.id}/status`).send({ status: 'completed', revision: 1 }).expect(200);
  assert.equal(await can(pool, guest.id, 'events.group_chat', { type: 'event', id: event.id }), false);
  await guest.agent.post(`/api/events/${event.id}/leave`).send({}).expect(200);
});
integration('party topics appear on acceptance and relay messages without a bot command', async () => {
  const host = await person('Host'), guest = await person('Guest [jazz]'), other = await person('Other');
  const event = await create(host, { capacity: 3 });
  for (const [who, telegramId] of [[host,1001],[guest,1002],[other,1003]] as const) await pool.query('INSERT INTO telegram_accounts(user_id,telegram_user_id,bot_started_at) VALUES($1,$2,now())', [who.id,telegramId]);
  const calls: { method: string; body: any }[] = []; let thread = 100; let message = 0;
  const fakeFetch = (async (url: string | URL | Request, options?: RequestInit) => { const method = String(url).split('/').at(-1)!; const body = JSON.parse(String(options?.body)); calls.push({ method, body }); return Response.json({ ok: true, result: method === 'createForumTopic' ? { message_thread_id: ++thread } : { message_id: ++message } }); }) as typeof fetch;
  const bot = new EventBot(pool, config, fakeFetch);
  const webhook = (update: any) => request(app).post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', 'test-secret').send(update).expect(200);
  const start = { update_id: 8001, message: { from: { id: 1002, username: 'PRIVATE_USERNAME' }, chat: { id: 1002, type: 'private' }, text: `/start quest_${event.id.replaceAll('-','')}` } };
  await webhook(start); await webhook(start); await bot.inbox();
  assert.equal((await pool.query("SELECT in_topic FROM bot_outbox WHERE dedupe_key='update:8001:reply'")).rows[0].in_topic, false);
  assert.equal((await pool.query('SELECT 1 FROM event_bot_topics WHERE user_id=$1 AND event_id=$2', [guest.id,event.id])).rowCount, 0);
  await apply(guest, event.id); await decide(host, event.id, guest.id, 'accept').expect(200);
  await apply(other, event.id); await decide(host, event.id, other.id, 'accept').expect(200);
  while (await bot.outbox()) { /* drain notifications too */ }
  const topic = (await pool.query('SELECT thread_id FROM event_bot_topics WHERE user_id=$1 AND event_id=$2', [guest.id,event.id])).rows[0].thread_id;
  assert.equal(calls.filter(c => c.method === 'createForumTopic').length, 3);
  assert.match((await guest.agent.get(`/api/events/${event.id}`).expect(200)).body.event.botUrl, new RegExp(`/${topic}$`));
  await webhook({ update_id: 8008, message: { from: { id: 1002 }, chat: { id: 1002, type: 'private' }, text: `/chat ${event.id.replaceAll('-', '').slice(0, 8)}` } });
  await bot.inbox();
  const chatReply = (await pool.query("SELECT body,in_topic FROM bot_outbox WHERE dedupe_key='update:8008:reply'")).rows[0];
  assert.equal(chatReply.in_topic, false); assert.match(chatReply.body, new RegExp(`/${topic}$`));
  assert.equal(calls.filter(c => c.method === 'createForumTopic').length, 3);
  await webhook({ update_id: 8002, message: { from: { id: 1002 }, chat: { id: -123, type: 'group' }, message_thread_id: Number(topic), text: 'Group text must not apply' } });
  assert.equal(await bot.inbox(), false);
  const text = (update_id: number, body: string) => webhook({ update_id, message: { from: { id: 1002, username: 'PRIVATE_USERNAME' }, chat: { id: 1002, type: 'private' }, message_thread_id: Number(topic), text: body } });
  await text(8009, '/people'); await bot.inbox();
  const topicCommand = (await pool.query("SELECT body,in_topic,reply_markup FROM bot_outbox WHERE dedupe_key='update:8009:reply'")).rows[0];
  assert.equal(topicCommand.in_topic, false);
  assert.match(topicCommand.body, /Bot commands work in All messages/);
  assert.ok(topicCommand.reply_markup.inline_keyboard.flat().some((button: any) => button.callback_data?.startsWith('menu:event:')));
  assert.equal((await pool.query('SELECT 1 FROM event_messages WHERE telegram_update_id=8009')).rowCount, 0);
  await webhook({ update_id: 8010, message: { from: { id: 1002 }, chat: { id: 1002, type: 'private' }, text: 'Hello from All messages' } });
  await bot.inbox();
  const offTopic = (await pool.query("SELECT body,in_topic FROM bot_outbox WHERE dedupe_key='update:8010:reply'")).rows[0];
  assert.equal(offTopic.in_topic, false);
  assert.match(offTopic.body, /Only bot commands work in All messages.*Use \/chats to find it/);
  await webhook({ update_id: 8011, message: { from: { id: 1002 }, chat: { id: 1002, type: 'private' }, message_thread_id: 999999, text: 'Hello from another topic' } });
  await bot.inbox();
  assert.match((await pool.query("SELECT body FROM bot_outbox WHERE dedupe_key='update:8011:reply'")).rows[0].body, /Only bot commands work in All messages/);
  await text(8003, 'I want to have sex with you.'); await bot.inbox();
  assert.equal((await pool.query('SELECT 1 FROM event_messages WHERE telegram_update_id=8003')).rowCount, 0);
  assert.ok((await pool.query("SELECT body FROM bot_outbox WHERE dedupe_key='update:8003:reply'")).rows[0].body.includes('QUESTR messages'));
  await text(8005, 'See you at seven! (bring *vinyl*).'); await text(8005, 'See you at seven! (bring *vinyl*).'); await bot.inbox();
  assert.equal((await pool.query('SELECT 1 FROM event_messages WHERE telegram_update_id=8005')).rowCount, 1);
  await other.agent.post(`/api/events/${event.id}/leave`).send({}).expect(200);
  while (await bot.outbox()) { /* dispatch with live permissions */ }
  const relays = calls.filter(c => c.method === 'sendMessage' && c.body.parse_mode === 'MarkdownV2' && String(c.body.chat_id) === '1001');
  assert.equal(relays.length, 1);
  assert.equal(relays[0].body.text, '*Guest \\[jazz\\]*:\nSee you at seven\\! \\(bring \\*vinyl\\*\\)\\.');
  assert.ok(!JSON.stringify(calls).includes('PRIVATE_USERNAME')); assert.ok(!JSON.stringify(calls).includes(event.meetingDetails));
  assert.equal((await pool.query("SELECT state FROM bot_outbox WHERE kind='relay' AND user_id=$1", [other.id])).rows[0].state, 'discarded');
  await host.agent.post(`/api/events/${event.id}/status`).send({ status: 'cancelled', revision: 0 }).expect(200);
  await text(8006, 'This cannot be relayed.'); await bot.inbox();
  assert.equal((await pool.query('SELECT 1 FROM event_messages WHERE telegram_update_id=8006')).rowCount, 0);
});
integration('joining a party does not expose messages sent before acceptance', async () => {
  const host = await person('Host'), guest = await person('Guest');
  const event = await create(host);
  await pool.query('INSERT INTO telegram_accounts(user_id,telegram_user_id,bot_started_at) VALUES($1,8301,now()),($2,8302,now())', [host.id, guest.id]);
  const calls: { method: string; body: any }[] = []; let thread = 8300, message = 0;
  const bot = new EventBot(pool, config, (async (url: string | URL | Request, options?: RequestInit) => {
    const method = String(url).split('/').at(-1)!; const body = JSON.parse(String(options?.body)); calls.push({ method, body });
    return Response.json({ ok: true, result: method === 'createForumTopic' ? { message_thread_id: ++thread } : { message_id: ++message } });
  }) as typeof fetch);
  while (await bot.outbox()) { /* Create the host's party topic. */ }
  const hostThread = (await pool.query('SELECT thread_id FROM event_bot_topics WHERE event_id=$1 AND user_id=$2', [event.id, host.id])).rows[0].thread_id;
  await request(app).post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', 'test-secret').send({ update_id: 8301,
    message: { from: { id: 8301 }, chat: { id: 8301, type: 'private' }, message_thread_id: Number(hostThread), text: 'Before anyone joined.' } }).expect(200);
  await bot.inbox(); while (await bot.outbox()) { /* Deliver current messages. */ }
  await apply(guest, event.id); await decide(host, event.id, guest.id, 'accept').expect(200);
  while (await bot.outbox()) { /* Create the new member's topic. */ }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM bot_outbox WHERE kind='relay' AND user_id=$1", [guest.id])).rows[0].n, 0);
  assert.ok(!calls.some(call => call.method === 'sendMessage' && String(call.body.chat_id) === '8302' && call.body.text.includes('Before anyone joined.')));
});
integration('Telegram photos relay in party and accepted private topics while captions keep text checks', async () => {
  const host = await person('Host'), guest = await person('Guest');
  const event = await create(host);
  await apply(guest, event.id); await decide(host, event.id, guest.id, 'accept').expect(200);
  await pool.query('INSERT INTO telegram_accounts(user_id,telegram_user_id,bot_started_at) VALUES($1,7101,now()),($2,7102,now())', [host.id, guest.id]);
  await pool.query('INSERT INTO event_bot_topics(event_id,user_id,thread_id) VALUES($1,$2,7201),($1,$3,7202)', [event.id, host.id, guest.id]);
  const pair = [host.id, guest.id].sort();
  const dm = (await pool.query('INSERT INTO dm_conversations(event_id,first_user_id,second_user_id,requested_by) VALUES($1,$2,$3,$4) RETURNING id', [event.id, ...pair, guest.id])).rows[0];
  await pool.query('INSERT INTO dm_bot_topics(conversation_id,user_id,thread_id) VALUES($1,$2,7301),($1,$3,7302)', [dm.id, host.id, guest.id]);
  const calls: { method: string; body: any }[] = []; let messageId = 0;
  const bot = new EventBot(pool, config, (async (url: string | URL | Request, options?: RequestInit) => {
    const method = String(url).split('/').at(-1)!; const body = JSON.parse(String(options?.body)); calls.push({ method, body });
    return Response.json({ ok: true, result: { message_id: ++messageId } });
  }) as typeof fetch);
  const photo = async (updateId: number, threadId: number, caption = '') => request(app).post('/api/telegram/webhook')
    .set('X-Telegram-Bot-Api-Secret-Token', 'test-secret')
    .send({ update_id: updateId, message: { from: { id: 7102, username: 'PRIVATE_HANDLE' }, chat: { id: 7102, type: 'private' },
      message_thread_id: threadId, photo: [{ file_id: 'small-photo' }, { file_id: 'large-photo' }], caption } }).expect(200);

  await photo(9701, 7302, 'Photo before approval'); await bot.inbox();
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM dm_messages WHERE conversation_id=$1', [dm.id])).rows[0].n, 0);
  assert.match((await pool.query("SELECT body FROM bot_outbox WHERE dedupe_key='update:9701:reply'")).rows[0].body, /first private message must be text/i);

  await photo(9702, 7202, 'Look at *vinyl*.'); await bot.inbox();
  const stored = (await pool.query('SELECT body,photo_file_id FROM event_messages WHERE telegram_update_id=9702')).rows[0];
  assert.deepEqual(stored, { body: 'Look at *vinyl*.', photo_file_id: 'large-photo' });
  await photo(9703, 7202, 'I want to have sex with you.'); await bot.inbox();
  assert.equal((await pool.query('SELECT 1 FROM event_messages WHERE telegram_update_id=9703')).rowCount, 0);
  assert.match((await pool.query("SELECT body FROM bot_outbox WHERE dedupe_key='update:9703:reply'")).rows[0].body, /explicit sexual content/);
  await photo(9704, 7202, 'x'.repeat(901)); await bot.inbox();
  assert.equal((await pool.query('SELECT 1 FROM event_messages WHERE telegram_update_id=9704')).rowCount, 0);
  assert.match((await pool.query("SELECT body FROM bot_outbox WHERE dedupe_key='update:9704:reply'")).rows[0].body, /900 characters/);

  await pool.query("UPDATE dm_conversations SET status='accepted' WHERE id=$1", [dm.id]);
  await photo(9705, 7302); await bot.inbox();
  assert.deepEqual((await pool.query('SELECT body,photo_file_id FROM dm_messages WHERE telegram_update_id=9705')).rows[0], { body: '', photo_file_id: 'large-photo' });
  while (await bot.outbox()) { /* Deliver permitted photos and other pending notices. */ }
  const delivered = calls.filter(call => call.method === 'sendPhoto' && String(call.body.chat_id) === '7101');
  assert.equal(delivered.length, 2);
  assert.ok(delivered.some(call => call.body.message_thread_id === 7201 && call.body.photo === 'large-photo' && call.body.caption === '*Guest*:\nLook at \\*vinyl\\*\\.'));
  assert.ok(delivered.some(call => call.body.message_thread_id === 7301 && call.body.photo === 'large-photo' && call.body.caption === '*Guest*:\n'));
  assert.ok(!JSON.stringify(calls).includes('PRIVATE_HANDLE'));
  assert.ok(calls.every(call => call.method !== 'getFile'));
});
integration('starting the bot wakes a queued party topic and keeps the command in the main chat', async () => {
  const host = await person('Host');
  const event = await create(host);
  await pool.query('INSERT INTO telegram_accounts(user_id,telegram_user_id) VALUES($1,2201)', [host.id]);
  await pool.query("UPDATE bot_outbox SET available_at=now()+interval '1 hour' WHERE state='pending' AND user_id<>$1", [host.id]);
  const calls: { method: string; body: any }[] = [];
  const bot = new EventBot(pool, config, (async (url: string | URL | Request, options?: RequestInit) => {
    const method = String(url).split('/').at(-1)!; const body = JSON.parse(String(options?.body)); calls.push({ method, body });
    return Response.json({ ok: true, result: method === 'createForumTopic' ? { message_thread_id: 221 } : { message_id: calls.length } });
  }) as typeof fetch);
  assert.equal(await bot.outbox(), true);
  assert.equal((await pool.query("SELECT state FROM bot_outbox WHERE user_id=$1 AND kind='topic_init'", [host.id])).rows[0].state, 'pending');
  assert.equal(calls.length, 0);
  await request(app).post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', 'test-secret').send({ update_id: 8201, message: { from: { id: 2201 }, chat: { id: 2201, type: 'private' }, text: '/start' } }).expect(200);
  assert.equal(await bot.inbox(), true);
  assert.equal((await pool.query("SELECT in_topic FROM bot_outbox WHERE dedupe_key='update:8201:reply'")).rows[0].in_topic, false);
  while (await bot.outbox()) { /* Deliver both the party intro and the main-chat reply. */ }
  assert.equal(calls.filter(call => call.method === 'createForumTopic').length, 1);
  assert.equal((await pool.query('SELECT thread_id FROM event_bot_topics WHERE event_id=$1 AND user_id=$2', [event.id, host.id])).rows[0].thread_id, '221');
  const startReply = calls.find(call => call.method === 'sendMessage' && call.body.message_thread_id === undefined && call.body.text.includes('party topics are being created automatically'));
  assert.ok(startReply);
  assert.ok(startReply.body.reply_markup.inline_keyboard.flat().some((button: any) => button.web_app?.url === 'https://questr.example'));
  assert.ok(calls.filter(call => call.method === 'sendMessage' && call !== startReply).every(call => !call.body.reply_markup));
});
integration('bot commands select party and private topics; consent gates DM delivery', async () => {
  const host = await person('Host'), guest = await person('Guest'), other = await person('Other');
  const event = await create(host, { capacity: 3 });
  await apply(guest, event.id); await decide(host, event.id, guest.id, 'accept').expect(200);
  await apply(other, event.id); await decide(host, event.id, other.id, 'accept').expect(200);
  for (const [who, telegramId] of [[host,3001],[guest,3002],[other,3003]] as const) await pool.query('INSERT INTO telegram_accounts(user_id,telegram_user_id,bot_started_at) VALUES($1,$2,now())', [who.id,telegramId]);
  const calls: { method: string; body: any }[] = []; let nextThread = 300, nextMessage = 0;
  const fakeFetch = (async (url: string | URL | Request, options?: RequestInit) => {
    const method = String(url).split('/').at(-1)!; const body = JSON.parse(String(options?.body)); calls.push({ method, body });
    return Response.json({ ok: true, result: method === 'createForumTopic' ? { message_thread_id: ++nextThread } : { message_id: ++nextMessage } });
  }) as typeof fetch;
  const bot = new EventBot(pool, config, fakeFetch);
  const send = async (updateId: number, telegramId: number, text: string, thread?: number) => {
    await request(app).post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', 'test-secret')
      .send({ update_id: updateId, message: { from: { id: telegramId }, chat: { id: telegramId, type: 'private' }, text, ...(thread ? { message_thread_id: thread } : {}) } }).expect(200);
    assert.equal(await bot.inbox(), true);
  };
  const press = async (updateId: number, telegramId: number, data: string, messageId: number) => {
    await request(app).post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', 'test-secret')
      .send({ update_id: updateId, callback_query: { id: String(updateId), from: { id: telegramId }, data, message: { message_id: messageId, chat: { id: telegramId, type: 'private' } } } }).expect(200);
    assert.equal(await bot.inbox(), true);
  };
  const drain = async () => { while (await bot.outbox()) { /* dispatch */ } };
  const eventCode = event.id.replaceAll('-', '').slice(0, 8);
  await send(9001, 3002, '/chats');
  const chats = (await pool.query("SELECT body,reply_markup FROM bot_outbox WHERE dedupe_key='update:9001:reply'")).rows[0];
  assert.match(chats.body, /topics are being created automatically/);
  assert.ok(chats.reply_markup.inline_keyboard.flat().every((button: any) => !button.web_app));
  const eventButton = chats.reply_markup.inline_keyboard.flat().find((button: any) => button.callback_data?.startsWith('menu:event:'));
  assert.equal(eventButton.callback_data, `menu:event:${event.id.replaceAll('-', '')}`);
  await drain();
  const chatsMessage = (await pool.query("SELECT telegram_message_id FROM bot_outbox WHERE dedupe_key='update:9001:reply'")).rows[0].telegram_message_id;
  await press(9002, 3002, eventButton.callback_data, Number(chatsMessage));
  const eventMenu = (await pool.query("SELECT reply_markup FROM bot_outbox WHERE dedupe_key='update:9002:reply'")).rows[0].reply_markup;
  assert.ok(eventMenu.inline_keyboard.flat().some((button: any) => button.url?.includes('t.me/questr_game/')));
  const partyPeople = eventMenu.inline_keyboard.flat().find((button: any) => button.callback_data?.startsWith('menu:people:'));
  await drain();
  const eventMessage = (await pool.query("SELECT telegram_message_id FROM bot_outbox WHERE dedupe_key='update:9002:reply'")).rows[0].telegram_message_id;
  await press(9003, 3002, partyPeople.callback_data, Number(eventMessage));
  const memberMenu = (await pool.query("SELECT reply_markup FROM bot_outbox WHERE dedupe_key='update:9003:reply'")).rows[0].reply_markup;
  const hostButton = memberMenu.inline_keyboard.flat().find((button: any) => button.text === 'Host');
  assert.match(hostButton.callback_data, new RegExp(`${host.id.replaceAll('-', '')}$`));
  await drain();
  await send(9016, 3002, '/chats');
  assert.match((await pool.query("SELECT body FROM bot_outbox WHERE dedupe_key='update:9016:reply'")).rows[0].body, /party topics are already created/);
  const peopleMessage = (await pool.query("SELECT telegram_message_id FROM bot_outbox WHERE dedupe_key='update:9003:reply'")).rows[0].telegram_message_id;
  await press(9013, 3002, hostButton.callback_data, Number(peopleMessage)); await drain();
  const dm = (await pool.query('SELECT * FROM dm_conversations WHERE event_id=$1 AND requested_by=$2', [event.id, guest.id])).rows[0];
  assert.equal(dm.status, 'draft');
  const thread = Number((await pool.query('SELECT thread_id FROM dm_bot_topics WHERE conversation_id=$1 AND user_id=$2', [dm.id, guest.id])).rows[0].thread_id);
  await send(9004, 3002, 'I can bring my jazz records.', thread);
  assert.equal((await pool.query('SELECT status FROM dm_conversations WHERE id=$1', [dm.id])).rows[0].status, 'pending');
  assert.match((await pool.query("SELECT body FROM bot_outbox WHERE dedupe_key='update:9004:reply'")).rows[0].body, /waiting for a reply/);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM capability_usage WHERE user_id=$1 AND capability='dm.send_opener'", [guest.id])).rows[0].n, 1);
  await drain();
  const requestCall = calls.find(c => c.method === 'sendMessage' && String(c.body.chat_id) === '3001' && c.body.text.includes('jazz records'));
  assert.ok(requestCall);
  assert.equal(requestCall?.body.reply_markup.inline_keyboard[0][0].callback_data, `dm:accept:${dm.id.replaceAll('-', '')}`);
  assert.equal(requestCall?.body.reply_markup.inline_keyboard.length, 1);
  assert.ok(!calls.some(c => String(c.body.chat_id) === '3003' && c.body.text?.includes('jazz records')));
  await send(9005, 3002, 'Another message before consent.', thread);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM dm_messages WHERE conversation_id=$1', [dm.id])).rows[0].n, 1);
  const requestMessage = (await pool.query("SELECT telegram_message_id FROM bot_outbox WHERE kind='dm_request' AND dm_id=$1", [dm.id])).rows[0].telegram_message_id;
  await press(9015, 3001, requestCall.body.reply_markup.inline_keyboard[0][0].callback_data, Number(requestMessage) + 999);
  assert.equal((await pool.query('SELECT status FROM dm_conversations WHERE id=$1', [dm.id])).rows[0].status, 'pending');
  await press(9006, 3001, requestCall.body.reply_markup.inline_keyboard[0][0].callback_data, Number(requestMessage)); await drain();
  assert.equal((await pool.query('SELECT status FROM dm_conversations WHERE id=$1', [dm.id])).rows[0].status, 'accepted');
  assert.ok(calls.some(c => c.method === 'sendMessage' && String(c.body.chat_id) === '3001' && c.body.parse_mode === 'MarkdownV2' && c.body.text === '*Guest*:\nI can bring my jazz records\\.'));
  await send(9008, 3002, '/people');
  const allPeople = (await pool.query("SELECT reply_markup FROM bot_outbox WHERE dedupe_key='update:9008:reply'")).rows[0].reply_markup;
  const otherButton = allPeople.inline_keyboard.flat().find((button: any) => button.text.startsWith('Other ·'));
  assert.equal(otherButton.callback_data, `menu:person:${other.id.replaceAll('-', '')}`);
  await drain();
  const allPeopleMessage = (await pool.query("SELECT telegram_message_id FROM bot_outbox WHERE dedupe_key='update:9008:reply'")).rows[0].telegram_message_id;
  await press(9014, 3002, otherButton.callback_data, Number(allPeopleMessage)); await drain();
  const second = (await pool.query('SELECT id,status FROM dm_conversations WHERE event_id=$1 AND requested_by=$2 AND id<>$3', [event.id, guest.id, dm.id])).rows[0];
  const secondThread = Number((await pool.query('SELECT thread_id FROM dm_bot_topics WHERE conversation_id=$1 AND user_id=$2', [second.id, guest.id])).rows[0].thread_id);
  await send(9009, 3002, 'I want to have sex with you.', secondThread);
  assert.equal((await pool.query('SELECT status FROM dm_conversations WHERE id=$1', [second.id])).rows[0].status, 'draft');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM dm_messages WHERE conversation_id=$1', [second.id])).rows[0].n, 0);
  await send(9010, 3002, 'Would you like to bring a record?', secondThread);
  await drain();
  const secondRequest = (await pool.query("SELECT telegram_message_id FROM bot_outbox WHERE kind='dm_request' AND dm_id=$1", [second.id])).rows[0].telegram_message_id;
  await press(9011, 3003, `dm:decline:${second.id.replaceAll('-', '')}`, Number(secondRequest));
  assert.equal((await pool.query('SELECT status FROM dm_conversations WHERE id=$1', [second.id])).rows[0].status, 'declined');
  await drain();
  assert.ok(!calls.some(c => String(c.body.chat_id) === '3003' && c.body.parse_mode === 'MarkdownV2' && c.body.text?.includes('Would you like to bring a record?')));
  await send(9007, 3002, 'See you tomorrow.', thread);
  await guest.agent.post(`/api/events/${event.id}/leave`).send({}).expect(200);
  await drain();
  assert.equal((await pool.query("SELECT state FROM bot_outbox WHERE kind='dm_relay' AND dm_message_id=(SELECT id FROM dm_messages WHERE telegram_update_id=9007)")).rows[0].state, 'sent');
  assert.equal(await can(pool, guest.id, 'dm.message', { type: 'profile', id: host.id }), true);
  await send(9012, 3001, `/block ${dm.id.replaceAll('-', '').slice(0, 8)}`);
  assert.equal((await pool.query('SELECT status FROM dm_conversations WHERE id=$1', [dm.id])).rows[0].status, 'blocked');
  assert.equal(await can(pool, guest.id, 'dm.message', { type: 'profile', id: host.id }), false);
});
integration('/people shows each person once with the latest shared adventure', async () => {
  const host = await person('Host'), guest = await person('Guest');
  const first = await create(host, { title: 'First record hunt' });
  const later = Date.now() + 2 * 86400000;
  const second = await create(host, { title: 'Next record hunt', startsAt: new Date(later).toISOString(), endsAt: new Date(later + 7200000).toISOString() });
  for (const event of [first, second]) { await apply(guest, event.id); await decide(host, event.id, guest.id, 'accept').expect(200); }
  await pool.query('INSERT INTO telegram_accounts(user_id,telegram_user_id,bot_started_at) VALUES($1,6101,now()),($2,6102,now())', [host.id, guest.id]);
  await request(app).post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', 'test-secret')
    .send({ update_id: 9601, message: { from: { id: 6102 }, chat: { id: 6102, type: 'private' }, text: '/people' } }).expect(200);
  const bot = new EventBot(pool, config);
  assert.equal(await bot.inbox(), true);
  const menu = (await pool.query("SELECT body,reply_markup FROM bot_outbox WHERE dedupe_key='update:9601:reply'")).rows[0];
  assert.match(menu.body, /shared adventure/);
  const buttons = menu.reply_markup.inline_keyboard.flat().filter((button: any) => button.callback_data?.startsWith('menu:person:'));
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].callback_data, `menu:person:${host.id.replaceAll('-', '')}`);
  assert.match(buttons[0].text, /Host · Next record hunt/);
  await request(app).post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', 'test-secret')
    .send({ update_id: 9602, message: { from: { id: 6102 }, chat: { id: 6102, type: 'private' }, text: `/start contact_${second.id.replaceAll('-', '').slice(0, 16)}_${host.id.replaceAll('-', '')}` } }).expect(200);
  assert.equal(await bot.inbox(), true);
  const contact = (await pool.query('SELECT id,purpose,status FROM dm_conversations WHERE event_id=$1 AND requested_by=$2', [second.id, guest.id])).rows[0];
  assert.equal(contact.purpose, 'contact');
  await pool.query('INSERT INTO dm_bot_topics(conversation_id,user_id,thread_id) VALUES($1,$2,700)', [contact.id, guest.id]);
  await request(app).post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', 'test-secret')
    .send({ update_id: 9603, message: { from: { id: 6102 }, chat: { id: 6102, type: 'private' }, message_thread_id: 700, text: 'Could we exchange Telegram contacts?' } }).expect(200);
  assert.equal(await bot.inbox(), true);
  assert.match((await pool.query("SELECT body FROM bot_outbox WHERE kind='dm_request' AND dm_id=$1", [contact.id])).rows[0].body, /Telegram contact/);
  assert.match((await pool.query("SELECT body FROM bot_outbox WHERE dedupe_key='update:9603:reply'")).rows[0].body, /waiting for a reply/);
});
integration('two shared adventures reuse one private topic, consent and block', async () => {
  const host = await person('Host'), guest = await person('Guest');
  const first = await create(host, { title: 'First quest' });
  const next = Date.now() + 2 * 86400000;
  const second = await create(host, { title: 'Second quest', startsAt: new Date(next).toISOString(), endsAt: new Date(next + 7200000).toISOString() });
  for (const event of [first, second]) { await apply(guest, event.id); await decide(host, event.id, guest.id, 'accept').expect(200); }
  await pool.query('INSERT INTO telegram_accounts(user_id,telegram_user_id,bot_started_at) VALUES($1,8101,now()),($2,8102,now())', [host.id, guest.id]);
  let nextThread = 800;
  const bot = new EventBot(pool, config, (async (url: string | URL | Request) => Response.json({ ok: true,
    result: String(url).endsWith('/createForumTopic') ? { message_thread_id: ++nextThread } : { message_id: ++nextThread } })) as typeof fetch);
  const send = async (updateId: number, telegramId: number, text: string, threadId?: number) => {
    await request(app).post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', 'test-secret')
      .send({ update_id: updateId, message: { from: { id: telegramId }, chat: { id: telegramId, type: 'private' }, text,
        ...(threadId ? { message_thread_id: threadId } : {}) } }).expect(200);
    assert.equal(await bot.inbox(), true);
  };
  const drain = async () => { while (await bot.outbox()) { /* dispatch */ } };
  await drain();
  await send(9801, 8102, `/dm ${first.id.replaceAll('-', '')} ${host.id.replaceAll('-', '')}`); await drain();
  const conversation = (await pool.query('SELECT * FROM dm_conversations WHERE first_user_id=LEAST($1::uuid,$2::uuid) AND second_user_id=GREATEST($1::uuid,$2::uuid)', [host.id, guest.id])).rows[0];
  const originalTopic = (await pool.query('SELECT thread_id FROM dm_bot_topics WHERE conversation_id=$1 AND user_id=$2', [conversation.id, guest.id])).rows[0].thread_id;
  await send(9802, 8102, `/dm ${second.id.replaceAll('-', '')} ${host.id.replaceAll('-', '')}`); await drain();
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM dm_conversations WHERE first_user_id=LEAST($1::uuid,$2::uuid) AND second_user_id=GREATEST($1::uuid,$2::uuid)', [host.id, guest.id])).rows[0].n, 1);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM dm_bot_topics WHERE conversation_id=$1 AND user_id=$2', [conversation.id, guest.id])).rows[0].n, 1);
  assert.equal((await pool.query('SELECT thread_id FROM dm_bot_topics WHERE conversation_id=$1 AND user_id=$2', [conversation.id, guest.id])).rows[0].thread_id, originalTopic);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM dm_conversation_events WHERE conversation_id=$1', [conversation.id])).rows[0].n, 2);
  await send(9803, 8102, 'Would you like to compare records?', Number(originalTopic)); await drain();
  assert.equal((await pool.query('SELECT status FROM dm_conversations WHERE id=$1', [conversation.id])).rows[0].status, 'pending');
  assert.equal((await guest.agent.get(`/api/events/${second.id}/profiles/${host.id}`).expect(200)).body.connection.status, 'pending');
  await send(9804, 8101, `/accept ${conversation.id.replaceAll('-', '')}`); await drain();
  assert.equal((await guest.agent.get(`/api/events/${second.id}/profiles/${host.id}`).expect(200)).body.connection.status, 'accepted');
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM capability_usage WHERE user_id=$1 AND capability='dm.send_opener'", [guest.id])).rows[0].n, 1);
  await guest.agent.post(`/api/events/${first.id}/leave`).send({}).expect(200);
  await send(9805, 8102, 'See you at the second quest.', Number(originalTopic)); await drain();
  assert.equal((await pool.query("SELECT state FROM bot_outbox WHERE kind='dm_relay' AND dm_message_id=(SELECT id FROM dm_messages WHERE telegram_update_id=9805)")).rows[0].state, 'sent');
  await guest.agent.post(`/api/events/${second.id}/leave`).send({}).expect(200);
  await send(9806, 8102, '/people'); await drain();
  const peopleMenu = (await pool.query("SELECT reply_markup,telegram_message_id FROM bot_outbox WHERE dedupe_key='update:9806:reply'")).rows[0];
  const oldFriend = peopleMenu.reply_markup.inline_keyboard.flat().find((button: any) => button.callback_data === `menu:person:${host.id.replaceAll('-', '')}`);
  assert.equal(oldFriend.text, 'Host');
  await request(app).post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', 'test-secret')
    .send({ update_id: 9807, callback_query: { id: '9807', from: { id: 8102 }, data: oldFriend.callback_data,
      message: { message_id: Number(peopleMenu.telegram_message_id), chat: { id: 8102, type: 'private' } } } }).expect(200);
  assert.equal(await bot.inbox(), true);
  assert.match((await pool.query("SELECT body FROM bot_outbox WHERE dedupe_key='update:9807:reply'")).rows[0].body, new RegExp(`/${originalTopic}$`));
  await send(9808, 8102, 'The chat survived both quests.', Number(originalTopic)); await drain();
  assert.equal((await pool.query("SELECT state FROM bot_outbox WHERE kind='dm_relay' AND dm_message_id=(SELECT id FROM dm_messages WHERE telegram_update_id=9808)")).rows[0].state, 'sent');
  await send(9809, 8101, `/block ${conversation.id.replaceAll('-', '')}`);
  assert.equal(await can(pool, guest.id, 'dm.message', { type: 'profile', id: host.id }), false);
  await send(9810, 8102, 'This should stay private.', Number(originalTopic)); await drain();
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM dm_messages WHERE telegram_update_id=9810')).rows[0].n, 0);
  await apply(guest, second.id); await decide(host, second.id, guest.id, 'accept').expect(200);
  assert.equal((await guest.agent.get(`/api/events/${second.id}/profiles/${host.id}`).expect(200)).body.connection.status, 'closed');
  await send(9811, 8102, `/dm ${second.id.replaceAll('-', '')} ${host.id.replaceAll('-', '')}`);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM dm_bot_topics WHERE conversation_id=$1', [conversation.id])).rows[0].n, 2);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM dm_conversations WHERE first_user_id=LEAST($1::uuid,$2::uuid) AND second_user_id=GREATEST($1::uuid,$2::uuid)', [host.id, guest.id])).rows[0].n, 1);
});
integration('character page starts consent-based private chat and Telegram contact requests', async () => {
  const host = await person('Host'), guest = await person('Guest'), other = await person('Other'), outsider = await person('Outsider');
  const event = await create(host, { capacity: 3 });
  await apply(guest, event.id); await decide(host, event.id, guest.id, 'accept').expect(200);
  await apply(other, event.id); await decide(host, event.id, other.id, 'accept').expect(200);
  const path = `/api/events/${event.id}/profiles/${host.id}`;
  const first = (await guest.agent.get(path).expect(200)).body;
  assert.match(first.profile.introMarkdown, /coffee/);
  assert.equal(first.connection.status, 'unavailable');
  await pool.query('INSERT INTO telegram_accounts(user_id,telegram_user_id,bot_started_at) VALUES($1,5101,now()),($2,5102,now()),($3,5103,now())', [host.id, guest.id, other.id]);
  assert.equal((await guest.agent.get(path).expect(200)).body.connection.status, 'available');
  assert.equal((await outsider.agent.get(path).expect(200)).body.connection.status, 'unavailable');
  await outsider.agent.get(`/api/events/${event.id}/profiles/${guest.id}`).expect(404);
  await outsider.agent.post(`/api/events/${event.id}/profiles/${guest.id}/connection`).send({ purpose: 'chat', message: 'Hello from outside.' }).expect(403);
  await guest.agent.post(path + '/connection').send({ purpose: 'chat', message: 'I want to have sex with you.' }).expect(422);
  await guest.agent.post(path + '/connection').send({ purpose: 'chat', message: 'See meet.example/secret' }).expect(400);
  const opener = 'Would you like to compare our favourite records?';
  assert.equal((await guest.agent.post(path + '/connection').send({ purpose: 'chat', message: opener }).expect(200)).body.connection.status, 'pending');
  await guest.agent.post(path + '/connection').send({ purpose: 'chat', message: opener }).expect(200);
  const dm = (await pool.query('SELECT * FROM dm_conversations WHERE event_id=$1 AND requested_by=$2', [event.id, guest.id])).rows[0];
  assert.equal(dm.purpose, 'chat'); assert.equal(dm.status, 'pending');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM dm_messages WHERE conversation_id=$1', [dm.id])).rows[0].n, 1);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM capability_usage WHERE user_id=$1 AND capability='dm.send_opener'", [guest.id])).rows[0].n, 1);
  assert.match((await pool.query("SELECT body FROM bot_outbox WHERE kind='dm_request' AND dm_id=$1", [dm.id])).rows[0].body, /favourite records/);
  const contactPath = `/api/events/${event.id}/profiles/${other.id}/connection`;
  await guest.agent.post(contactPath).send({ purpose: 'contact', message: 'May I have your Telegram contact?' }).expect(200);
  const contact = (await pool.query('SELECT * FROM dm_conversations WHERE event_id=$1 AND requested_by=$2 AND id<>$3', [event.id, guest.id, dm.id])).rows[0];
  assert.equal(contact.purpose, 'contact');
  assert.match((await pool.query("SELECT body FROM bot_outbox WHERE kind='dm_request' AND dm_id=$1", [contact.id])).rows[0].body, /Telegram contact/);
  let nextThread = 80;
  const bot = new EventBot(pool, config, (async (url: string | URL | Request) => Response.json({ ok: true, result: String(url).endsWith('/createForumTopic') ? { message_thread_id: ++nextThread } : { message_id: 1 } })) as typeof fetch);
  await request(app).post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', 'test-secret').send({ update_id: 9501, message: { from: { id: 5103 }, chat: { id: 5103, type: 'private' }, text: `/accept ${contact.id.replaceAll('-', '').slice(0, 8)}` } }).expect(200);
  assert.equal(await bot.inbox(), true);
  assert.equal((await pool.query('SELECT status FROM dm_conversations WHERE id=$1', [contact.id])).rows[0].status, 'accepted');
  assert.match((await pool.query("SELECT body FROM bot_outbox WHERE kind='dm_accept' AND user_id=$1 AND dm_id=$2", [other.id, contact.id])).rows[0].body, /does not reveal it automatically/);
  assert.equal((await guest.agent.get(`/api/events/${event.id}/profiles/${other.id}`).expect(200)).body.connection.status, 'accepted');
  while (await bot.outbox()) { /* Create the accepted private topics before following the deep link. */ }
  await request(app).post('/api/telegram/webhook').set('X-Telegram-Bot-Api-Secret-Token', 'test-secret').send({ update_id: 9502, message: { from: { id: 5102 }, chat: { id: 5102, type: 'private' }, text: `/start dm_${event.id.replaceAll('-', '').slice(0, 8)}_${other.id.replaceAll('-', '').slice(0, 8)}` } }).expect(200);
  assert.equal(await bot.inbox(), true);
  const deepLinkReply = (await pool.query("SELECT body,in_topic FROM bot_outbox WHERE dedupe_key='update:9502:reply'")).rows[0];
  assert.equal(deepLinkReply.in_topic, false); assert.match(deepLinkReply.body, /Private topic with Other: https:\/\/t.me\/questr_game\//);
});
integration('blocked accounts cannot chat or expose their character, while hosts can release their occupied seat', async () => {
  const host = await person(), guest = await person(); const event = await create(host);
  await apply(guest, event.id); await decide(host, event.id, guest.id, 'accept').expect(200);
  await pool.query("UPDATE users SET status='blocked' WHERE id=$1", [guest.id]);
  const detail = (await host.agent.get(`/api/events/${event.id}`)).body.event;
  assert.equal(detail.participantCount, 2); assert.equal(detail.participants.find((p: any) => p.id === guest.id).unavailable, true);
  assert.equal(await can(pool, guest.id, 'events.group_chat', { type: 'event', id: event.id }), false);
  await host.agent.get(`/api/events/${event.id}/profiles/${guest.id}`).expect(404);
  await decide(host, event.id, guest.id, 'remove').expect(200);
  assert.equal((await host.agent.get(`/api/events/${event.id}`)).body.event.participantCount, 1);
});
integration('Telegram explicit throttling is retried; ambiguous sends stop rather than silently duplicating', async () => {
  await pool.query("UPDATE bot_outbox SET state='discarded' WHERE state='pending'");
  const guest = await person();
  await pool.query('INSERT INTO telegram_accounts(user_id,telegram_user_id,bot_started_at) VALUES($1,2001,now())', [guest.id]);
  const row = (await pool.query("INSERT INTO bot_outbox(dedupe_key,user_id,kind,body) VALUES('retry-test',$1,'reply','A reply') RETURNING id", [guest.id])).rows[0];
  let count = 0;
  const fake = (async () => ++count === 1 ? Response.json({ ok: false, error_code: 429, parameters: { retry_after: 5 } }, { status: 429 }) : Response.json({ ok: true, result: { message_id: 999 } })) as typeof fetch;
  const bot = new EventBot(pool, config, fake);
  await bot.outbox(); assert.equal((await pool.query('SELECT state FROM bot_outbox WHERE id=$1', [row.id])).rows[0].state, 'pending');
  assert.equal(await bot.outbox(), false);
  await pool.query('UPDATE bot_outbox SET available_at=now() WHERE id=$1', [row.id]); await bot.outbox();
  assert.equal((await pool.query('SELECT state FROM bot_outbox WHERE id=$1', [row.id])).rows[0].state, 'sent');
  assert.equal(count, 2);
  const ambiguous = (await pool.query("INSERT INTO bot_outbox(dedupe_key,user_id,kind,body) VALUES('ambiguous-test',$1,'reply','A reply') RETURNING id", [guest.id])).rows[0];
  const failedBot = new EventBot(pool, config, (async () => { throw new Error('Connection reset after send'); }) as typeof fetch);
  await failedBot.outbox(); assert.equal((await pool.query('SELECT state FROM bot_outbox WHERE id=$1', [ambiguous.id])).rows[0].state, 'failed');
  assert.equal(await failedBot.outbox(), false);
});
integration('organizers can maintain their event after losing creation rights, but cannot move it outside their scope', async () => {
  const host = await person(); const event = await create(host);
  await pool.query("UPDATE role_assignments SET revoked_at=now() WHERE user_id=$1 AND role_code='event_creator'", [host.id]);
  const { requestId: _, ...input } = fields({ title: 'Updated title with retained host rights', revision: 0 });
  await host.agent.put(`/api/events/${event.id}`).send(input).expect(200);
  await host.agent.put(`/api/events/${event.id}`).send({ ...input, revision: 1, locationId: 'online', meetingDetails: 'https://meet.example/new' }).expect(403);
});
