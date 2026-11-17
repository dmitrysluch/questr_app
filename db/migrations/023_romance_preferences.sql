-- Previous opt-ins are not informed consent for category-based matching.
UPDATE profiles SET open_to_romance=false WHERE open_to_romance;
UPDATE profile_drafts SET open_to_romance=false WHERE open_to_romance;

CREATE TABLE romance_preferences (
  user_id uuid PRIMARY KEY REFERENCES profiles(user_id) ON DELETE CASCADE,
  gender_code text NOT NULL CHECK (gender_code IN ('woman','man','nonbinary','another_gender')),
  interested_in text[] NOT NULL CHECK (
    cardinality(interested_in) BETWEEN 1 AND 4
    AND interested_in <@ ARRAY['woman','man','nonbinary','another_gender']::text[]
    AND array_position(interested_in,NULL) IS NULL
  ),
  consent_version text NOT NULL,
  consented_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
