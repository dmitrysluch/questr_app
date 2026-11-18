ALTER TABLE discovery_preferences
  ADD COLUMN community_filter_mode text NOT NULL DEFAULT 'all'
    CHECK (community_filter_mode IN ('all', 'mine', 'community')),
  ADD COLUMN community_filter_id text REFERENCES communities(id),
  ADD CONSTRAINT discovery_community_filter_check CHECK (
    (community_filter_mode = 'community' AND community_filter_id IS NOT NULL)
    OR (community_filter_mode <> 'community' AND community_filter_id IS NULL)
  );
