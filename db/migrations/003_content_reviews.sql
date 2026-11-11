CREATE TABLE content_reviews (
  content_hash text NOT NULL,
  reviewer_key text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(content_hash, reviewer_key)
);
ALTER TABLE ai_messages ADD COLUMN content_review jsonb;
ALTER TABLE ai_messages ADD COLUMN review_version text;
UPDATE ai_proposals SET status='rejected',updated_at=now() WHERE status='pending';
