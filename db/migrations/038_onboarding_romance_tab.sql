ALTER TABLE profile_drafts DROP CONSTRAINT profile_drafts_current_step_check;
ALTER TABLE profile_drafts ADD CONSTRAINT profile_drafts_current_step_check
  CHECK (current_step IN ('avatar', 'bio', 'discovery', 'romance', 'review'));

-- Romance can be configured while a character is still being created.
ALTER TABLE romance_preferences DROP CONSTRAINT romance_preferences_user_id_fkey;
ALTER TABLE romance_preferences ADD CONSTRAINT romance_preferences_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE romance_preferences ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK (revision > 0);
