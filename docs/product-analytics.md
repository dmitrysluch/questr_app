# Product analytics

QUESTR sends explicit browser events to PostHog's EU endpoint only when `POSTHOG_PROJECT_KEY` is set in the server environment. An unset or empty value disables analytics in every mode, including Telegram. Use a separate project key for local or staging environments if they need analytics. The browser integration does not need a PostHog server secret.

The SDK keeps its identity in browser local storage without a cookie, identifies registered users with the internal UUID, and sends no name or email as person properties. It does not capture clicks, forms, page URLs, session recordings, exceptions, heatmaps or performance data. A final event filter drops unexpected event types and all properties outside a small allowlist. Browser ingestion targets `https://eu.i.posthog.com`; content security policy, if added, must allow that endpoint.

| Event | When | Allowed properties |
| --- | --- | --- |
| `screen_viewed` | Registered user opens a main screen or onboarding step | `screen` (fixed screen name) |
| `registration_completed` | Registration succeeds | None |
| `profile_published` | Bio/profile publication succeeds | First publication, presence of intro, counts of tags, Ask me topics and languages |
| `interview_started`, `interview_answered`, `interview_topic_changed`, `interview_draft_created`, `interview_draft_applied` | Corresponding AI bio action succeeds | Existing bio flag on start only |
| `adventure_list_viewed` | User opens Discover or My adventures | `view` |
| `adventure_created`, `adventure_updated` | Adventure save succeeds | Online/offline, community-only flag |
| `adventure_application_sent`, `adventure_application_accepted`, `adventure_application_declined`, `adventure_left` | Corresponding action succeeds | Note-present flag on application only |
| `connection_requested` | Character chat/contact request succeeds in the web flow | Chat/contact purpose |

Telegram bot actions are not included in this browser-only first pass. The event catalog and filtering code live in `src/analytics.ts`; add new events there before instrumenting another flow. Never pass user text, profile content, contact details, exact place or event IDs as analytics properties.
