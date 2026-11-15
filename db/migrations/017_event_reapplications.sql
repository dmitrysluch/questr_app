ALTER TABLE event_memberships ADD COLUMN application_attempt_id uuid;
ALTER TABLE bot_outbox ADD COLUMN application_attempt_id uuid;
