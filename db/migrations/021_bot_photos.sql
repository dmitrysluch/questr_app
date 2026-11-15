ALTER TABLE bot_inbox ADD COLUMN photo_file_id text CHECK (length(photo_file_id) BETWEEN 1 AND 1024);

ALTER TABLE event_messages ADD COLUMN photo_file_id text CHECK (length(photo_file_id) BETWEEN 1 AND 1024);
ALTER TABLE event_messages DROP CONSTRAINT event_messages_body_check;
ALTER TABLE event_messages ADD CONSTRAINT event_messages_body_check
  CHECK ((photo_file_id IS NULL AND length(body) BETWEEN 1 AND 3000)
    OR (photo_file_id IS NOT NULL AND length(body) <= 900));

ALTER TABLE dm_messages ADD COLUMN photo_file_id text CHECK (length(photo_file_id) BETWEEN 1 AND 1024);
ALTER TABLE dm_messages DROP CONSTRAINT dm_messages_body_check;
ALTER TABLE dm_messages ADD CONSTRAINT dm_messages_body_check
  CHECK ((photo_file_id IS NULL AND length(body) BETWEEN 1 AND 3000)
    OR (photo_file_id IS NOT NULL AND length(body) <= 900));

UPDATE bot_outbox o SET body = CASE WHEN u.locale='ru'
  THEN '«' || e.title || E'»\n\nТекст и подписи к фото проверяются перед доставкой. Сами фото пока не проверяются. Детали встречи — в QUESTR.'
  ELSE e.title || E'\n\nText and photo captions are checked before delivery. Photos themselves are not checked yet. Open QUESTR for meeting details.' END
FROM events e, users u
WHERE o.event_id=e.id AND o.user_id=u.id AND o.kind='topic_init' AND o.state='pending';
