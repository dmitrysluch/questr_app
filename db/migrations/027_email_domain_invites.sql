CREATE TABLE email_invite_domains (
  domain text PRIMARY KEY,
  allow_registration boolean NOT NULL DEFAULT false,
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE email_invite_domain_communities (
  domain text NOT NULL REFERENCES email_invite_domains(domain) ON DELETE CASCADE,
  community_id text NOT NULL REFERENCES communities(id),
  PRIMARY KEY (domain, community_id)
);
CREATE TABLE email_verification_challenges (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  domain text NOT NULL,
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  window_started_at timestamptz NOT NULL DEFAULT now(),
  send_count integer NOT NULL DEFAULT 1,
  attempts integer NOT NULL DEFAULT 0,
  used_at timestamptz,
  PRIMARY KEY (user_id, email)
);
CREATE INDEX email_verification_challenges_expiry_idx ON email_verification_challenges(expires_at);
CREATE TABLE verified_emails (
  email text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain text NOT NULL,
  invite_id uuid NOT NULL REFERENCES invites(id),
  registration_allowed boolean NOT NULL DEFAULT false,
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verified_emails_user_idx ON verified_emails(user_id);
