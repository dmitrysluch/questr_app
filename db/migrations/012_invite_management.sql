ALTER TABLE invites ADD COLUMN issuance_request_id uuid;
CREATE UNIQUE INDEX invites_issuance_request_unique ON invites(created_by, issuance_request_id)
  WHERE issuance_request_id IS NOT NULL;

-- Administrators use the same issuance budget as inviters; they can adjust it
-- explicitly in the admin UI. Existing member budgets already default to 3/week.
INSERT INTO role_capabilities(role_code,capability,own_profile_only)
VALUES('admin','invite.create',false) ON CONFLICT DO NOTHING;
