# QUESTR

A Telegram Mini App POC for an invite-only community built around doing things together. English first, coffee colors, pixel characters, and readable typography.

The POC covers registration, avatar selection, emoji tags, a long-form Markdown profile, and an optional **Ask me questions** interview. Profiles are currently visible only to their owner.

## Run locally

Requirements: Node.js 22.12+ and Docker. Commands below use Compose v2. If your machine exposes Compose as `docker-compose`, use that spelling instead.

```sh
cp .env.example .env
npm ci
docker compose up -d db
npm run dev
```

Open **http://localhost:5173**. The API runs on port 5181; PostgreSQL runs on localhost:55432. Migrations and catalog seeds run automatically at server startup.

The default configuration is intentionally usable without credentials:

- `AUTH_MODE=demo` creates a browser session and its own single-use invitation. Reopening the same browser restores the profile. An incognito window is a separate account.
- `AI_MODE=demo` uses explicitly labeled, local, topic-based follow-up questions. This is a demo flow, not a live language model.

To run the entire application in Docker instead:

```sh
docker compose up -d --build
```

Open **http://localhost:5180**. This serves the production frontend and API from one origin. The PostgreSQL volume keeps data across container restarts. `docker compose down` stops the containers and preserves that volume.

## Connect the interviewer

Set these values in your local `.env`, then restart the server (or recreate the app container):

```dotenv
AI_MODE=openai
OPENAI_API_KEY=your-server-side-api-key
OPENAI_MODEL=gpt-4.1-mini
```

The server uses the OpenAI Responses API with structured output and `store: false`. API keys never reach the browser. `store: false` disables storing the response as a retrievable API object; it is not a claim about the provider's separate abuse-monitoring retention policies. See [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and [API data controls](https://developers.openai.com/api/docs/guides/your-data).

Before an interview starts, the user sees which provider will process their answers and explicitly starts the conversation. Only interview text, their current bio, and an interest catalog enter the model context. Telegram details and account IDs do not. The server sends opaque per-request answer references instead of database IDs.

### The wording contract

This is stronger than a prompt telling a model to edit lightly:

1. The interviewer asks one clarifying question at a time and follows the user's specific interests.
2. For a bio, the model returns section keys and references to whole original answers. It cannot supply biography sentences.
3. The server validates each reference and inserts the original answer verbatim. It may add fixed headings and paragraph breaks. Existing manually written Markdown is preserved.
4. Unknown references, assistant-message references, duplicate sources and unsupported tag references are rejected.
5. The user reviews the proposal, original answers, and suggested tags before applying it to the private draft.
6. Applying a proposal checks the draft revision. If the user has edited the draft in the meantime, the proposal is rejected as stale. Saving the profile is a separate action.

This deliberately favors fidelity over smooth prose. Fragmentary answers may still read like fragments; the interviewer is instructed to ask for clarification, and the user can edit the resulting bio. A new interview never requires finishing a fixed number of questions. Demo questions are scripted and do not provide a real model's understanding of corrections or nuance.

The current safeguards preserve wording, but do not prove the semantic correctness of every model-selected tag or source grouping. That is why proposals require review.

## Connect @questr_game

1. Serve the app behind HTTPS, for example at `https://questr.coffeecode.io`.
2. Set `AUTH_MODE=telegram`, `TELEGRAM_BOT_TOKEN`, `APP_ORIGIN` to the exact HTTPS origin, and `COOKIE_SECURE=true`. With Docker, set `APP_ORIGIN_DOCKER` to that origin as well.
3. Configure the bot's Main Mini App or menu button in BotFather to open that HTTPS URL.
4. Create single-use invitations with `npm run invite` (or `docker compose exec app npm run invite`).

The browser sends official Telegram Mini App `initData` to the server. The server verifies the HMAC signature, freshness, and numeric user ID before issuing a session. Client-provided `initDataUnsafe` is never trusted. [Telegram authentication documentation](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).

Optionally set `TELEGRAM_WEBHOOK_SECRET` and configure the bot's webhook to `/api/telegram/webhook` with that secret. The POC records `/start` and deduplicates incoming update IDs. It does not implement member messaging or a bot chat relay.

Demo authentication is rejected when configured with a non-localhost app origin. An API key and bot token are not included in this repository. Live provider output and real Telegram clients require those credentials and an HTTPS deployment.

## Data and persistence

The executable schema is in [`db/migrations/001_initial.sql`](db/migrations/001_initial.sql).

| Area | Tables |
| --- | --- |
| Identity and access | `users`, `telegram_accounts`, `sessions`, `invites`, `user_consents` |
| Profiles | `profile_drafts`, `profiles`, `profile_answers`, `profile_tags` |
| Catalogs | `avatar_presets`, `tags`, `tag_translations` |
| Interview | `ai_conversations`, `ai_messages`, `ai_proposals` |
| Operations | `schema_migrations`, `bot_updates` |

- `intro_markdown` is PostgreSQL `TEXT`, without an artificial short-bio character limit. HTTP bodies have a 5 MiB transport limit; individual interview answers have a 12,000-character limit and AI context has a 120,000-character ceiling. These are operational limits, separate from profile length.
- Each account has one private editable draft and a separately confirmed profile. Auto-save uses optimistic revisions and serialized writes.
- Catalog tags have stable codes, separate emoji, and translation rows. Custom tags retain their original label, emoji, and locale. A tag is either a catalog reference or a custom value, enforced by the database.
- Invitations are stored as hashes and redeemed atomically in the same transaction as registration and required consent records.
- HTTP-only sessions expire after 14 days. All profile and interview endpoints operate on the authenticated owner; they do not accept a target user's ID.
- Markdown rendering does not execute raw HTML or JSX. Unsafe URL protocols and external image embeds are excluded from the profile renderer.

The POC retains its local records until its database is removed or records are explicitly deleted. Automatic retention jobs, account export/deletion UI, moderation, clubs, outings, and a city scene are outside this implementation. Set retention and operator policies before inviting real pilot users.

## Frontend and localization

React + TypeScript + Vite, [MDXEditor](https://mdxeditor.dev/editor/docs/getting-started) for visual/source editing, React Markdown for read-only profiles, and original SVG pixel avatars. There are no external font or image dependencies. The Telegram SDK is loaded from Telegram's official host.

UI copy lives in `src/locales/en.ts` and is accessed through `src/i18n.ts`. The editor exposes its own translation callback. English is currently the only supported locale. To add another language, add a message catalog, tag/character labels, an allowed locale, and translated interview/section prompts; user-authored text stays in its original language. Profile text uses automatic text direction and layouts use logical properties where appropriate.

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

Browser tests cover desktop and mobile registration, source/visual Markdown conversion, custom tags, profile editing and reload, exact-wording interview proposals, concurrent changes, and unsafe Markdown rendering. They use the running dev server or start one when needed. The default configuration must remain in demo mode for these tests.

To run those same browser scenarios against the production Docker build: `PLAYWRIGHT_BASE_URL=http://localhost:5180 npm run test:e2e`.

## Layout

```text
db/migrations/     Versioned PostgreSQL schema
server/           Express API, auth, migrations, interview and source validation
shared/           Validation schemas and stable catalog definitions
src/              Registration, editor, interview and profile UI
public/avatars/   Twelve original pixel character SVGs
public/art/       Coffee-break pixel illustration
tests/            Unit, PostgreSQL integration and browser scenarios
```
