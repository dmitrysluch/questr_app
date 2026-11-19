CREATE TABLE date_bot_topics (
  match_id uuid NOT NULL REFERENCES date_matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id bigint NOT NULL CHECK(thread_id>0),
  PRIMARY KEY(match_id,user_id), UNIQUE(user_id,thread_id)
);
ALTER TABLE date_messages ADD COLUMN telegram_update_id bigint UNIQUE REFERENCES bot_updates(update_id);
ALTER TABLE bot_outbox ADD COLUMN date_match_id uuid REFERENCES date_matches(id) ON DELETE CASCADE;
ALTER TABLE bot_outbox ADD COLUMN date_message_id uuid REFERENCES date_messages(id) ON DELETE CASCADE;
ALTER TABLE bot_outbox DROP CONSTRAINT bot_outbox_kind_check;
ALTER TABLE bot_outbox ADD CONSTRAINT bot_outbox_kind_check
  CHECK(kind IN ('notification','reply','relay','reminder','dm_request','dm_relay','dm_accept','application','topic_init','date_topic','date_relay'));
