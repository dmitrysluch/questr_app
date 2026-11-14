# Adventures v1

An active character can host an adventure, apply to one, and join an accepted party.
There is no city scene, character equipment, room builder, global DM or public
member directory. The Mini App manages adventures; Telegram handles messages.

## Local walkthrough

Open `http://localhost:5180/#adventures` after saving a character. In Discover,
choose locations and optionally languages under Adventure filters, or create an adventure.
The default screen for active characters is the upcoming-adventures list. Character
editing remains available from the Character tab. Onboarding puts spoken languages
and private adventure filters in a separate top-level step from interests and bio.
An empty language selection includes every language in the chosen locations.
My adventures includes hosted adventures, applications and accessible history,
regardless of discovery filters. To try an application, open a separate browser
profile/incognito session, save a second character and open the same adventure URL.
The application form is in the Mini App in both demo and Telegram modes. The
applicant does not need to start the bot to submit. The host can accept in the
Mini App or from the Telegram notification buttons; the applicant can then see
the meeting details. Refresh
reloads immediately; visible pages also refresh every 20 seconds and on focus.

An adventure has a Markdown description, one city or Online, one language, start
and end instants and an IANA time zone, party size (2–50, **including the host**),
and private meeting details. Offline hosts can choose a place with Google Places
when `GOOGLE_MAPS_BROWSER_KEY` is configured, or enter a venue and Maps link
manually. The picker stores a Place ID in the Maps link; hosts write their own
meeting instructions because Places names and addresses cannot be persisted as
application data. The browser key needs Google Maps JavaScript and Places API (New),
billing, and an HTTP referrer restriction. A Maps search link works without a key.
Online adventures require an HTTPS meeting link. If an accepted party has a Zoom
URL in its details or public description, it gets a Join Zoom button. A link in
the public description remains visible to all viewers, so use private joining
details when the call is intended for accepted members only. Public content
and application, party-chat and direct messages use the existing explicit-content reviewer; private
meeting details are not sent to the model. Demo review uses limited local fixtures.
The UI explains connected review through OpenRouter before publication/submission.

Local wall times are converted explicitly, not interpreted in the viewer's zone.
Nonexistent and repeated daylight-saving times are rejected with an actionable
error. Event displays use the selected event time zone.

The calendar download is an `.ics` event with start, end and a one-hour alert.
It includes an exact address or call link only when the downloader currently has
access to private meeting details. Accepted members and hosts can also select a
15-minute, one-hour or one-day Telegram reminder in Telegram mode. The bot checks
live membership before sending; it does not include private joining details in
the reminder. A reminder requires the user to have started the bot. Changing the
start time resets unsent reminders; cancellation clears queued reminders.

## Lifecycle and authorization

- Creation publishes directly. The existing `events.create` budget allows 2 per
  rolling 7 days. Failed transactions spend nothing. A UUID plus payload hash
  makes retried creation return the same adventure without spending again.
- Public event cards show a short joint-activity summary, district or online
  platform, approximate cost, experience requirements and remaining places.
  Full descriptions may use Markdown, but public event fields reject links;
  exact meeting addresses and call URLs belong in private meeting details.
- Organizers can close or reopen applications without cancelling the event.
  Pending applications can still be decided after closure; new ones cannot be sent.
- Applications are pending until the host accepts or declines. A pending request
  reserves no seat. There is one application per person/event; declined, removed
  or withdrawn applicants cannot repeatedly contact the host through that event.
  A separate provisional first-contact limit allows 10 applications per day.
- Event-row locks serialize acceptance, editing, leaving and cancellation. Two
  accepts for the last seat cannot both succeed. Editing requires a revision and
  cannot lower capacity below the accepted count. Moving an adventure requires
  current create rights in the destination location. Other edits use the organizer
  grant, even if the host can no longer create new adventures.
- An `organizer` event grant is created with the host membership. Applying grants
  `applicant` (`events.view` only); acceptance adds `participant`. Leaving/removal
  revokes participant/moderator grants in the membership transaction. The applicant
  view grant preserves public event history, without private details or chat.
- Chat requires a live event grant, an accepted membership, active accounts and a
  published event at both submission and delivery. A role alone is insufficient.
- Exact addresses/links live in `event_private_details`, never list responses or
  bot notification bodies. Only authorized hosts and accepted participants of an
  open event receive them. Editing the private field rotates an online link.
- Contextual character endpoints expose the host to adventure viewers, applicants
  to the host, and accepted party members to one another. They return saved profile
  fields only; private drafts, interview answers, filters and Telegram IDs stay out.
- The host can cancel, or complete after the start time. Both close chat and remove
  the adventure from discovery. Cancellation notifies pending and accepted members.
  Leaving a closed adventure still works. Old messages already delivered cannot
  be recalled by revoking access.

The base schema is `db/migrations/006_adventures.sql`: memberships, private details,
activity audit, per-user bot topics, messages, durable inbox and outbox. Migration
`013_bot_direct_messages.sql` adds consent-gated, event-scoped private topics. Role grants
and budget primitives remain in the existing authorization tables. Migration
`007_event_details_and_romance.sql` adds end time, map URL and reminder records,
plus the profile's opt-in romance signal. The latter is a profile interest signal;
it does not relax the existing explicit-sexual-content policy.

## Telegram setup

1. Deploy behind HTTPS; set `AUTH_MODE=telegram`, `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_WEBHOOK_SECRET`, `PUBLIC_APP_URL`, `APP_ORIGIN`, and secure cookies.
2. Enable **topics in private chats** for `@questr_game` using BotFather. Verify
   `getMe.has_topics_enabled`. Regular Telegram groups are not used.
3. Register `/api/telegram/webhook` with the matching Bot API `secret_token` and
   `message` and `callback_query` updates. The bot worker starts only in Telegram mode with a configured
   webhook secret. The existing invitation and signed Mini App login still apply.
4. As two real test users, start the host's bot and finish registration. Apply from
   the adventure page in the Mini App: write the first message in the form and
   submit it there. The applicant does not need to start the bot. The typed first
   contact is reviewed before delivery. The host notification contains the
   application and Accept/Decline buttons; every press rechecks live permissions,
   event capacity and application status.
   Existing `/start quest_<id>` links still open an adventure topic in the bot,
   but opening a bot link alone does not submit an application.
5. Accept in QUESTR or from the notification, then use “Open party chat”. Text in that topic is delivered
   to accepted members' own topics under the sender's QUESTR display name. Raw
   Telegram messages are not forwarded; IDs/usernames are not shared. Only text
   messages are supported in v1 (up to 3000 characters). Use `/chats` to list
   accessible adventures, `/chat <code>` to open a party topic, and
   `/people <code>` to see accepted participants who have started the bot.
6. Use `/dm <adventure code> <person code>` to open a private topic and write an
   opener. The other person receives the reviewed opener and must use
   `/accept <chat code>` before either side can exchange more messages. They can
   use `/decline <chat code>`, and either side can later use `/block <chat code>`.
   A declined/blocked conversation cannot be restarted from the same adventure.
   Opening a private chat requires an accepted membership and an event-scoped
   `dm.send_opener` role grant. The default budget is three first contacts per
   rolling seven days; replies require `dm.message` and live roles on both sides.
   Party and private messages stop when a participant leaves or the adventure
   closes, including messages queued but not yet delivered.

The Mini App button uses Telegram's `openTelegramLink` when available. A bot
deep link may still show Telegram's **Start** button before it sends `/start`;
the Bot API cannot force the client to open a specific private topic directly.
The bot posts in that topic so it is easy to open from the chat list.

Official references: [private bot topics](https://core.telegram.org/bots/api#createforumtopic),
[bot account fields](https://core.telegram.org/bots/api#getme), and
[deep linking](https://core.telegram.org/bots/features#deep-linking).

Webhook handling stores a normalized update and quickly acknowledges it. Duplicate
update IDs cannot create duplicate applications, messages or queue entries. Workers
use row locks and durable queue state. Relay delivery rechecks both sender and
recipient under an event lock, so leaving/cancellation excludes queued messages.
Known Telegram 429 responses retry after the specified delay, with a bounded
attempt count. Ambiguous network failures and other delivery errors are marked
`failed`, rather than retried blindly: Bot API has no send idempotency key. A crash
between Telegram accepting a send and the SQL commit can still duplicate a send;
this is not an exactly-once delivery guarantee. Failed queue rows require operator
inspection; there is no queue dashboard yet. Deleted/closed bot topics likewise
need operator recovery in this version.

Automated tests use PostgreSQL and a fake Telegram API; they do not contact users.
Real Telegram topic navigation, BotFather setup and mobile client behavior must be
checked on the HTTPS deployment. Docker demo does not start the Telegram worker.
