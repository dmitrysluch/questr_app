CREATE TABLE date_settings (
  user_id uuid PRIMARY KEY REFERENCES profiles(user_id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  paused boolean NOT NULL DEFAULT false,
  consent_version text,
  revision integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE date_photos (
  user_id uuid PRIMARY KEY REFERENCES profiles(user_id) ON DELETE CASCADE,
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  object_key text NOT NULL UNIQUE,
  thumbnail_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((reviewed_by IS NULL) = (reviewed_at IS NULL))
);

CREATE TABLE date_photo_deletions (
  object_key text PRIMARY KEY,
  queued_at timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0
);

CREATE TABLE dates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES profiles(user_id),
  title text NOT NULL CHECK(char_length(trim(title)) BETWEEN 3 AND 100),
  description text NOT NULL CHECK(char_length(trim(description)) BETWEEN 10 AND 2000),
  location_id text NOT NULL REFERENCES locations(id),
  language_code text NOT NULL REFERENCES languages(code),
  community_id text REFERENCES communities(id),
  time_zone text NOT NULL,
  cost_note text NOT NULL DEFAULT '',
  private_place text NOT NULL DEFAULT '',
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id,request_id)
);

CREATE TABLE date_rounds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_id uuid NOT NULL REFERENCES dates(id) ON DELETE CASCADE,
  number integer NOT NULL CHECK(number>0),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','matched','scheduled','completed','cancelled','expired')),
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(date_id,number), UNIQUE(date_id,request_id)
);
CREATE UNIQUE INDEX one_live_date_round ON date_rounds(date_id) WHERE status IN ('open','matched','scheduled');

CREATE TABLE date_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES date_rounds(id) ON DELETE CASCADE,
  local_day date NOT NULL,
  period text NOT NULL CHECK(period IN ('morning','day','evening')),
  UNIQUE(round_id,local_day,period)
);

CREATE TABLE date_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL REFERENCES date_rounds(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(user_id),
  message text NOT NULL CHECK(char_length(trim(message)) BETWEEN 20 AND 300),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','withdrawn','declined','matched','closed_unmatched')),
  request_id uuid NOT NULL,
  request_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(round_id,user_id), UNIQUE(user_id,request_id)
);
CREATE INDEX date_response_limits ON date_responses(user_id,created_at);

CREATE TABLE date_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id uuid NOT NULL UNIQUE REFERENCES date_rounds(id) ON DELETE CASCADE,
  response_id uuid NOT NULL UNIQUE REFERENCES date_responses(id),
  proposed_window_id uuid REFERENCES date_windows(id),
  proposed_by uuid REFERENCES profiles(user_id),
  proposed_start timestamptz,
  duration_minutes integer CHECK(duration_minutes BETWEEN 30 AND 480),
  confirmed_at timestamptz,
  cancelled_by uuid REFERENCES profiles(user_id),
  cancellation_reason text CHECK(cancellation_reason IN ('plans_changed','unavailable','other')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK((proposed_start IS NULL) = (duration_minutes IS NULL)),
  CHECK(confirmed_at IS NULL OR proposed_start IS NOT NULL)
);

CREATE TABLE date_time_votes (
  match_id uuid NOT NULL REFERENCES date_matches(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(user_id),
  window_id uuid NOT NULL REFERENCES date_windows(id),
  PRIMARY KEY(match_id,user_id,window_id)
);

CREATE TABLE date_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id uuid NOT NULL REFERENCES date_matches(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES profiles(user_id),
  body text NOT NULL CHECK(char_length(trim(body)) BETWEEN 1 AND 2000),
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(sender_id,request_id)
);
CREATE INDEX date_messages_match ON date_messages(match_id,created_at,id);

CREATE TABLE date_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  round_id uuid NOT NULL REFERENCES date_rounds(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
