ALTER TABLE ai_messages ADD COLUMN kind text NOT NULL DEFAULT 'text'
  CHECK (kind IN ('text', 'change_topic'));
ALTER TABLE ai_messages ADD CONSTRAINT topic_changes_are_user_actions
  CHECK (kind = 'text' OR role = 'user');
