ALTER TABLE bot_outbox ADD COLUMN application_user_id uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE bot_outbox DROP CONSTRAINT bot_outbox_kind_check;
ALTER TABLE bot_outbox ADD CONSTRAINT bot_outbox_kind_check
  CHECK(kind IN ('notification','reply','relay','reminder','dm_request','dm_relay','dm_accept','application'));
ALTER TABLE bot_inbox ADD COLUMN callback_query_id text;
ALTER TABLE bot_inbox ADD COLUMN callback_data text;
ALTER TABLE bot_inbox ADD COLUMN callback_message_id bigint;
