ALTER TABLE bot_outbox DROP CONSTRAINT bot_outbox_kind_check;
ALTER TABLE bot_outbox ADD CONSTRAINT bot_outbox_kind_check
  CHECK(kind IN ('notification','reply','relay','reminder','dm_request','dm_relay','dm_accept','application','topic_init'));

-- Existing parties need a topic too; new memberships are queued by the app.
INSERT INTO bot_outbox(dedupe_key,user_id,event_id,body,kind,in_topic)
SELECT 'event:' || e.id || ':topic:' || m.user_id,m.user_id,e.id,
  CASE WHEN u.locale='ru' THEN '«' || e.title || E'»\n\nПиши в этой теме группе вылазки. Сообщения проверяются на откровенно сексуальный контент.'
       ELSE e.title || E'\n\nWrite here to the adventure party. Messages are checked for explicit sexual content.' END,
  'topic_init',true
FROM event_memberships m JOIN events e ON e.id=m.event_id JOIN users u ON u.id=m.user_id
JOIN telegram_accounts t ON t.user_id=m.user_id AND t.bot_started_at IS NOT NULL
WHERE m.status='accepted' AND e.status='published' AND u.status='active'
  AND NOT EXISTS(SELECT 1 FROM event_bot_topics topic WHERE topic.event_id=e.id AND topic.user_id=m.user_id)
ON CONFLICT(dedupe_key) DO NOTHING;
