# Romance v1

Romance is optional and off by default. An active 18+ member can choose their own gender category and one or more categories for a mutual signal. Saving requires a separate, explicit consent. The choices live only in `romance_preferences`; they are not copied into the character, draft, event, or connection APIs. `GET /api/me/romance` is owner-only.

In an adventure roster, the server sends `romanceMatch: true` only to an accepted participant when both members have current consent and each selected the other's category. Applicants, outsiders, self, blocked accounts and one-sided choices do not get a heart. The heart does not authorize a DM or explicit content; existing moderation and connection consent rules remain in force.

Migration 023 resets every legacy `open_to_romance` flag and creates no new preference rows. Legacy draft writes cannot activate romance. Turning romance off deletes the preference row in the same transaction and advances the profile revision, so an older save cannot restore it. No category or preference values are retained in a separate audit table. PostgreSQL backups follow the deployment's normal retention policy.
