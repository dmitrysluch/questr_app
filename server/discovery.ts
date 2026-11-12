import type { Pool, PoolClient } from 'pg';
import { discoveryInputSchema, normalizeSearch, type DiscoveryPreferences, type Location } from '../shared/discovery.ts';
import { AppError } from './errors.ts';
import { transaction } from './db.ts';

type Db = Pool | PoolClient;
export async function getDiscovery(db: Db, userId: string): Promise<DiscoveryPreferences> {
  const { rows } = await db.query(`SELECT p.revision,
    ARRAY(SELECT location_id FROM discovery_locations WHERE user_id=p.user_id ORDER BY location_id) AS location_ids,
    ARRAY(SELECT language_code FROM discovery_languages WHERE user_id=p.user_id ORDER BY language_code) AS language_codes
    FROM discovery_preferences p WHERE p.user_id=$1`, [userId]);
  const row = rows[0];
  return row ? { revision: row.revision, locationIds: row.location_ids, languageCodes: row.language_codes } : { revision: 0, locationIds: [], languageCodes: [] };
}
export async function saveDiscovery(pool: Pool, userId: string, body: unknown) {
  const input = discoveryInputSchema.parse(body);
  return transaction(pool, async db => {
    const known = await db.query('SELECT id FROM locations WHERE id=ANY($1::text[])', [input.locationIds]);
    if (known.rowCount !== input.locationIds.length) throw new AppError(400, 'INVALID_INPUT');
    await db.query('INSERT INTO discovery_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING', [userId]);
    const updated = await db.query('UPDATE discovery_preferences SET revision=revision+1,updated_at=now() WHERE user_id=$1 AND revision=$2 RETURNING revision', [userId, input.revision]);
    if (!updated.rowCount) throw new AppError(409, 'PREFERENCES_CONFLICT');
    await db.query('DELETE FROM discovery_locations WHERE user_id=$1', [userId]);
    await db.query('DELETE FROM discovery_languages WHERE user_id=$1', [userId]);
    await db.query('INSERT INTO discovery_locations(user_id,location_id) SELECT $1,unnest($2::text[])', [userId, input.locationIds]);
    await db.query('INSERT INTO discovery_languages(user_id,language_code) SELECT $1,unnest($2::text[])', [userId, input.languageCodes]);
    return getDiscovery(db, userId);
  });
}
export async function searchLocations(db: Db, options: { query?: string; parentId?: string; ids?: string[] }): Promise<Location[]> {
  const query = normalizeSearch(options.query ?? '');
  const { rows } = await db.query(`SELECT l.id,l.name,l.kind,l.parent_id AS "parentId",p.name AS "countryName"
    FROM locations l LEFT JOIN locations p ON p.id=l.parent_id
    WHERE ($1::text[] IS NULL OR l.id=ANY($1)) AND ($2::text IS NULL OR l.parent_id=$2)
      AND ($3='' OR l.search_text LIKE '%' || $3 || '%' OR p.search_text LIKE '%' || $3 || '%')
    ORDER BY (lower(l.name)=lower($4)) DESC, (l.kind='online') DESC, (l.kind='country') DESC,
      (l.search_text LIKE $3 || '%') DESC, l.population DESC, l.name,l.id LIMIT 50`,
  [options.ids ?? null, options.parentId ?? null, query, options.query ?? '']);
  return rows;
}
// This predicate only filters discovery. Callers must also authorize each event.
// Empty selections mean no configured feed, never an accidental worldwide feed.
export async function eventMatchesDiscovery(db: Db, userId: string, eventId: string): Promise<boolean> {
  const { rowCount } = await db.query(`SELECT 1 FROM events e JOIN locations l ON l.id=e.location_id
    WHERE e.id=$2 AND e.status='published'
    AND EXISTS(SELECT 1 FROM discovery_languages WHERE user_id=$1 AND language_code=e.language_code)
    AND EXISTS(SELECT 1 FROM discovery_locations WHERE user_id=$1 AND (location_id=l.id OR location_id=l.parent_id))`, [userId, eventId]);
  return !!rowCount;
}
