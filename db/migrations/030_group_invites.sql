ALTER TABLE invites ADD COLUMN max_redemptions integer NOT NULL DEFAULT 1 CHECK (max_redemptions BETWEEN 1 AND 20);
ALTER TABLE invites ADD COLUMN redemption_count integer NOT NULL DEFAULT 0 CHECK (redemption_count >= 0 AND redemption_count <= max_redemptions);

CREATE TABLE invite_redemptions (
  invite_id uuid NOT NULL REFERENCES invites(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (invite_id, user_id)
);
CREATE INDEX invite_redemptions_user_idx ON invite_redemptions(user_id);

INSERT INTO invite_redemptions(invite_id,user_id,redeemed_at)
  SELECT id,redeemed_by,redeemed_at FROM invites WHERE redeemed_by IS NOT NULL;
UPDATE invites SET redemption_count=1 WHERE redeemed_by IS NOT NULL;

ALTER TABLE capability_usage ADD COLUMN cost integer NOT NULL DEFAULT 1 CHECK (cost > 0);
