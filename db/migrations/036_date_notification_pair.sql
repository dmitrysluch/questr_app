ALTER TABLE bot_outbox ADD COLUMN date_other_user_id uuid REFERENCES users(id) ON DELETE SET NULL;
