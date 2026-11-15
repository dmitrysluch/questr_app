ALTER TABLE dm_conversations ADD COLUMN purpose text NOT NULL DEFAULT 'chat'
  CHECK (purpose IN ('chat', 'contact'));
ALTER TABLE dm_messages ALTER COLUMN telegram_update_id DROP NOT NULL;
