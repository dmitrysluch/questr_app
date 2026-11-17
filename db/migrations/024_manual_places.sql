CREATE TABLE places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city_location_id text NOT NULL REFERENCES locations(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  address text NOT NULL CHECK (length(btrim(address)) BETWEEN 3 AND 240),
  active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX places_city_active_name ON places(city_location_id, lower(name)) WHERE active;

ALTER TABLE events ADD COLUMN place_id uuid REFERENCES places(id) ON DELETE SET NULL;
CREATE INDEX events_place_upcoming ON events(place_id, starts_at) WHERE place_id IS NOT NULL;
