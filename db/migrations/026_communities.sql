CREATE TABLE communities (
  id text PRIMARY KEY,
  parent_id text REFERENCES communities(id),
  name_en text NOT NULL,
  name_ru text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  CHECK (id <> parent_id)
);
CREATE TABLE community_closure (
  ancestor_id text NOT NULL REFERENCES communities(id),
  descendant_id text NOT NULL REFERENCES communities(id),
  depth integer NOT NULL CHECK (depth >= 0),
  PRIMARY KEY (ancestor_id, descendant_id)
);
CREATE INDEX community_closure_descendant_idx ON community_closure(descendant_id, ancestor_id);
CREATE TABLE invite_communities (
  invite_id uuid NOT NULL REFERENCES invites(id) ON DELETE CASCADE,
  community_id text NOT NULL REFERENCES communities(id),
  PRIMARY KEY (invite_id, community_id)
);
CREATE TABLE user_community_grants (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  community_id text NOT NULL REFERENCES communities(id),
  invite_id uuid NOT NULL REFERENCES invites(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, community_id, invite_id)
);
CREATE INDEX user_community_grants_member_idx ON user_community_grants(user_id, community_id);
ALTER TABLE invites DROP CONSTRAINT invites_redeemed_by_key;
ALTER TABLE role_assignments ADD COLUMN source_invite_id uuid REFERENCES invites(id);
ALTER TABLE events ADD COLUMN community_id text REFERENCES communities(id);
CREATE INDEX events_community_idx ON events(community_id) WHERE community_id IS NOT NULL;
