-- Event creation is an assignable role. Preserve access for existing members.
INSERT INTO roles(code) VALUES ('event_creator') ON CONFLICT DO NOTHING;
INSERT INTO role_capabilities(role_code,capability,own_profile_only)
VALUES ('event_creator','events.create',false) ON CONFLICT DO NOTHING;
INSERT INTO role_assignments(user_id,role_code,location_id,reason)
SELECT DISTINCT a.user_id,'event_creator',a.location_id,'Existing event creation access'
FROM role_assignments a JOIN users u ON u.id=a.user_id
WHERE a.role_code='member' AND a.revoked_at IS NULL AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now())
  AND u.status IN ('onboarding','active')
  AND NOT EXISTS (SELECT 1 FROM role_assignments x WHERE x.user_id=a.user_id AND x.role_code='event_creator'
    AND x.location_id IS NOT DISTINCT FROM a.location_id AND x.revoked_at IS NULL);
DELETE FROM role_capabilities WHERE role_code='member' AND capability='events.create';

-- The number of inviter generations including the invite recipient.
-- Zero means the recipient cannot issue invitations.
ALTER TABLE invites ADD COLUMN grants_event_creation boolean NOT NULL DEFAULT true;
ALTER TABLE invites ADD COLUMN invite_depth integer NOT NULL DEFAULT 0 CHECK (invite_depth BETWEEN 0 AND 2);
ALTER TABLE invites ADD COLUMN expiry_days integer;
UPDATE invites SET expiry_days=GREATEST(1,LEAST(30,ROUND(EXTRACT(EPOCH FROM (expires_at-created_at))/86400)::integer));
ALTER TABLE invites ALTER COLUMN expiry_days SET DEFAULT 7;
ALTER TABLE invites ALTER COLUMN expiry_days SET NOT NULL;
ALTER TABLE invites ADD CONSTRAINT invites_expiry_days_range CHECK (expiry_days BETWEEN 1 AND 30);
ALTER TABLE role_assignments ADD COLUMN invite_depth integer NOT NULL DEFAULT 1 CHECK (invite_depth BETWEEN 1 AND 2);
