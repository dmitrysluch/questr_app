ALTER TABLE ai_conversations DROP CONSTRAINT ai_conversations_mode_check;
-- Keep the old provider value for historical rows; new requests use OpenRouter.
ALTER TABLE ai_conversations ADD CONSTRAINT ai_conversations_mode_check CHECK (mode IN ('demo', 'openai', 'openrouter'));
ALTER TABLE ai_proposals ADD COLUMN base_markdown text NOT NULL DEFAULT '';
ALTER TABLE ai_proposals ADD COLUMN change_summary text NOT NULL DEFAULT '';
ALTER TABLE ai_proposals ADD COLUMN source_ids jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(source_ids) = 'array');
-- Existing accepted profiles and conversations remain intact. Old pending proposals
-- predate the editable-prose review contract and must be generated again.
UPDATE ai_proposals SET status='rejected',updated_at=now() WHERE status='pending';
