CREATE TABLE date_blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(blocker_id,blocked_id),
  CHECK(blocker_id<>blocked_id)
);

CREATE TABLE date_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date_id uuid NOT NULL REFERENCES dates(id) ON DELETE CASCADE,
  round_id uuid NOT NULL REFERENCES date_rounds(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES users(id),
  target_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL CHECK(reason IN ('photo','harassment','safety','other')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','dismissed','photo_removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  UNIQUE(round_id,reporter_id,target_id,reason),
  CHECK(reporter_id<>target_id)
);
CREATE INDEX date_reports_pending ON date_reports(created_at) WHERE status='pending';
