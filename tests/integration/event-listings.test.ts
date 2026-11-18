import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import request from 'supertest';
import { createPool, type Pool } from '../../server/db.ts';
import { migrate } from '../../server/migrate.ts';
import { createApp } from '../../server/app.ts';
import { loadConfig } from '../../server/config.ts';

const connection = process.env.TEST_DATABASE_URL;
const database = `questr_listings_${randomUUID().replaceAll('-', '')}`;
const config = { ...loadConfig(), authMode: 'demo' as const, aiMode: 'demo' as const };
let admin: Pool, pool: Pool;
before(async () => {
  if (!connection) return;
  admin = createPool(connection);
  await admin.query(`CREATE DATABASE "${database}"`);
  const url = new URL(connection); url.pathname = `/${database}`;
  pool = createPool(url.toString());
  await migrate(pool, fileURLToPath(new URL('../fixtures/locations.json', import.meta.url)), fileURLToPath(new URL('../fixtures/communities.json', import.meta.url)));
});
after(async () => { if (!connection) return; await pool?.end(); await admin.query(`DROP DATABASE IF EXISTS "${database}"`); await admin.end(); });
const integration = (name: string, fn: () => Promise<void>) => test(name, { skip: !connection }, fn);
async function person(name: string) {
  const agent = request.agent(createApp(pool, config));
  await agent.post('/api/auth/demo').send({}).expect(200);
  const state = (await agent.get('/api/me').expect(200)).body;
  const registration = (await agent.post('/api/register').send({ displayName: name, invite: state.demoInvite, adult: true, terms: true, locale: 'en' }).expect(200)).body;
  const draft = (await agent.put('/api/draft').send({ ...registration.draft, avatarId: 'moss', introMarkdown: 'I like music and coffee.', spokenLanguages: ['en'] }).expect(200)).body.draft;
  await agent.put('/api/discovery').send({ revision: 0, locationIds: ['country:IL'], languageCodes: ['en'] }).expect(200);
  await agent.post('/api/profile/publish').send({ revision: draft.revision }).expect(200);
  return { agent, id: state.user.id as string };
}

integration('admin-curated listings are public, versioned and separate from private adventure meeting points', async () => {
  const curator = await person('Curator');
  const host = await person('Host');
  const viewer = await person('Viewer');
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Listing test')", [curator.id]);
  const place = (await curator.agent.post('/api/places/admin').send({ cityLocationId: 'city:294801', name: 'Records Cafe', address: '12 Music Street', active: true }).expect(201)).body.place;
  const start = Date.now() + 86400000;
  const fields = { title: 'Live records night', descriptionMarkdown: 'Live music and good coffee at the cafe.',
    startsAt: new Date(start).toISOString(), endsAt: new Date(start + 7200000).toISOString(), timeZone: 'Asia/Jerusalem',
    cityLocationId: null, placeId: place.id, mapsUrl: null, venueName: null, sourceUrl: 'https://example.com/records-night',
    organizerName: 'Records Cafe', communityId: 'ariel_students', status: 'draft' };
  await host.agent.get('/api/event-listings/admin').expect(403);
  await host.agent.post('/api/event-listings/admin').send(fields).expect(403);
  const draft = (await curator.agent.post('/api/event-listings/admin').send(fields).expect(201)).body.listing;
  assert.equal(draft.city.id, 'city:294801');
  assert.equal(draft.status, 'draft');
  assert.deepEqual((await viewer.agent.get('/api/event-listings').expect(200)).body.listings, []);
  await viewer.agent.get(`/api/event-listings/${draft.id}`).expect(404);
  await curator.agent.get(`/api/event-listings/${draft.id}`).expect(200);
  await curator.agent.put(`/api/event-listings/admin/${draft.id}`).send({ ...fields, status: 'published', revision: 99 }).expect(409);
  const published = (await curator.agent.put(`/api/event-listings/admin/${draft.id}`).send({ ...fields, status: 'published', revision: draft.revision }).expect(200)).body.listing;
  assert.equal(published.revision, 1);
  assert.deepEqual((await viewer.agent.get('/api/event-listings').query({ cityId: 'city:294801', communityId: 'ariel_students' }).expect(200)).body.listings.map((item: any) => item.id), [draft.id]);
  assert.deepEqual((await viewer.agent.get('/api/event-listings').query({ cityId: 'city:293397' }).expect(200)).body.listings, []);
  assert.deepEqual((await viewer.agent.get('/api/event-listings').query({ from: '2100-01-01' }).expect(200)).body.listings, []);
  assert.equal((await pool.query('SELECT count(*)::int AS total FROM event_listing_versions WHERE listing_id=$1', [draft.id])).rows[0].total, 2);
  const adventureFields = { title: 'A party for live records', activitySummary: '', descriptionMarkdown: 'Let us hear live records and meet for coffee.',
    costEstimate: 'Free', experienceNotes: 'Anyone welcome', onlinePlatform: '', locationId: 'city:294801', placeId: null,
    languageCode: 'en', communityId: null, startsAt: fields.startsAt, endsAt: fields.endsAt, timeZone: fields.timeZone,
    capacity: 6, meetingDetails: 'Private apartment, door 42', meetingMapUrl: '', eventListingId: draft.id, requestId: randomUUID() };
  const adventure = (await host.agent.post('/api/events').send(adventureFields).expect(201)).body.event;
  assert.equal(adventure.eventListingId, draft.id);
  const detail = (await viewer.agent.get(`/api/event-listings/${draft.id}`).expect(200)).body.listing;
  assert.deepEqual(detail.adventures.map((event: any) => event.id), [adventure.id]);
  assert.ok(!JSON.stringify(detail).includes('Private apartment'));
  assert.equal((await viewer.agent.get(`/api/events/${adventure.id}`).expect(200)).body.event.meetingDetails, null);
  await host.agent.post('/api/events').send({ ...adventureFields, requestId: randomUUID(), locationId: 'city:293397' }).expect(400);
  await curator.agent.put(`/api/event-listings/admin/${draft.id}`).send({ ...fields, status: 'draft', revision: published.revision }).expect(400);
  await curator.agent.put(`/api/places/admin/${place.id}`).send({ cityLocationId: place.cityLocationId, name: place.name, address: place.address, active: false, revision: place.revision }).expect(200);
  const cancelled = (await curator.agent.put(`/api/event-listings/admin/${draft.id}`).send({ ...fields, status: 'cancelled', revision: published.revision }).expect(200)).body.listing;
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual((await viewer.agent.get('/api/event-listings').expect(200)).body.listings, []);
  assert.equal((await viewer.agent.get(`/api/event-listings/${draft.id}`).expect(200)).body.listing.status, 'cancelled');
  await host.agent.post('/api/events').send({ ...adventureFields, requestId: randomUUID() }).expect(400);
});

integration('listing venue and source URLs require a single safe public venue', async () => {
  const curator = await person('Second curator');
  await pool.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Listing test')", [curator.id]);
  const startsAt = new Date(Date.now() + 86400000).toISOString();
  const endsAt = new Date(Date.now() + 90000000).toISOString();
  const fields = { title: 'City concert', descriptionMarkdown: 'An evening of music in the city.', startsAt, endsAt, timeZone: 'Asia/Jerusalem',
    cityLocationId: 'city:294801', placeId: null, mapsUrl: 'https://www.google.com/maps/search/?api=1&query=music', venueName: 'Concert hall',
    sourceUrl: 'https://example.com/concert', organizerName: 'Concert team', communityId: null, status: 'published' };
  const listing = (await curator.agent.post('/api/event-listings/admin').send(fields).expect(201)).body.listing;
  assert.equal(listing.mapsUrl, fields.mapsUrl);
  assert.equal(listing.venueName, 'Concert hall');
  await curator.agent.post('/api/event-listings/admin').send({ ...fields, mapsUrl: 'https://evil.example/maps/music' }).expect(400);
  await curator.agent.post('/api/event-listings/admin').send({ ...fields, sourceUrl: 'http://example.com/concert' }).expect(400);
  await curator.agent.post('/api/event-listings/admin').send({ ...fields, mapsUrl: null }).expect(400);
  await curator.agent.post('/api/event-listings/admin').send({ ...fields, venueName: null }).expect(400);
});
