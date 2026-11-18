ALTER TABLE event_listings ADD COLUMN venue_name text;
ALTER TABLE event_listings ADD CONSTRAINT event_listings_venue_name CHECK (
  (maps_url IS NULL AND venue_name IS NULL) OR
  (maps_url IS NOT NULL AND venue_name IS NOT NULL AND length(btrim(venue_name)) BETWEEN 2 AND 160)
);
