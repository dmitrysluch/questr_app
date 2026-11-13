ALTER TABLE users ADD COLUMN locale_source text NOT NULL DEFAULT 'auto'
  CHECK (locale_source IN ('auto', 'manual'));
