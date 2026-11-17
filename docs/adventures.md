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
Apply sends an application directly from the Mini App in both demo and Telegram
modes. A note can be added first, but is optional. The applicant does not need to
start the bot to submit. The host can open the applicant's character directly
from the notification, then accept in the Mini App or from the Telegram buttons;
the applicant can then see the meeting details. Refresh reloads immediately;
visible pages also refresh every 20 seconds and on focus.

An adventure has a Markdown description, one city or Online, one language, start
and end instants and an IANA time zone, and party size (2–50, **including the host**).
The card summary is generated from the public description, so hosts write only
one required description. Cost defaults to Free and experience to Beginners
welcome; hosts can change either under Meeting details & more, together with
the time zone and private meeting point. Private meeting details can be added
later. Offline hosts search one field for team-curated public venues and, when
`GOOGLE_MAPS_BROWSER_KEY` is configured, Google Maps points. A curated venue is
shown on the public adventure card. A Google selection stores only its Place ID
in the private meeting URL, visible to accepted members; it is not added to the
public catalog. Hosts may add private directions, including for a home, without
selecting a public venue or entering a URL. Admins add and archive public venues
under Admin. The browser key needs Google Maps JavaScript and Places API (New),
billing, and an HTTP referrer restriction. Saved-venue search works without a key.
Before enabling Google search for users, publish Terms of Use and a Privacy Policy
that incorporate Google's Terms of Service and Privacy Policy.
Online adventures can be published before the call is arranged. If a private
HTTPS call link is supplied, known platforms (Zoom, Google Meet, Microsoft Teams,
Jitsi Meet, Whereby and Discord) are named automatically, and accepted members
get a Join call button. Public descriptions reject links; call links belong in
private joining details. Public content
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
- Public event cards show a short summary derived from the description, district
  or known online platform, approximate cost, experience requirements and remaining places.
  Full descriptions may use Markdown, but public event fields reject links;
  exact meeting addresses and call URLs belong in private meeting details.
- Organizers can close or reopen applications without cancelling the event.
  Pending applications can still be decided after closure; new ones cannot be sent.
- Applications are pending until the host accepts or declines. A pending request
  reserves no seat. There is one active application per person/event; withdrawn
  applicants may apply again, but declined or removed applicants cannot.
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
- The accepted party view places avatars and names in a horizontal row. Up to three
  pixel badges show tags shared with the viewer and mutual romance interest; badge
  labels appear on hover. Ask me topics open below the row, and each avatar leads
  to a contextual character page with a return link. Pending applicants and other
  viewers do not receive the roster or its match data.
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
2. Enable **topics in private chats** for `@questr_game` using BotFather, then
   disallow users to create new topics there. Verify `getMe.has_topics_enabled`
   is `true` and `getMe.allows_users_to_create_topics` is `false`. This keeps
   commands in the bot's main chat; only QUESTR creates party and private topics.
   Regular Telegram groups are not used.
3. Register `/api/telegram/webhook` with the matching Bot API `secret_token` and
   `message` and `callback_query` updates. The bot worker starts only in Telegram mode with a configured
   webhook secret. The existing invitation and signed Mini App login still apply.
4. As two real test users, start the host's bot and finish registration. Apply from
   the adventure page in the Mini App with one tap, or add an optional note first.
   The applicant does not need to start the bot. Any typed note is reviewed before
   delivery. The host notification contains the
   application, Accept/Decline buttons and a character button that opens the
   applicant's profile inside the Mini App. Every decision rechecks live permissions,
   event capacity and application status.
   Existing `/start quest_<id>` links show the adventure's chat status in the
   bot; opening a bot link alone does not submit an application.
5. Creating an adventure queues a party topic for its host. Accepting an application
   queues a party topic for that participant. If they have not started the bot,
   the topic is created after their first `/start`. Then use “Open party chat”
   or the bot's topic link. Text and Telegram photos in that topic are delivered
   to accepted members' own topics under the sender's QUESTR display name.
   Earlier party messages are not replayed to new members; someone who rejoins
   can still see messages already in their own Telegram topic. Raw
   Telegram messages are not forwarded; IDs/usernames are not shared. Text is
   limited to 3000 characters and photo captions to 900 characters. Captions
   use the existing text review; photo pixels are not reviewed in this invite-only
   POC. Photos sent as documents and album grouping are not supported. Bot commands and
   their replies stay in the main chat. `/chats` shows adventure buttons: choose
   one to open the automatically created party topic or see its members.
   `/people` lists people once each, labelled with the latest shared adventure.
6. Choose a person from either menu to open a private topic, then write the
   first text message in that Telegram topic. The bot confirms that it is waiting
   for the recipient's decision. The recipient gets the reviewed opener with
   **Accept** and **Decline** buttons. They must accept before either side can
   exchange more messages, including photos. Either side can later use `/block <chat code>`.
   Each pair of people has one private conversation and one topic in each person's
   bot chat, reused across all their shared adventures. A decline or block applies
   to the pair, so another adventure cannot restart the conversation.
   Opening a private chat requires an accepted membership and an event-scoped
   `dm.send_opener` role grant. The default budget is three first contacts per
   rolling seven days; a second shared adventure does not consume another opener.
   After acceptance, `dm.message` follows pair-level consent while both accounts
   are active, even if they leave the adventure or it closes.
   In the Telegram Mini App, character-page buttons explain this flow and open
   the same bot topic from either adventure; the first-message form remains available in the
   browser version. Party messages stop when a participant leaves or the adventure
   closes. Existing extra private topics keep their Telegram history and reply with
   a link to the selected topic if someone writes in them.

Before a public release, add image-content review before relaying photos. The
current text reviewer does not inspect image pixels. The review-model choice
can be revisited separately; the current model and text policy remain in place.

The Mini App button uses Telegram's `openTelegramLink` when available. Once a
topic exists, its `https://t.me/questr_game/<thread_id>` link opens that topic.
Before the user starts the bot, the button uses a `/start` deep link; Telegram
may show its **Start** button first. The bot posts in the new topic so it is also
visible in the chat list.

Official references: [private bot topics](https://core.telegram.org/bots/api#createforumtopic),
[bot account fields](https://core.telegram.org/bots/api#getme), and
[deep linking](https://core.telegram.org/bots/features#deep-linking).

Webhook handling stores a normalized update and quickly acknowledges it. Duplicate
update IDs cannot create duplicate applications, messages or queue entries. Workers
use row locks and durable queue state. Party relay delivery rechecks live event
membership; private relay delivery rechecks pair-level consent and active accounts.
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
