ALTER TABLE profile_drafts DROP CONSTRAINT profile_drafts_current_step_check;
ALTER TABLE profile_drafts ADD CONSTRAINT profile_drafts_current_step_check
  CHECK (current_step IN ('avatar', 'bio', 'discovery', 'review'));
