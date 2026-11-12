# QUESTR

A Telegram Mini App POC for an invite-only community built around doing things together. English first, coffee colors, pixel characters, and readable typography.

The POC covers registration, avatar selection, emoji tags, a long-form Markdown profile, and an optional **Ask me questions** interview. Profiles are currently visible only to their owner.

## Interface and interests

The character sheet uses a centered layout with a compact step bar. Copy is limited to labels, actions, state and information needed to make a decision. Product vocabulary follows RPGs: a member is a **questr**, their profile is a **character sheet**, and a future shared activity is an **adventure**. For example, “4 questrs signed up for this adventure.” Counts only appear when backed by real data; adventures are outside this POC.

The searchable catalog contains 290 interests across 12 topics, including specific artists, genres, activities and scientific interests. Search supports aliases, accents, punctuation and small typos, with optional topic filters, keyboard navigation and custom tags. Selected tags persist by stable code; existing profiles keep their tags. Catalog definitions and aliases live in `shared/interests.ts`; UI category labels live in `src/locales/en.ts`.

Emoji remain Unicode in storage and are rendered locally on a 16×16 canvas with pixel scaling, including custom tags and AI suggestions. Their appearance follows the device's emoji font. No image service or icon dependency is needed. All fields, search controls and category names are ready for localization; English is the current catalog language.

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

## Connect the interviewer through OpenRouter

Set these values in your local `.env`, then restart the server (or recreate the app container):

```dotenv
AI_MODE=openrouter
OPENROUTER_API_KEY=your-server-side-openrouter-key
OPENROUTER_MODEL=openai/gpt-6.1-terra
OPENROUTER_REASONING_EFFORT=high
```

All model requests go to OpenRouter's Chat Completions endpoint, including models whose IDs start with `openai/`. There are no direct OpenAI API calls. The model is configurable; choose one supporting structured outputs and reasoning. Requests use JSON Schema, `reasoning: { effort: "high", exclude: true }` by default, and `provider.require_parameters=true`, with `data_collection=deny` for provider routing. The output budget includes room for reasoning; reasoning text is not displayed or persisted. This is not a blanket promise about all retention policies. See [OpenRouter reasoning settings](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [structured outputs](https://openrouter.ai/docs/guides/features/structured-outputs), and [provider data policies](https://openrouter.ai/docs/guides/routing/provider-selection#requiring-providers-to-comply-with-data-policies).

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

The interview and drafting prompts prohibit explicitly sexual descriptions, invitations and requests. An independent model call through OpenRouter reviews each answer, the bio before preview/publication, and generated bio proposals. Ordinary romance, orientation, gender identity, and neutral non-graphic education or personal boundaries are allowed. The policy is defined in `shared/content-policy.ts`; the reviewer is in `server/moderation.ts`.

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
| Content review | `content_reviews` (text hash, policy/model key, verdict and spans); review metadata on `ai_messages` |
| Operations | `schema_migrations`, `bot_updates` |

- `intro_markdown` is PostgreSQL `TEXT`, without an artificial short-bio character limit. HTTP bodies have a 5 MiB transport limit; individual interview answers have a 12,000-character limit and AI context has a 120,000-character ceiling. These are operational limits, separate from profile length.
- Each account has one private editable draft and a separately confirmed profile. Auto-save uses optimistic revisions and serialized writes.
- Catalog tags have stable codes, separate emoji, and translation rows. Custom tags retain their original label, emoji, and locale. A tag is either a catalog reference or a custom value, enforced by the database.
- Invitations are stored as hashes and redeemed atomically in the same transaction as registration and required consent records.
- HTTP-only sessions expire after 14 days. All profile and interview endpoints operate on the authenticated owner; they do not accept a target user's ID.
- Markdown rendering does not execute raw HTML or JSX. Unsafe URL protocols and external image embeds are excluded from the profile renderer.

The POC retains its local records until its database is removed or records are explicitly deleted. Automatic retention jobs, account export/deletion UI, human moderation tools, clubs, outings, and a city scene are outside this implementation. Set retention and operator policies before inviting real pilot users.

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

Browser tests cover desktop and mobile registration, source/visual Markdown conversion, custom tags, profile editing and reload, bio comparisons and reviewed interview proposals, topic changes with unsent text, concurrent changes, unsafe Markdown rendering, and content highlights/correction in bios and chat. Integration tests also exercise direct publication rejection, review outages, edits during a review, unsafe generated proposals, and idempotent topic-change retries. They use a running dev server or start one with `AUTH_MODE=demo AI_MODE=demo` so automated runs make no paid model calls. An already-running target must also be in demo mode.

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
