ALTER TABLE bot_outbox DROP CONSTRAINT bot_outbox_kind_check;
ALTER TABLE bot_outbox ADD CONSTRAINT bot_outbox_kind_check
  CHECK(kind IN ('notification','reply','relay','reminder','dm_request','dm_relay','dm_accept'));
