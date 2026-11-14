CREATE TABLE dm_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  first_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  second_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','pending','accepted','declined','blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(first_user_id < second_user_id),
  CHECK(requested_by IN (first_user_id,second_user_id)),
  UNIQUE(event_id,first_user_id,second_user_id)
);
CREATE TABLE dm_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  telegram_update_id bigint NOT NULL UNIQUE REFERENCES bot_updates(update_id),
  body text NOT NULL CHECK(length(body) BETWEEN 1 AND 3000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE dm_bot_topics (
  conversation_id uuid NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id bigint NOT NULL,
  PRIMARY KEY(conversation_id,user_id), UNIQUE(user_id,thread_id)
);
ALTER TABLE bot_outbox ADD COLUMN dm_id uuid REFERENCES dm_conversations(id) ON DELETE CASCADE;
ALTER TABLE bot_outbox ADD COLUMN dm_message_id uuid REFERENCES dm_messages(id) ON DELETE CASCADE;
ALTER TABLE bot_outbox DROP CONSTRAINT bot_outbox_kind_check;
ALTER TABLE bot_outbox ADD CONSTRAINT bot_outbox_kind_check CHECK(kind IN ('notification','reply','relay','reminder','dm_request','dm_relay'));
INSERT INTO role_capabilities(role_code,capability,own_profile_only) VALUES
  ('organizer','dm.send_opener',false),('organizer','dm.message',false),
  ('participant','dm.send_opener',false),('participant','dm.message',false);
INSERT INTO capability_budgets(user_id,capability,max_uses,window_seconds)
  SELECT id,'dm.send_opener',3,604800 FROM users WHERE status IN ('onboarding','active')
  ON CONFLICT DO NOTHING;
