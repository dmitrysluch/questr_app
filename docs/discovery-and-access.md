# Languages, geography and access

The POC has profiles, AI-assisted bios, spoken languages, private adventure filters
and scoped access. [Adventures v1](adventures.md) builds creation, applications,
discovery and a Telegram party relay on this foundation. Event-scoped DMs require
consent; global DMs remain future work.

## Languages and geography

- `users.locale` is the interface language (`en` or `ru`), separate from spoken languages.
- `profile_languages` lists languages a person speaks, using stable language codes.
  Drafts keep their own language selection until the profile is saved.
- `discovery_preferences` has its own revision and two normalized join tables:
  `discovery_locations` and `discovery_languages`. These are private to the account;
  they never appear in a profile response or the AI interview input.
- `locations` is a forest: country → city, plus the independent `online` root.
  Countries are filters; an event has one city or Online and one language.
  Exact addresses and meeting links use the separate restricted `event_private_details` table.
- The catalog is bundled locally: 250 countries/territories and 6,462 cities.
  Coverage: cities with >=100,000 people, capitals, plus Israeli cities in the
  GeoNames cities15000 extract. Aliases support searches such as Хайфа / חיפה.
  Smaller towns can be added without changing the model. See the
  [source attribution and refresh instructions](../server/data/README.md).
  Parent changes require an explicit migration because they affect access scopes.

Matching requires a selected location. Selected adventure languages narrow the feed;
leaving languages empty shows events in every language within those locations:

| Selection | Matches | Does not match |
| --- | --- | --- |
| All Israel + English/Russian | Matching-language events in any Israeli city | Jordan, Online, Hebrew-only events |
| Haifa + Tel Aviv + Online, English/Russian | Those cities and global online events | Jerusalem, Jordan, other languages |
| Israel, no language selection | Events in every language in Israeli cities | Jordan and Online |
| No location selection | No configured feed | Implicit worldwide access |

The frontend lets people explicitly copy spoken languages into their adventure
filters, but subsequent edits stay independent. Selecting a country doesn't
assert residence, citizenship or willingness to cross a border. No GPS is stored.
`eventMatchesDiscovery` tests these preferences and published status. The v1 feed
also applies authorization and future start times. Club visibility is future work.

## Roles and capabilities

Avoid a role for every city, event and person. Store a small role template and a
separate assignment with a typed resource scope. Display names can change without
changing access. Roles attach to the account that owns the profile.

| Proposed path | Capability | Resource / additional rule |
| --- | --- | --- |
| `events.<location>.view/create` | `events.view`, `events.create` | Location ID; a country grant includes its cities, never Online |
| `profile.<location>.create/view` | `profile.edit`, `profile.view` | A person has one global profile; ownership or future event/club visibility determines access, not a claimed residence |
| `profile.<location>.<event>.edit/accept` | `events.edit`, `events.accept` | Event ID, with its location loaded by the server |
| `…group_chat/group_chat_moderator` | `events.group_chat`, `events.group_chat_moderator` | Event ID; accepted participant/host/moderator grant |
| `dm.<profile>.send_opener/message` | `dm.send_opener`, `dm.message` | Recipient profile plus consent, block and conversation state |
| `invite.create` | `invite.create` | Global, budgeted |
| `admin` | `admin` | Explicit, audited administrative assignment |

Tables: `roles`, `role_capabilities`, `role_assignments`, `capability_budgets`,
`capability_usage`, `permission_audit`. Assignments have `valid_from`, `valid_until`,
`revoked_at`, grantor and reason. Expiry takes effect at permission evaluation;
no scheduled job is required to make an expired permission stop working.

Current templates:

- `member`: read/edit own profile; view/create events after profile completion.
  Existing invited accounts are backfilled. Registration grants this once.
- `organizer`: edit an assigned event, accept applicants, use/moderate its chat,
  and request event-scoped DMs.
- `applicant`: view the assigned event, including its public history. No chat access.
- `participant`: view an assigned event, use its chat, and request event-scoped DMs
  while accepted and open.
- `event_moderator`: moderate one event's chat.
- `inviter`: create invitations, subject to its separate budget.
- `admin`: use administrative operations. It is NOT a bypass into private chats.

Event roles require an event scope in PostgreSQL. Acceptance/removal creates or
revokes the participant assignment in the membership transaction. The host grant
is created with the event. Chat checks accepted membership and open event state
in addition to grants. A DM opener spends a separate budget only when the first
reviewed message is sent. The recipient must accept before later messages are
delivered. Decline or block closes the conversation; access is rechecked before
each delivery.

The evaluator denies blocked, uninvited, expired or revoked accounts/grants.
Onboarding accounts can only work on their own profile. It derives an event's
location from the database and verifies existence before evaluating scope.
Discovery selections never create role assignments. Existing draft writes,
publication and AI-draft application now require `profile.edit`.

## Budgets and reputation

A budget belongs to **an account + a capability**, not a role name. Overlapping
roles cannot multiply an allowance. POC defaults are 2 event creations per rolling
7 days, 3 invitations per rolling 7 days, and 3 DM openers per rolling 7 days;
these are provisional configuration,
not reputation rules. A budget does not itself grant permission: the invitation
budget is dormant unless `inviter` is explicitly assigned.

`consumeCapability` must run inside the transaction performing the action. It
serializes spending, checks live authorization, counts a rolling time window,
and records an idempotency UUID and resource. Failed actions roll back their
usage; retries return `replay`, and the caller must return the original action
result rather than create another object. Keep the action's own unique request ID.
Changing a limit, window or role does not erase historical usage. These quota
primitives are used by event creation, invitation issuance and DM openers.
The operator invite CLI remains a bootstrap path.

Reputation should become a versioned policy over verified signals, not a public
popularity score. Candidate signals: account age, confirmed conduct, cancellation
history and voluntary event feedback. Rejection, silence and number of dates are
not negative signals; event count alone should not earn privileges.

A future policy worker can adjust budgets and bounded grants with an audit reason,
recording the previous/new values and policy version. Use conservative thresholds,
a cooldown and an appeal/manual override path. No reputation thresholds are active
yet; outcomes are not used to change permissions automatically. Never automatically award `admin`,
moderation powers, access to another event's chat, or consent to private messaging.
Reputation changes must preserve quota history and cannot override blocks.
