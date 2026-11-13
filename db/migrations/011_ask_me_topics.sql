ALTER TABLE profile_drafts ADD COLUMN ask_me_topics jsonb NOT NULL DEFAULT '[]'
  CHECK (jsonb_typeof(ask_me_topics) = 'array' AND jsonb_array_length(ask_me_topics) <= 3);
ALTER TABLE profiles ADD COLUMN ask_me_topics jsonb NOT NULL DEFAULT '[]'
  CHECK (jsonb_typeof(ask_me_topics) = 'array' AND jsonb_array_length(ask_me_topics) <= 3);
ALTER TABLE ai_proposals ADD COLUMN suggested_ask_me_topics jsonb NOT NULL DEFAULT '[]'
  CHECK (jsonb_typeof(suggested_ask_me_topics) = 'array' AND jsonb_array_length(suggested_ask_me_topics) <= 3);
