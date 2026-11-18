CREATE TABLE event_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 3 AND 160),
  description_markdown text NOT NULL CHECK (length(btrim(description_markdown)) BETWEEN 10 AND 12000),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  time_zone text NOT NULL,
  city_location_id text NOT NULL REFERENCES locations(id),
  place_id uuid REFERENCES places(id) ON DELETE RESTRICT,
  maps_url text,
  source_url text NOT NULL,
  organizer_name text NOT NULL CHECK (length(btrim(organizer_name)) BETWEEN 2 AND 160),
  community_id text REFERENCES communities(id),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','cancelled')),
  revision integer NOT NULL DEFAULT 0,
  last_checked_at timestamptz,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (num_nonnulls(place_id,maps_url) = 1)
);
CREATE INDEX event_listings_current ON event_listings(starts_at,city_location_id) WHERE status='published';
CREATE INDEX event_listings_community ON event_listings(community_id,starts_at) WHERE status='published';
CREATE FUNCTION check_listing_city() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM locations WHERE id=NEW.city_location_id AND kind='city') THEN
    RAISE EXCEPTION 'An event listing needs a city' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER listing_city BEFORE INSERT OR UPDATE OF city_location_id ON event_listings FOR EACH ROW EXECUTE FUNCTION check_listing_city();
CREATE TABLE event_listing_versions (
  listing_id uuid NOT NULL REFERENCES event_listings(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  changed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  snapshot jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (listing_id,revision)
);
ALTER TABLE events ADD COLUMN event_listing_id uuid REFERENCES event_listings(id) ON DELETE SET NULL;
CREATE INDEX events_listing ON events(event_listing_id,starts_at) WHERE event_listing_id IS NOT NULL;
