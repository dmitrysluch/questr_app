# QUESTR

A Telegram Mini App POC for an invite-only community built around doing things together. English and Russian UI, coffee colors, pixel characters, and readable typography.

The POC covers registration, avatar selection, emoji tags, spoken languages, an opt-in romance signal, a long-form Markdown profile, and an optional **Ask me questions** interview. Saved profiles are shared in the context of adventures; drafts and interview answers stay private. New characters must choose and save at least one discovery location and adventure language before publication. Existing characters can still choose all adventure languages by clearing that filter. Discovery locations can be countries, cities or Online.

Active characters land on the upcoming-adventures list. Character creation has separate top-level Bio and Languages & filters steps. Adventure cards show the joint activity, city or online platform, approximate cost, experience requirements and available places; hosts can close and reopen applications.

Accepted parties show a scrollable row of character avatars. Each character opens a contextual profile; up to three pixel badges mark shared interests and mutual openness to romance, with labels on hover. An Ask me control reveals that character's conversation topics below the row. Applicants and other adventure viewers do not see the party row.

The [geography and access design](docs/discovery-and-access.md) describes the implemented location catalog, filter matching, scoped roles, expiring grants and transactional usage budgets. The [adventures v1 guide](docs/adventures.md) covers creation, discovery, applications, accepted parties, private meeting details, start/end times, calendar export, reminders and the Telegram relay. Reputation automation is not implemented yet.

Communities are configured by the external JSON file at `COMMUNITY_CATALOG_PATH`; membership is granted by invites and stored in PostgreSQL. The catalog is validated at startup, and database seeding rejects removal or reparenting of an existing ID without an explicit migration. Names can be edited in JSON. The Mini App reads the resulting tree from the API. Admins can inspect the read-only tree and IDs in the **Communities** workspace tab. A member of a child community can see adventures posted to its ancestors, while a parent membership does not open child adventures. Community adventures are hidden from nonmembers in discovery, direct links, applications and party chats. A published adventure's community cannot be changed. Profiles show invite-granted communities beside interest tags. Profile discovery filters can select all accessible adventures, only community adventures, or a particular branch; Discover also offers temporary filters that leave the profile defaults untouched.

## Interface and interests

The character sheet uses a centered layout with a compact step bar. Copy is limited to labels, actions, state and information needed to make a decision. Product vocabulary follows RPGs: a member is a **questr**, their profile is a **character sheet**, and a shared activity is an **adventure**. For example, “4 questrs signed up for this adventure.” Party counts come from accepted memberships, including the host.

The searchable catalog contains over 800 interests across 13 topics, including Olympic sports, film genres and people, music artists, visual-art techniques, instruments, book genres and titles, and named games. Search supports aliases, accents, punctuation and small typos, with optional topic filters, keyboard navigation and custom tags. Selected tags persist by stable code; existing profiles keep their tags. The old “Cozy games” code remains valid for saved profiles but is hidden from search. Definitions and aliases live in `shared/interests.ts` and `shared/interest-expansion.ts`; category labels and Russian translations live in `src/locales/`.

The sports selection follows the [LA28 programme](https://www.olympics.com/ioc/faq/future-olympic-games/which-sports-and-disciplines-are-on-the-programme-of-the-los-angeles-2024-olympic-games) and [Milano Cortina 2026 disciplines](https://support.olympics.com/hc/en-gb/articles/43002667811219-What-sports-are-in-the-Olympic-Winter-Games-Milano-Cortina-2026). Artist and film-person tags are a stable, diverse editorial selection informed by [Spotify Wrapped](https://newsroom.spotify.com/2025-12-03/wrapped-top-artists-songs-albums-podcasts-audiobooks/) and [IMDb STARmeter](https://www.imdb.com/chart/starmeter/); they are not a live or exact top-100 ranking.

Emoji remain Unicode in storage and are rendered locally on a 16×16 canvas with pixel scaling, including custom tags, the romance signal and AI suggestions. Their appearance follows the device's emoji font. No image service or icon dependency is needed. All fields, search controls, category names and catalog labels have English and Russian versions.

## Run locally

Requirements: Node.js 22.12+ and Docker. Commands below use Compose v2. If your machine exposes Compose as `docker-compose`, use that spelling instead.

Prepare `local/communities.json` with a `communities` array. Each entry needs a stable `id`, an optional parent ID (`null` for a root), and English/Russian names:

```json
{"communities":[{"id":"university_students","parentId":null,"name":{"en":"University students","ru":"Студенты вузов"}}]}
```

For an existing database, copy the currently deployed `shared/communities.json` to the external file before deploying this version. Existing community IDs cannot be removed or reparented without a database migration. The previous catalog is also available from git history: `git show 27365b6:shared/communities.json > local/communities.json`.

```sh
cp .env.example .env
npm ci
python3 scripts/import-geography.py
docker compose up -d db
npm run dev
```

Both catalogs are required at startup and ignored by git. Set `COMMUNITY_CATALOG_PATH` to another file if needed. The API runs on port 5181; PostgreSQL runs on localhost:55432. `LOCATION_CATALOG_PATH` points to an external JSON file of countries, cities and Online. The import command generates one in `local/locations.json`. Existing location IDs must remain stable; removed entries stay in PostgreSQL so existing references continue to work. Changing a location's kind or parent requires an explicit database migration. Open **http://localhost:5173** after starting the app.

With the catalog files in place, the default configuration needs no API credentials:

- `AUTH_MODE=demo` creates a browser session and its own single-use invitation. Reopening the same browser restores the profile. An incognito window is a separate account.
- `AI_MODE=demo` uses explicitly labeled, local, topic-based follow-up questions. This is a demo flow, not a live language model.

To run the entire application in Docker instead:

```sh
docker compose up -d --build
```

Open **http://localhost:5180**. This serves the production frontend and API from one origin. Compose mounts both host catalog files read-only at `/etc/questr/locations.json` and `/etc/questr/communities.json`. For a non-Compose deployment, mount both files and set `LOCATION_CATALOG_PATH` and `COMMUNITY_CATALOG_PATH` to their paths inside the container. The PostgreSQL volume keeps data across container restarts. `docker compose down` stops the containers and preserves that volume.

## Connect the interviewer through OpenRouter

Set these values in your local `.env`, then restart the server (or recreate the app container):

```dotenv
AI_MODE=openrouter
OPENROUTER_API_KEY=your-server-side-openrouter-key
OPENROUTER_MODEL=openai/gpt-6.1-terra
OPENROUTER_REASONING_EFFORT=high
OPENROUTER_QUESTION_MODEL=openai/gpt-6-luna
OPENROUTER_QUESTION_REASONING_EFFORT=medium
OPENROUTER_REVIEW_MODEL=openai/gpt-6-luna
OPENROUTER_REVIEW_REASONING_EFFORT=low
```

All model requests go to OpenRouter's Chat Completions endpoint, including models whose IDs start with `openai/`. There are no direct OpenAI API calls. Terra writes bio drafts; Luna handles frequent interview questions and content reviews. Each task has its own model and reasoning setting so it can be evaluated or changed independently. Models must support structured JSON Schema outputs and the configured reasoning effort. Requests set `provider.require_parameters=true` and `data_collection=deny`. Reasoning text is not displayed or persisted. This is not a blanket promise about all retention policies. See [OpenRouter reasoning settings](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), and [provider data policies](https://openrouter.ai/docs/guides/routing/provider-selection#requiring-providers-to-comply-with-data-policies).

The interface explains that OpenRouter forwards the interview to the configured model provider before the user starts. Only the current bio, conversation and interest catalog enter the model context; Telegram details, account IDs and database message IDs do not. An explicit start is required when switching providers. Existing demo answers are retained and become available to the connected interviewer after that consent.

### Conversation and drafting

- The first question is generated using the existing bio, selected interests and a varied starting angle. Every follow-up receives the latest saved bio, interests and complete conversation.
- The conversation follows the rhythm of getting to know someone at a bar: one easy question at a time, with useful bio material emerging along the way. Enthusiasm and fresh threads invite depth, including specialist interests; having enough material for a bio is not a reason to interrupt an engaged person. There is no topic quota or follow-up limit. The assistant changes direction when a thread runs out or the person disengages, without demanding recalled episodes. The full editable prompt is in [`server/interview-prompt.ts`](server/interview-prompt.ts).
- **Change topic** sends a typed control event, immediately requesting a substantially different area. It preserves unsent textarea text. The event persists through reloads and retries but is excluded from bio sources. Automatic topic changes are guided by the prompt and conversation; they do not require a button press.
- The editor starts from the existing bio. It may rewrite sentences, weave in answers, reorder passages and improve flow while retaining substantive details and the person's voice. Instructions prohibit invented facts and generic flattering filler.
- A proposal contains the **complete updated bio**, a brief change summary and source references. It is not appended to the old text. The original bio is saved alongside it for the **Current bio / Proposed bio** comparison, including after a reload.
- The user can discard or explicitly apply a proposal. Applying checks the draft revision, so an outdated proposal cannot overwrite newer edits. Publishing the profile remains a separate action.
- Provenance validation rejects missing, invented, assistant-only and duplicate source references, and invalid tag references. It does **not** establish the semantic truth of every generated sentence. The review step is intentional; the old verbatim-only guarantee no longer applies.
- A provider failure keeps the existing bio and any received answers. It never silently falls back to scripted questions. Retrying an answer uses the same request ID to avoid duplicates.

The two model operations live in `server/assistant.ts`. A tool-using agent runtime is unnecessary for this scope: the server already supplies the owned bio and conversation, validates the response, and handles persistence/approval. If the assistant later needs to inspect clubs or activities, those capabilities can be exposed as bounded tools.

`AI_MODE=demo` is an explicitly labeled offline fixture for development and browser tests. It does not demonstrate the connected interview's language or editing ability. Its implementation is isolated in `server/demo-assistant.ts`.

### Explicit-content checks

The interview and drafting prompts prohibit explicitly sexual descriptions, invitations and requests. An independent model call through OpenRouter reviews each answer, the bio before preview/publication, generated bio proposals, adventure descriptions, applications, party-chat text and attachment captions, and direct-message text and attachment captions. Telegram photo pixels and document contents are not reviewed in this invite-only POC; media review is required before public release. Ordinary romance, orientation, gender identity, and neutral non-graphic education or personal boundaries are allowed. The opt-in “Open to romance” profile signal does not change this content rule. The policy is defined in `shared/content-policy.ts`; the reviewer is in `server/moderation.ts`.

- A flagged answer stays in the private conversation with muted red highlighting. The interviewer gently explains the profile rule and asks about another interest. Opening a conversation reviews older answers that have not been checked under the current policy/model.
- A flagged bio stays editable, with the offending passages highlighted in both visual and Markdown modes. Highlighting never modifies the saved Markdown or undo history. An expandable list of exact passages also supports browsers without the CSS Custom Highlight API.
- Private drafts continue to autosave, including text that needs changes. The server requires an approved content review before **Save my profile**, including direct API requests. Rejection or a provider outage leaves the previously saved profile intact. Generated proposals are checked before being offered for approval.
- Reviews return exact excerpts; the server validates them against the source and converts them to UTF-16 ranges. Long bios are checked in overlapping chunks. Invalid responses and outages block publication instead of silently approving it.
- Results are cached by exact text hash, policy version, configured model and reasoning effort. Editing the text invalidates the visible highlights and requires another check. Revision checks prevent an old approval from publishing a concurrently edited bio. The migration retires pre-policy pending proposals; original bios and conversation text remain intact.

The editor discloses that bio validation uses OpenRouter, including for manually written profiles. `AI_MODE=demo` uses only a few explicit test phrases, not a production moderation filter. Model classification can still make mistakes; this POC does not yet include a human appeal workflow.

## Connect @questr_game

1. Serve the app behind HTTPS, for example at `https://questr.coffeecode.io`.
2. Set `AUTH_MODE=telegram`, `TELEGRAM_BOT_TOKEN`, `APP_ORIGIN` to the exact HTTPS origin, and `COOKIE_SECURE=true`. With Docker, set `APP_ORIGIN_DOCKER` to that origin as well.
3. Configure the bot's Main Mini App or menu button in BotFather to open that HTTPS URL.
4. Grant your existing character admin access with `npm run admin:grant -- --name <exact display name>` (or use `--user-id <uuid>`). In Docker, run the same command through `docker compose exec app`. This is a local operator command; there is no public self-service admin grant.
5. Open **Admin** in the Mini App to issue and revoke invitations, choose each invite's capacity, event-creation and invite-chain rights and community memberships, and grant global character roles with per-person budgets. Copy the Telegram link to share a multi-person invite in a chat. Community grants are admin-only for now; the community catalog has no interactive editor. `npm run invite` remains available for an initial, operator-issued code.

Issued codes allow 1–20 distinct characters; capacity defaults to one. Each person can apply a code once, including after registration. A partially used link can be revoked without removing existing memberships; full links close automatically. The default expiry is 7 days, selectable from 1 to 30 days. Only the code's hash is stored; copy the plaintext code or Telegram link when it is created. The default `invite.create` budget is **3 seats per rolling 7 days** for a newly registered account, but the account needs an `inviter` or `admin` role to use it. All seats count against this issuance budget when the link is created, including seats that remain unused after revocation. The default `events.create` budget is 2 per rolling 7 days and requires the `event_creator` role. Multiple invites add rights without multiplying the person's budgets. An admin can change a person's limits and windows without resetting usage history. An invite chain of 2 levels lets the recipient and their direct invitees issue invites; each generation loses one level. Demo login codes and `npm run invite` are operator/system-issued and do not consume a person's budget. Telegram share links use the bot's Main Mini App deep-link format; enable the Main Mini App in BotFather for them to open directly.

Admins can also configure exact email-domain invite rules in **Admin → Email domain invites**. A rule can allow registration, grant one or more communities, or both. For an existing character, verification adds the rule's communities; for a new character, a registration-enabled rule replaces the invite code. Email verification is bound to the current Telegram identity; it is not a separate passwordless login. The same email cannot be claimed by two characters. An 8-digit code expires in 10 minutes, has five attempts, and sending is rate-limited. The server checks the normalized email against an enabled exact-domain rule before calling Brevo; subdomains do not inherit access. Disabling a rule stops new verification, while existing membership remains.

To enable real delivery, set `BREVO_API_KEY` and `BREVO_SENDER_EMAIL` in the server environment. Configure and verify that sender in Brevo first. QUESTR uses [Brevo's transactional email endpoint](https://developers.brevo.com/docs/send-a-transactional-email); neither the API key nor verification codes are returned to the browser. Until both variables are set, the email option is hidden from users. Admins can prepare domain rules before enabling delivery.

Transactional verification emails include matching HTML and plain-text versions in the account's interface language (Russian or English).

### Dates and private photo storage

Dates have their own opt-in, photo, rounds, responses, matches, time votes, chat and Telegram topics. Date opt-in and photo upload live in **Character → Romance**; the owner can crop a square photo and preview it before and after upload. Both public dates (for invited members) and community-only dates are supported. A match opens a separate Telegram topic for each participant, even if the pair already has a normal DM. The suggested exact meeting point becomes visible only to the matched pair; they agree on the final place in chat. Previous rounds remain in **My dates** after reopening.

Configure one **private** S3-compatible bucket for date photos using all five server variables below. For Nebius Object Storage, use the S3 API endpoint and region for your bucket; the values come from your Nebius account and are intentionally not hardcoded. The server uses signed path-style requests, so the browser needs no bucket CORS rule or direct S3 credentials.

```sh
DATE_PHOTO_S3_ENDPOINT=https://<your-s3-endpoint>
DATE_PHOTO_S3_REGION=<your-region>
DATE_PHOTO_S3_BUCKET=<your-private-bucket>
DATE_PHOTO_S3_ACCESS_KEY_ID=<access-key>
DATE_PHOTO_S3_SECRET_ACCESS_KEY=<secret-key>
```

The key needs only object `Put`, `Get` and `Delete` rights within this bucket. Keep anonymous/public object access disabled. Photo upload is disabled until all values are configured. Uploaded JPEG/PNG/WebP files are decoded, oriented, resized, re-encoded as JPEG (stripping EXIF/GPS), and stored as a full image plus a thumbnail. A photo stays hidden until an admin approves it in **Dates → Photos to review**. Reports appear in **Dates → Date reports**, where admins can remove the reported photo. Replacing or deleting a photo immediately removes its database pointer; S3 deletion is queued and retried on startup and every ten minutes. Do not enable object versioning for this bucket if permanent deletion of all historical object versions is required.

The date-photo and chat APIs enforce session authorization; no presigned or public photo URLs are issued. Existing matches can be viewed after a user pauses dates, while new replies stop. Reporting someone blocks date discovery and new date messages between that pair. Telegram topics for party, accepted private and matched date chats relay photos and documents through Telegram file IDs without copying file bytes to Questr storage. Each photo in a Telegram album is delivered as an individual photo. Captions are reviewed; image pixels and document contents are not inspected in this POC. Text moderation continues to use the configured review model; profile date-photo review remains manual.

### Operations metrics

Set `METRICS_PATH=/internal/metrics` and a random `METRICS_TOKEN` of at least 32 characters to enable Prometheus scraping. Configure the scraper to send `Authorization: Bearer <token>` to the API's internal address; do not expose this route publicly. An empty `METRICS_PATH` disables the endpoint. `/api/health` remains the database-backed health check.

The endpoint exports Node.js runtime metrics plus `questr_http_requests_total`, `questr_http_request_duration_seconds`, `questr_database_up`, `questr_db_pool_connections`, `questr_db_pool_waiting_requests`, `questr_bot_queue_rows`, `questr_bot_queue_oldest_due_age_seconds`, `questr_dependency_requests_total`, and `questr_dependency_request_duration_seconds`. HTTP labels use route templates and status codes; provider labels are limited to Telegram, OpenRouter and Brevo. Queue `due` excludes scheduled reminders and delayed retries until they are ready to process; `failed` counts unresolved terminal errors. User IDs, event IDs, paths containing identifiers, email addresses, and message content are never metric labels. Queue gauges are omitted if the database cannot be queried; `questr_database_up=0` reports that failure. The metrics route itself is excluded from HTTP counts.

For initial alerts, watch a missing scrape or `questr_database_up=0`, sustained HTTP 5xx or latency, growing bot queue age/failed rows, and provider error rates. Product activity and conversion use the separate [PostHog event layer](docs/product-analytics.md).

The browser sends official Telegram Mini App `initData` to the server. The server verifies the HMAC signature, freshness, and numeric user ID before issuing a session. Client-provided `initDataUnsafe` is never trusted. [Telegram authentication documentation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).

Applications are submitted in the Mini App. For Telegram application notifications, party chats and consent-gated direct messages, set `TELEGRAM_WEBHOOK_SECRET`, configure `/api/telegram/webhook` with that secret, and enable private bot topics in BotFather. Party topics appear automatically; `/chats` and `/people` provide button menus for opening topics and requesting private chats. The [setup and delivery notes](docs/adventures.md#telegram-setup) describe the flow, durable queues and deployment checks.

Demo authentication is rejected when configured with a non-localhost app origin. An API key and bot token are not included in this repository. Live provider output and real Telegram clients require those credentials and an HTTPS deployment.

## Data and persistence

The executable schema is in [`db/migrations/001_initial.sql`](db/migrations/001_initial.sql).

| Area | Tables |
| --- | --- |
| Identity and access | `users`, `telegram_accounts`, `sessions`, `invites`, `invite_redemptions`, `email_invite_domains`, `email_verification_challenges`, `verified_emails`, `user_consents` |
| Profiles | `profile_drafts`, `profiles`, `profile_answers`, `profile_tags`, `profile_languages` |
| Catalogs | `avatar_presets`, `tags`, `tag_translations`, `languages`, `locations` |
| Discovery | `discovery_preferences`, `discovery_locations`, `discovery_languages` |
| Adventures | `events`, `event_memberships`, `event_private_details`, `event_reminders`, `event_activity` |
| Bot messaging | `event_bot_topics`, `event_messages`, `dm_conversations`, `dm_messages`, `dm_bot_topics`, `date_bot_topics`, `bot_inbox`, `bot_outbox` |
| Dates | `date_settings`, `date_photos`, `date_photo_deletions`, `dates`, `date_rounds`, `date_windows`, `date_responses`, `date_matches`, `date_time_votes`, `date_messages`, `date_blocks`, `date_reports`, `date_audit` |
| Authorization | `roles`, `role_capabilities`, `role_assignments`, `capability_budgets`, `capability_usage`, `permission_audit` |
| Interview | `ai_conversations`, `ai_messages`, `ai_proposals` |
| Content review | `content_reviews` (text hash, policy/model key, verdict and spans); review metadata on `ai_messages` |
| Operations | `schema_migrations`, `bot_updates` |

- `intro_markdown` is PostgreSQL `TEXT`, without an artificial short-bio character limit. HTTP bodies have a 6 MiB transport limit for photo uploads; individual interview answers have a 12,000-character limit and AI context has a 120,000-character ceiling. These are operational limits, separate from profile length.
- Each account has one private editable draft and a separately confirmed profile. Auto-save uses optimistic revisions and serialized writes.
- Catalog tags have stable codes, separate emoji, and translation rows. Custom tags retain their original label, emoji, and locale. A tag is either a catalog reference or a custom value, enforced by the database.
- Invitations are stored as hashes and redeemed atomically in the same transaction as registration and required consent records.
- HTTP-only sessions expire after 14 days. Profile editing and interview endpoints operate on the authenticated owner. Event-scoped read endpoints expose saved characters only to authorized viewers.
- Markdown rendering does not execute raw HTML or JSX. Unsafe URL protocols and external image embeds are excluded from the profile renderer.

The POC retains its local records until its database is removed or records are explicitly deleted. Automatic retention jobs and account export/deletion UI are outside this implementation. Date-photo review and reports have a manual admin path; broader moderation operations still need an operator policy before inviting real pilot users.

## Frontend and localization

React + TypeScript + Vite, [MDXEditor](https://mdxeditor.dev/editor/docs/getting-started) for visual/source editing, React Markdown for read-only profiles, and original SVG pixel avatars. There are no external font or image dependencies. The Telegram SDK is loaded from Telegram's official host.

UI copy lives in `src/locales/en.ts` and `src/locales/ru.ts`, accessed through `src/i18n.ts`. The catalog interests have separate Russian labels; custom tags and user-authored text remain in their original language. The interface starts in the language reported by verified Telegram Mini App data, falling back to the browser language when Telegram omits it; unsupported languages fall back to English. A manual EN/RU choice in the header is saved on the account and takes precedence on later visits. Spoken profile languages and adventure languages do not change the interface language. The editor exposes its own translation callback, and connected interviews open in the interface language before following the person's replies.

## Verification

```sh
npm run typecheck
npm test
TEST_DATABASE_URL=postgresql://questr:questr_local@localhost:55432/questr npm run test:integration
npx playwright install chromium
npm run test:e2e
npm run build
```

Integration tests create a new, randomly named `questr_test_*` database, apply migrations, test against real PostgreSQL, and remove only that test database afterward. They are skipped unless `TEST_DATABASE_URL` is provided. The connection must have permission to create test databases.

Browser tests cover the two-user adventure lifecycle on desktop/mobile, plus registration, source/visual Markdown conversion, custom tags, profile editing and reload, bio comparisons and reviewed interview proposals, topic changes with unsent text, concurrent changes, unsafe Markdown rendering, and content highlights/correction in bios and chat. Integration tests also exercise direct publication rejection, review outages, edits during a review, unsafe generated proposals, and idempotent topic-change retries. They use a running dev server or start one with `AUTH_MODE=demo AI_MODE=demo` so automated runs make no paid model calls. An already-running target must also be in demo mode.

To run those same browser scenarios against a production Docker build configured in demo mode: `PLAYWRIGHT_BASE_URL=http://localhost:5180 npm run test:e2e`.

## Layout

```text
db/migrations/     Versioned PostgreSQL schema
server/           Express API, auth, migrations, interview and proposal validation
shared/           Validation schemas and stable catalog definitions
src/              Registration, editor, interview and profile UI
public/avatars/   Twelve original pixel character SVGs
public/art/       Coffee-break pixel illustration
tests/            Unit, PostgreSQL integration and browser scenarios
```
