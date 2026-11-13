ALTER TABLE events ADD COLUMN description_markdown text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN time_zone text NOT NULL DEFAULT 'UTC';
ALTER TABLE events ADD COLUMN capacity integer NOT NULL DEFAULT 6 CHECK(capacity BETWEEN 2 AND 50);
ALTER TABLE events ADD COLUMN revision integer NOT NULL DEFAULT 0;
ALTER TABLE events ADD COLUMN request_id uuid;
ALTER TABLE events ADD COLUMN request_hash text;
ALTER TABLE events ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX event_creation_request ON events(created_by,request_id) WHERE request_id IS NOT NULL;
CREATE TABLE event_private_details (
  event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  meeting_details text NOT NULL
);
CREATE TABLE event_memberships (
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid REFERENCES profiles(user_id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'participant' CHECK(role IN ('host','participant')),
  status text NOT NULL CHECK(status IN ('pending','accepted','declined','withdrawn','removed')),
  application_text text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(event_id,user_id),
  CHECK(role<>'host' OR status='accepted')
);
CREATE INDEX memberships_user ON event_memberships(user_id,event_id);
CREATE TABLE event_activity (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE event_bot_topics (
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  thread_id bigint NOT NULL,
  PRIMARY KEY(event_id,user_id), UNIQUE(user_id,thread_id)
);
CREATE TABLE event_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  telegram_update_id bigint NOT NULL UNIQUE REFERENCES bot_updates(update_id),
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 3000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bot_inbox (
  update_id bigint PRIMARY KEY REFERENCES bot_updates(update_id),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text text NOT NULL,
  thread_id bigint,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','done','failed')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bot_outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  message_id uuid REFERENCES event_messages(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK(kind IN ('notification','reply','relay')),
  body text NOT NULL,
  in_topic boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sent','failed','discarded')),
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  telegram_message_id bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bot_outbox_pending ON bot_outbox(available_at,id) WHERE state='pending';
CREATE INDEX bot_inbox_pending ON bot_inbox(available_at,update_id) WHERE state='pending';
-- Existing event rows were foundation/test data. Backfill their ownership safely.
INSERT INTO event_memberships(event_id,user_id,role,status)
 SELECT id,created_by,'host','accepted' FROM events;
INSERT INTO role_assignments(user_id,role_code,event_id,reason)
 SELECT e.created_by,'organizer',e.id,'Event owner migration' FROM events e
 WHERE NOT EXISTS(SELECT 1 FROM role_assignments a WHERE a.user_id=e.created_by AND a.event_id=e.id AND a.role_code='organizer' AND a.revoked_at IS NULL);

INSERT INTO roles(code) VALUES ('applicant');
INSERT INTO role_capabilities(role_code,capability,own_profile_only) VALUES ('applicant','events.view',false);
ALTER TABLE role_assignments ADD CONSTRAINT applicant_event_scope CHECK(role_code<>'applicant' OR event_id IS NOT NULL);
