CREATE TABLE languages (code text PRIMARY KEY, label text NOT NULL);
CREATE TABLE locations (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('country','city','online')),
  parent_id text REFERENCES locations(id),
  population bigint NOT NULL DEFAULT 0,
  search_text text NOT NULL,
  CHECK ((kind='city' AND parent_id IS NOT NULL) OR (kind IN ('country','online') AND parent_id IS NULL)),
  CHECK ((kind='online' AND id='online') OR (kind='country' AND id ~ '^country:[A-Z]{2}$') OR (kind='city' AND id ~ '^city:[0-9]+$'))
);
CREATE INDEX locations_parent ON locations(parent_id);
CREATE FUNCTION check_location_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind='city' AND NOT EXISTS(SELECT 1 FROM locations WHERE id=NEW.parent_id AND kind='country') THEN
    RAISE EXCEPTION 'A city must belong to a country' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER location_parent BEFORE INSERT OR UPDATE ON locations FOR EACH ROW EXECUTE FUNCTION check_location_parent();

ALTER TABLE profile_drafts ADD COLUMN spoken_languages text[] NOT NULL DEFAULT '{}';
CREATE TABLE profile_languages (
  user_id uuid REFERENCES profiles(user_id) ON DELETE CASCADE,
  language_code text REFERENCES languages(code),
  position integer NOT NULL CHECK(position>=0),
  PRIMARY KEY(user_id,language_code), UNIQUE(user_id,position)
);
CREATE TABLE discovery_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO discovery_preferences(user_id) SELECT id FROM users;
CREATE TABLE discovery_locations (
  user_id uuid REFERENCES discovery_preferences(user_id) ON DELETE CASCADE,
  location_id text REFERENCES locations(id),
  PRIMARY KEY(user_id,location_id)
);
CREATE TABLE discovery_languages (
  user_id uuid REFERENCES discovery_preferences(user_id) ON DELETE CASCADE,
  language_code text REFERENCES languages(code),
  PRIMARY KEY(user_id,language_code)
);

-- Event foundation; event publishing, applications and chat are a later feature.
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES profiles(user_id),
  title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 160),
  location_id text NOT NULL REFERENCES locations(id),
  language_code text NOT NULL REFERENCES languages(code),
  starts_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','cancelled','completed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_discovery ON events(location_id,language_code,starts_at) WHERE status='published';
CREATE FUNCTION check_event_location() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM locations WHERE id=NEW.location_id AND kind IN ('city','online')) THEN
    RAISE EXCEPTION 'An event needs a city or Online' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER event_location BEFORE INSERT OR UPDATE OF location_id ON events FOR EACH ROW EXECUTE FUNCTION check_event_location();

CREATE TABLE roles (code text PRIMARY KEY);
CREATE TABLE role_capabilities (
  role_code text REFERENCES roles(code) ON DELETE CASCADE,
  capability text NOT NULL,
  own_profile_only boolean NOT NULL DEFAULT false,
  PRIMARY KEY(role_code,capability)
);
CREATE TABLE role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_code text NOT NULL REFERENCES roles(code),
  location_id text REFERENCES locations(id),
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES profiles(user_id) ON DELETE CASCADE,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  revoked_at timestamptz,
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reason text NOT NULL,
  CHECK(num_nonnulls(location_id,event_id,profile_id)<=1),
  CHECK(role_code NOT IN ('organizer','participant','event_moderator') OR event_id IS NOT NULL),
  CHECK(role_code NOT IN ('admin','inviter') OR num_nonnulls(location_id,event_id,profile_id)=0),
  CHECK(valid_until IS NULL OR valid_until>valid_from)
);
CREATE INDEX role_assignments_user ON role_assignments(user_id) WHERE revoked_at IS NULL;
INSERT INTO roles(code) VALUES ('member'),('organizer'),('participant'),('event_moderator'),('inviter'),('admin');
INSERT INTO role_capabilities(role_code,capability,own_profile_only) VALUES
 ('member','profile.view',true),('member','profile.edit',true),
 ('member','events.view',false),('member','events.create',false),
 ('organizer','events.view',false),('organizer','events.edit',false),('organizer','events.accept',false),
 ('organizer','events.group_chat',false),('organizer','events.group_chat_moderator',false),
 ('participant','events.view',false),('participant','events.group_chat',false),
 ('event_moderator','events.group_chat_moderator',false),
 ('inviter','invite.create',false),('admin','admin',false);
INSERT INTO role_assignments(user_id,role_code,reason)
 SELECT id,'member','Invited member; initial migration' FROM users WHERE status IN ('onboarding','active');

-- One budget per actor and capability: overlapping grants cannot multiply it.
-- Limits can change without deleting usage history or resetting the period.
CREATE TABLE capability_budgets (
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  capability text NOT NULL,
  max_uses integer NOT NULL CHECK(max_uses>=0),
  window_seconds integer NOT NULL CHECK(window_seconds>0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,capability)
);
CREATE TABLE capability_usage (
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  capability text NOT NULL,
  request_id uuid NOT NULL,
  resource_key text NOT NULL,
  used_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,capability,request_id)
);
CREATE INDEX capability_usage_window ON capability_usage(user_id,capability,used_at);
INSERT INTO capability_budgets(user_id,capability,max_uses,window_seconds)
 SELECT id,'events.create',2,604800 FROM users WHERE status IN ('onboarding','active');
INSERT INTO capability_budgets(user_id,capability,max_uses,window_seconds)
 SELECT id,'invite.create',3,604800 FROM users WHERE status IN ('onboarding','active');
CREATE TABLE permission_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO permission_audit(user_id,action,details,reason)
 SELECT id,'role.granted','{"role":"member"}','Invited member; initial migration'
 FROM users WHERE status IN ('onboarding','active');
