ALTER TABLE events ADD COLUMN activity_summary text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN district text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN cost_estimate text NOT NULL DEFAULT 'Ask host';
ALTER TABLE events ADD COLUMN experience_notes text NOT NULL DEFAULT 'Ask host';
ALTER TABLE events ADD COLUMN online_platform text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN recruitment_open boolean NOT NULL DEFAULT true;

-- Earlier POC descriptions sometimes held call URLs. Preserve those URLs for the
-- accepted party before removing them from public event text.
UPDATE event_private_details d SET meeting_details = d.meeting_details || E'\n' || links.urls
FROM (
  SELECT e.id, string_agg(found.link[1], E'\n') AS urls
  FROM events e CROSS JOIN LATERAL regexp_matches(e.description_markdown, '(https?://|www[.]|([[:alnum:]-]+[.])+[[:alpha:]]{2,}/)[^[:space:]<>)]*', 'gi') AS found(link)
  GROUP BY e.id
) links WHERE d.event_id = links.id;
UPDATE events SET description_markdown = regexp_replace(description_markdown,
  '(https?://|www[.]|([[:alnum:]-]+[.])+[[:alpha:]]{2,}/)[^[:space:]<>)]*', '[private link in meeting details]', 'gi');

-- Earlier POC events remain readable; hosts can fill in the new fields on edit.
UPDATE events SET activity_summary = left(regexp_replace(trim(description_markdown), '[[:space:]]+', ' ', 'g'), 240)
 WHERE activity_summary = '';
