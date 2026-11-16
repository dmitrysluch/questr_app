-- A DM belongs to two people. Adventures only explain how they met.
CREATE TEMP TABLE dm_pair_merge ON COMMIT DROP AS
SELECT c.id AS old_id,
  first_value(c.id) OVER (PARTITION BY c.first_user_id,c.second_user_id ORDER BY
    CASE c.status WHEN 'accepted' THEN 0 WHEN 'pending' THEN 1 WHEN 'declined' THEN 2 WHEN 'draft' THEN 3 ELSE 4 END,
    c.created_at,c.id) AS canonical_id,
  c.status,c.event_id,c.created_at
FROM dm_conversations c;

CREATE TABLE dm_conversation_events (
  conversation_id uuid NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id,event_id)
);
INSERT INTO dm_conversation_events(conversation_id,event_id)
  SELECT DISTINCT canonical_id,event_id FROM dm_pair_merge WHERE event_id IS NOT NULL;

-- Keep one existing topic per person as the destination. Other topics retain
-- their Telegram history and will point to that destination when used.
CREATE TEMP TABLE dm_preferred_topics ON COMMIT DROP AS
SELECT DISTINCT ON (m.canonical_id,t.user_id)
  m.canonical_id,t.user_id,t.thread_id
FROM dm_bot_topics t JOIN dm_pair_merge m ON m.old_id=t.conversation_id
ORDER BY m.canonical_id,t.user_id,(t.conversation_id=m.canonical_id) DESC,
  CASE m.status WHEN 'accepted' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,t.thread_id;

CREATE TABLE dm_topic_redirects (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_id bigint NOT NULL,
  conversation_id uuid NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id,thread_id)
);
CREATE TABLE dm_conversation_aliases (
  legacy_id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE
);
INSERT INTO dm_conversation_aliases(legacy_id,conversation_id)
SELECT old_id,canonical_id FROM dm_pair_merge WHERE old_id<>canonical_id;
INSERT INTO dm_topic_redirects(user_id,thread_id,conversation_id)
SELECT t.user_id,t.thread_id,m.canonical_id
FROM dm_bot_topics t JOIN dm_pair_merge m ON m.old_id=t.conversation_id
LEFT JOIN dm_preferred_topics p ON p.canonical_id=m.canonical_id AND p.user_id=t.user_id AND p.thread_id=t.thread_id
WHERE p.thread_id IS NULL;

DELETE FROM dm_bot_topics t USING dm_pair_merge m
WHERE t.conversation_id=m.old_id AND m.old_id<>m.canonical_id;
INSERT INTO dm_bot_topics(conversation_id,user_id,thread_id)
SELECT canonical_id,user_id,thread_id FROM dm_preferred_topics
ON CONFLICT(conversation_id,user_id) DO NOTHING;

UPDATE dm_messages msg SET conversation_id=m.canonical_id
FROM dm_pair_merge m WHERE msg.conversation_id=m.old_id AND m.old_id<>m.canonical_id;
-- Only the chosen request remains actionable when several old adventures have
-- pending consent prompts for the same pair.
UPDATE bot_outbox o SET state='discarded'
FROM dm_pair_merge m WHERE o.dm_id=m.old_id AND m.old_id<>m.canonical_id
  AND o.state='pending' AND o.kind IN ('dm_request','dm_accept');
UPDATE bot_outbox o SET dm_id=m.canonical_id
FROM dm_pair_merge m WHERE o.dm_id=m.old_id AND m.old_id<>m.canonical_id;

-- Blocking anywhere takes precedence. Otherwise preserve an accepted chat,
-- then a pending request, then a refusal, then a draft.
UPDATE dm_conversations c SET status='blocked',updated_at=now()
WHERE EXISTS (SELECT 1 FROM dm_pair_merge m WHERE m.canonical_id=c.id AND m.status='blocked');
DELETE FROM dm_conversations c USING dm_pair_merge m
WHERE c.id=m.old_id AND m.old_id<>m.canonical_id;

ALTER TABLE dm_conversations DROP CONSTRAINT dm_conversations_event_id_first_user_id_second_user_id_key;
ALTER TABLE dm_conversations ADD CONSTRAINT dm_conversations_pair_key UNIQUE(first_user_id,second_user_id);
ALTER TABLE dm_conversations DROP CONSTRAINT dm_conversations_event_id_fkey;
ALTER TABLE dm_conversations ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE dm_conversations ADD CONSTRAINT dm_conversations_event_id_fkey
  FOREIGN KEY(event_id) REFERENCES events(id) ON DELETE SET NULL;

ALTER TABLE dm_bot_topics ADD COLUMN name_synced boolean NOT NULL DEFAULT false;
ALTER TABLE bot_outbox ADD COLUMN target_thread_id bigint CHECK(target_thread_id>0);
