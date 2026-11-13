import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wallTimeToInstant, wallTime, createEventSchema } from '../shared/events.ts';
import { zoomLink, googleMapsSearch } from '../shared/event-links.ts';
test('adventure local times convert across zones and reject missing/repeated DST times', () => {
  assert.equal(wallTimeToInstant('2030-01-15T19:30', 'Asia/Jerusalem'), '2030-01-15T17:30:00.000Z');
  assert.equal(wallTimeToInstant('2030-07-15T19:30', 'Asia/Jerusalem'), '2030-07-15T16:30:00.000Z');
  assert.equal(wallTimeToInstant('2030-01-15T19:30', 'Asia/Kathmandu'), '2030-01-15T13:45:00.000Z');
  assert.equal(wallTime('2030-01-15T13:45:00Z', 'Asia/Kathmandu'), '2030-01-15T19:30');
  assert.throws(() => wallTimeToInstant('2030-03-10T02:30', 'America/New_York'), /EVENT_TIME_INVALID/);
  assert.throws(() => wallTimeToInstant('2030-11-03T01:30', 'America/New_York'), /EVENT_TIME_AMBIGUOUS/);
  assert.throws(() => wallTimeToInstant('2030-02-30T12:00', 'UTC'), /EVENT_TIME_INVALID/);
});
test('call links are recognized only on Zoom hosts; Google Maps links encode the place', () => {
  assert.equal(zoomLink('Join [here](https://us02web.zoom.us/j/123456789?pwd=abc).'), 'https://us02web.zoom.us/j/123456789?pwd=abc');
  assert.equal(zoomLink('https://zoom.us.evil.example/j/123456789'), null);
  assert.equal(zoomLink('https://zoom.us.evil.example/j/1 and https://zoom.us/j/98765'), 'https://zoom.us/j/98765');
  const link = new URL(googleMapsSearch('Coffee & climbing', 'place-id'));
  assert.equal(link.searchParams.get('query'), 'Coffee & climbing');
  assert.equal(link.searchParams.get('query_place_id'), 'place-id');
});
test('event inputs reject unknown authority fields and invalid sizes/zones', () => {
  const data = { title: 'Coffee crawl', descriptionMarkdown: 'A walk with coffee stops.', startsAt: '2030-01-15T17:30:00Z', endsAt: '2030-01-15T19:30:00Z', timeZone: 'Asia/Jerusalem', locationId: 'city:294801', languageCode: 'en', capacity: 6, meetingDetails: 'Private cafe entrance', requestId: crypto.randomUUID() };
  assert.ok(createEventSchema.safeParse(data).success);
  for (const change of [{ capacity: 1 }, { capacity: 51 }, { timeZone: 'Moon/Crater' }, { createdBy: crypto.randomUUID() }, { languageCode: 'xx' }]) assert.equal(createEventSchema.safeParse({ ...data, ...change }).success, false);
});
