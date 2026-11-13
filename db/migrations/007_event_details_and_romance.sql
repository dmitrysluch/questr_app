ALTER TABLE events ADD COLUMN ends_at timestamptz;
UPDATE events SET ends_at = starts_at + interval '2 hours';
ALTER TABLE events ALTER COLUMN ends_at SET NOT NULL;
ALTER TABLE events ADD CONSTRAINT events_end_after_start CHECK (ends_at > starts_at);

ALTER TABLE event_private_details ADD COLUMN meeting_map_url text NOT NULL DEFAULT '';

ALTER TABLE profile_drafts ADD COLUMN open_to_romance boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN open_to_romance boolean NOT NULL DEFAULT false;

CREATE TABLE event_reminders (
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  minutes_before integer NOT NULL CHECK (minutes_before IN (15, 60, 1440)),
  schedule_id uuid NOT NULL DEFAULT gen_random_uuid(),
  queued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(event_id, user_id)
);
CREATE INDEX event_reminders_due ON event_reminders(event_id, minutes_before) WHERE queued_at IS NULL;

ALTER TABLE bot_outbox DROP CONSTRAINT bot_outbox_kind_check;
ALTER TABLE bot_outbox ADD CONSTRAINT bot_outbox_kind_check CHECK (kind IN ('notification', 'reply', 'relay', 'reminder'));
