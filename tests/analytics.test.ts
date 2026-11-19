import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CaptureResult } from 'posthog-js/dist/module.slim.no-external';
import { filterAnalyticsEvent } from '../src/analytics.ts';
import { loadConfig } from '../server/config.ts';

test('product analytics is opt-in for both Telegram and demo deployments', () => {
  const names = ['AUTH_MODE', 'AI_MODE', 'TELEGRAM_BOT_TOKEN', 'APP_ORIGIN', 'COOKIE_SECURE', 'POSTHOG_PROJECT_KEY'] as const;
  const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
  try {
    process.env.AUTH_MODE = 'telegram';
    process.env.AI_MODE = 'demo';
    process.env.TELEGRAM_BOT_TOKEN = 'test-token';
    process.env.APP_ORIGIN = 'http://localhost:5173';
    process.env.COOKIE_SECURE = 'false';
    delete process.env.POSTHOG_PROJECT_KEY;
    assert.equal(loadConfig().posthogProjectKey, '');
    process.env.AUTH_MODE = 'demo';
    assert.equal(loadConfig().posthogProjectKey, '');
    process.env.POSTHOG_PROJECT_KEY = 'phc_test_only';
    assert.equal(loadConfig().posthogProjectKey, 'phc_test_only');
  } finally {
    for (const name of names) {
      const value = previous[name];
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test('product events retain only approved aggregate properties and SDK identifiers', () => {
  const event: CaptureResult = {
    uuid: 'event-1', event: 'adventure_application_sent',
    properties: {
      token: 'public-project-key', distinct_id: 'user-uuid', with_note: true,
      message: 'Private application text', introMarkdown: 'Private bio',
      '$current_url': 'https://questr.example/?initData=secret#adventures/private-event',
      '$referrer': 'https://example.com/private', '$title': 'Private title',
    },
    $set: { email: 'someone@example.com' }, $set_once: { '$initial_referrer': 'https://example.com/private' },
  };
  assert.deepEqual(filterAnalyticsEvent(event), {
    ...event,
    properties: { token: 'public-project-key', distinct_id: 'user-uuid', with_note: true },
    $set: undefined, $set_once: undefined,
  });
});

test('unexpected automatic events are discarded, including pageviews and clicks', () => {
  for (const name of ['$pageview', '$autocapture', '$exception']) {
    assert.equal(filterAnalyticsEvent({ uuid: 'event-2', event: name, properties: { '$current_url': 'private' } }), null);
  }
});

test('identify keeps only the IDs needed to link a registered account', () => {
  const event: CaptureResult = {
    uuid: 'event-3', event: '$identify',
    properties: { token: 'public-project-key', distinct_id: 'user-uuid', '$anon_distinct_id': 'anonymous-uuid', email: 'someone@example.com', '$current_url': 'private' },
  };
  assert.deepEqual(filterAnalyticsEvent(event)?.properties, { token: 'public-project-key', distinct_id: 'user-uuid', '$anon_distinct_id': 'anonymous-uuid' });
});

test('non-scalar values cannot enter the approved fields', () => {
  const event: CaptureResult = {
    uuid: 'event-4', event: 'screen_viewed',
    properties: { screen: { hidden: 'private' }, '$session_id': 'session-uuid' },
  };
  assert.deepEqual(filterAnalyticsEvent(event)?.properties, { '$session_id': 'session-uuid' });
});

test('date analytics never includes photos, messages or meeting details', () => {
  const event: CaptureResult = { uuid: 'date-1', event: 'date_matched', properties: {
    distinct_id: 'user-uuid', photo: 'private-object-key', message: 'Private first message', place: 'Private meeting point', dateId: 'date-uuid',
  } };
  assert.deepEqual(filterAnalyticsEvent(event)?.properties, { distinct_id: 'user-uuid' });
});
