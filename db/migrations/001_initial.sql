CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'pending_invite' CHECK (status IN ('pending_invite','onboarding','active','blocked')),
  locale text NOT NULL DEFAULT 'en',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE telegram_accounts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  telegram_user_id bigint NOT NULL UNIQUE CHECK (telegram_user_id > 0),
  bot_started_at timestamptz
);
CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);
CREATE INDEX sessions_expiry_idx ON sessions(expires_at);
CREATE TABLE invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  redeemed_by uuid UNIQUE REFERENCES users(id),
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((redeemed_by IS NULL) = (redeemed_at IS NULL))
);
CREATE TABLE user_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('adult','terms','ai_interview')),
  document_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, kind, document_version)
);
CREATE TABLE avatar_presets (
  id text PRIMARY KEY,
  label_key text NOT NULL,
  asset_key text NOT NULL,
  asset_version integer NOT NULL DEFAULT 1,
  sort_order integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE tags (
  code text PRIMARY KEY,
  emoji text NOT NULL,
  sort_order integer NOT NULL,
  is_active boolean NOT NULL DEFAULT true
);
CREATE TABLE tag_translations (
  tag_id text NOT NULL REFERENCES tags(code) ON DELETE CASCADE,
  locale text NOT NULL,
  label text NOT NULL,
  PRIMARY KEY(tag_id, locale)
);
CREATE TABLE profile_drafts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  avatar_preset_id text REFERENCES avatar_presets(id),
  intro_markdown text NOT NULL DEFAULT '',
  tags jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(tags) = 'array'),
  mode text NOT NULL DEFAULT 'manual' CHECK (mode IN ('manual','interview')),
  current_step text NOT NULL DEFAULT 'avatar' CHECK (current_step IN ('avatar','bio','review')),
  schema_version integer NOT NULL DEFAULT 1,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 2 AND 40),
  avatar_preset_id text NOT NULL REFERENCES avatar_presets(id),
  intro_markdown text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1,
  completed_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE profile_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  tag_id text REFERENCES tags(code),
  custom_label text,
  custom_emoji text,
  locale text,
  position integer NOT NULL CHECK (position >= 0),
  UNIQUE(user_id, position),
  CHECK (
    (tag_id IS NOT NULL AND custom_label IS NULL AND custom_emoji IS NULL AND locale IS NULL)
    OR
    (tag_id IS NULL AND custom_label IS NOT NULL AND custom_emoji IS NOT NULL AND locale IS NOT NULL
      AND char_length(custom_label) BETWEEN 1 AND 40)
  )
);
CREATE UNIQUE INDEX profile_catalog_tag_unique ON profile_tags(user_id, tag_id) WHERE tag_id IS NOT NULL;
CREATE UNIQUE INDEX profile_custom_tag_unique ON profile_tags(user_id, lower(custom_label)) WHERE custom_label IS NOT NULL;
CREATE TABLE profile_answers (
  user_id uuid NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,
  question_key text NOT NULL,
  answer_text text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, question_key)
);
CREATE TABLE ai_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  locale text NOT NULL DEFAULT 'en',
  mode text NOT NULL CHECK (mode IN ('demo','openai')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_active_conversation ON ai_conversations(user_id) WHERE status = 'active';
CREATE TABLE ai_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  role text NOT NULL CHECK (role IN ('user','assistant')),
  content text NOT NULL,
  request_id uuid,
  reply_to uuid UNIQUE REFERENCES ai_messages(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conversation_id, request_id)
);
CREATE INDEX ai_messages_conversation_idx ON ai_messages(conversation_id, sequence);
CREATE TABLE ai_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
  based_on_draft_revision integer NOT NULL,
  intro_markdown text NOT NULL,
  suggested_tags jsonb NOT NULL DEFAULT '[]',
  source_map jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ai_proposals_user_idx ON ai_proposals(user_id, created_at DESC);
CREATE TABLE bot_updates (
  update_id bigint PRIMARY KEY,
  processed_at timestamptz NOT NULL DEFAULT now()
);
