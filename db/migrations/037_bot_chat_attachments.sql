ALTER TABLE bot_inbox ADD COLUMN document_file_id text CHECK (length(document_file_id) BETWEEN 1 AND 1024);
ALTER TABLE bot_inbox ADD CONSTRAINT bot_inbox_single_attachment CHECK (num_nonnulls(photo_file_id, document_file_id) <= 1);

ALTER TABLE event_messages ADD COLUMN document_file_id text CHECK (length(document_file_id) BETWEEN 1 AND 1024);
ALTER TABLE event_messages ADD CONSTRAINT event_messages_single_attachment CHECK (num_nonnulls(photo_file_id, document_file_id) <= 1);
ALTER TABLE event_messages DROP CONSTRAINT event_messages_body_check;
ALTER TABLE event_messages ADD CONSTRAINT event_messages_body_check
  CHECK ((photo_file_id IS NULL AND document_file_id IS NULL AND length(body) BETWEEN 1 AND 3000)
    OR (num_nonnulls(photo_file_id, document_file_id) = 1 AND length(body) <= 900));

ALTER TABLE dm_messages ADD COLUMN document_file_id text CHECK (length(document_file_id) BETWEEN 1 AND 1024);
ALTER TABLE dm_messages ADD CONSTRAINT dm_messages_single_attachment CHECK (num_nonnulls(photo_file_id, document_file_id) <= 1);
ALTER TABLE dm_messages DROP CONSTRAINT dm_messages_body_check;
ALTER TABLE dm_messages ADD CONSTRAINT dm_messages_body_check
  CHECK ((photo_file_id IS NULL AND document_file_id IS NULL AND length(body) BETWEEN 1 AND 3000)
    OR (num_nonnulls(photo_file_id, document_file_id) = 1 AND length(body) <= 900));

ALTER TABLE date_messages ADD COLUMN photo_file_id text CHECK (length(photo_file_id) BETWEEN 1 AND 1024);
ALTER TABLE date_messages ADD COLUMN document_file_id text CHECK (length(document_file_id) BETWEEN 1 AND 1024);
ALTER TABLE date_messages ADD CONSTRAINT date_messages_single_attachment CHECK (num_nonnulls(photo_file_id, document_file_id) <= 1);
ALTER TABLE date_messages DROP CONSTRAINT date_messages_body_check;
ALTER TABLE date_messages ADD CONSTRAINT date_messages_body_check
  CHECK ((photo_file_id IS NULL AND document_file_id IS NULL AND char_length(trim(body)) BETWEEN 1 AND 2000)
    OR (num_nonnulls(photo_file_id, document_file_id) = 1 AND length(body) <= 900));
