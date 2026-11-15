ALTER TABLE profile_drafts ADD COLUMN IF NOT EXISTS avatar_appearance jsonb
  CHECK (avatar_appearance IS NULL OR jsonb_typeof(avatar_appearance) = 'object');
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_appearance jsonb
  CHECK (avatar_appearance IS NULL OR jsonb_typeof(avatar_appearance) = 'object');
