import type { CaptureResult, PostHog } from 'posthog-js/dist/module.slim.no-external';

// Keep this list narrow. Profile text, interview answers, messages, email and place
// details must never become event properties, even if a future caller passes them.
const eventProperties = {
  screen_viewed: ['screen'],
  adventure_list_viewed: ['view'],
  registration_completed: [],
  profile_published: ['first_publish', 'has_intro', 'tag_count', 'ask_me_count', 'language_count'],
  interview_started: ['has_existing_bio'],
  interview_answered: [],
  interview_topic_changed: [],
  interview_draft_created: [],
  interview_draft_applied: [],
  adventure_created: ['format', 'community_only'],
  adventure_updated: ['format', 'community_only'],
  adventure_application_sent: ['with_note'],
  adventure_application_accepted: [],
  adventure_application_declined: [],
  adventure_left: [],
  connection_requested: ['purpose'],
} as const;

export type AnalyticsEvent = keyof typeof eventProperties;
type AnalyticsValue = string | number | boolean;
const sdkProperties = new Set([
  'token', 'distinct_id', '$anon_distinct_id', '$device_id', '$session_id',
  '$lib', '$lib_version', '$insert_id', '$process_person_profile', '$is_identified',
  '$browser', '$browser_version', '$os', '$os_version', '$device_type',
  '$screen_height', '$screen_width', '$viewport_height', '$viewport_width', '$timezone',
]);

export function filterAnalyticsEvent(event: CaptureResult): CaptureResult | null {
  if (event.event !== '$identify' && !(event.event in eventProperties)) return null;
  const allowed = new Set<string>(event.event === '$identify' ? [] : eventProperties[event.event as AnalyticsEvent]);
  const properties = { ...event.properties };
  for (const [key, value] of Object.entries(properties)) {
    if ((!sdkProperties.has(key) && !allowed.has(key)) ||
        (allowed.has(key) && !['string', 'number', 'boolean'].includes(typeof value))) delete properties[key];
  }
  // PostHog may attach URL/referrer data to automatic person properties.
  return { ...event, properties, $set: undefined, $set_once: undefined };
}

let client: PostHog | null = null;
let initPromise: Promise<void> | null = null;
let identifiedId: string | null = null;

export function initAnalytics(projectKey: string): Promise<void> {
  if (!projectKey) return Promise.resolve();
  if (!initPromise) initPromise = import('posthog-js/dist/module.slim.no-external').then(({ default: posthog }) => {
    posthog.init(projectKey, {
      api_host: 'https://eu.i.posthog.com',
      defaults: '2026-05-30',
      person_profiles: 'identified_only',
      persistence: 'localStorage',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      capture_exceptions: false,
      capture_heatmaps: false,
      capture_dead_clicks: false,
      capture_performance: false,
      disable_session_recording: true,
      advanced_disable_flags: true,
      disable_capture_url_hashes: true,
      before_send: filterAnalyticsEvent,
    });
    client = posthog;
  }).catch(() => { /* Analytics must not block authentication or the app. */ });
  return initPromise;
}

export function syncAnalyticsIdentity(userId: string | null): void {
  if (!client) return;
  // The SDK can restore an identity from localStorage after a page reload. Read it
  // before tracking anything, so a new Telegram account cannot inherit the old one.
  const persistedId = client.get_property('$user_id');
  const previousId = identifiedId ?? (typeof persistedId === 'string' ? persistedId : null);
  if (previousId === userId) return;
  if (previousId) client.reset();
  identifiedId = userId;
  if (userId) client.identify(userId);
}

export function track(event: AnalyticsEvent, properties: Record<string, AnalyticsValue> = {}): void {
  client?.capture(event, properties);
}
