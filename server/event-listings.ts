import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { listingFieldsSchema, type EventListing, type EventListingDetail, type ListingFields } from '../shared/event-listings.ts';
import { locationIdSchema } from '../shared/discovery.ts';
import { AppError } from './errors.ts';
import { transaction } from './db.ts';
import { can, requireCapability } from './permissions.ts';
import { Adventures } from './events.ts';

const projection = `SELECT e.*,l.name AS city_name,l.parent_id AS country_id,p.name AS country_name,
  v.name AS place_name,v.address AS place_address,v.city_location_id AS place_city_id,v.active AS place_active,v.revision AS place_revision
  FROM event_listings e JOIN locations l ON l.id=e.city_location_id
  LEFT JOIN locations p ON p.id=l.parent_id LEFT JOIN places v ON v.id=e.place_id`;
function map(row: any): EventListing {
  return { id: row.id, title: row.title, descriptionMarkdown: row.description_markdown,
    startsAt: row.starts_at.toISOString(), endsAt: row.ends_at.toISOString(), timeZone: row.time_zone,
    city: { id: row.city_location_id, name: row.city_name, kind: 'city', parentId: row.country_id, countryName: row.country_name },
    place: row.place_id ? { id: row.place_id, cityLocationId: row.place_city_id, cityName: row.city_name,
      name: row.place_name, address: row.place_address, active: row.place_active, revision: row.place_revision } : null,
    mapsUrl: row.maps_url, venueName: row.venue_name, sourceUrl: row.source_url, organizerName: row.organizer_name,
    communityId: row.community_id, status: row.status, revision: row.revision,
    lastCheckedAt: row.last_checked_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() };
}
function httpsUrl(value: string, maps = false) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    if (maps && !((['www.google.com', 'google.com', 'maps.google.com'].includes(url.hostname) && url.pathname.startsWith('/maps/'))
      || (url.hostname === 'maps.app.goo.gl' && url.pathname.length > 1))) throw new Error();
  } catch { throw new AppError(400, maps ? 'EVENT_MAP_INVALID' : 'LISTING_SOURCE_INVALID'); }
}
async function resolvedCity(db: PoolClient, input: ListingFields, existingPlaceId: string | null = null) {
  if (input.mapsUrl) httpsUrl(input.mapsUrl, true);
  httpsUrl(input.sourceUrl);
  if (Date.parse(input.endsAt) <= Date.parse(input.startsAt)) throw new AppError(400, 'EVENT_END_INVALID');
  if (input.status === 'published' && Date.parse(input.endsAt) <= Date.now()) throw new AppError(400, 'EVENT_TIME_PAST');
  let cityId = input.cityLocationId;
  if (input.placeId) {
    const place = (await db.query('SELECT city_location_id,active FROM places WHERE id=$1', [input.placeId])).rows[0];
    if (!place || (!place.active && input.placeId !== existingPlaceId) || (cityId && cityId !== place.city_location_id)) throw new AppError(400, 'PLACE_LOCATION_MISMATCH');
    cityId = place.city_location_id;
  }
  if (!cityId || !(await db.query("SELECT 1 FROM locations WHERE id=$1 AND kind='city'", [cityId])).rowCount) throw new AppError(400, 'PLACE_CITY_INVALID');
  if (input.communityId && !(await db.query('SELECT 1 FROM communities WHERE id=$1 AND active', [input.communityId])).rowCount) throw new AppError(400, 'COMMUNITY_INVALID');
  return cityId;
}
async function version(db: PoolClient, id: string, actor: string, action: string) {
  await db.query(`INSERT INTO event_listing_versions(listing_id,revision,changed_by,snapshot)
    SELECT id,revision,$2,to_jsonb(e) FROM event_listings e WHERE id=$1`, [id, actor]);
  await db.query(`INSERT INTO permission_audit(user_id,actor_id,action,details,reason)
    VALUES($1,$1,$2,$3,'Event listing administration')`, [actor, action, JSON.stringify({ listingId: id })]);
}
export function eventListingRoutes(pool: Pool, adventures: Adventures) {
  const router = Router();
  const id = (value: unknown) => z.uuid().parse(value);
  router.use(async (_req, res, next) => {
    try {
      if (!(await pool.query("SELECT 1 FROM users WHERE id=$1 AND status='active'", [res.locals.user.id])).rowCount) throw new AppError(403, 'PROFILE_REQUIRED');
      next();
    } catch (error) { next(error); }
  });
  router.get('/', async (req, res) => {
    const query = z.object({ cityId: locationIdSchema.optional(), communityId: z.string().regex(/^[a-z][a-z0-9_]*$/).optional(),
      from: z.iso.date().optional(), to: z.iso.date().optional(), offset: z.coerce.number().int().min(0).max(100000).default(0) }).strict().parse(req.query);
    if (query.from && query.to && query.from > query.to) throw new AppError(400, 'INVALID_INPUT');
    const { rows } = await pool.query(`${projection} WHERE e.status='published' AND e.ends_at>now()
      AND ($1::text IS NULL OR e.city_location_id=$1 OR l.parent_id=$1)
      AND ($2::text IS NULL OR EXISTS(SELECT 1 FROM community_closure c WHERE c.ancestor_id=$2 AND c.descendant_id=e.community_id))
      AND ($3::date IS NULL OR (e.starts_at AT TIME ZONE e.time_zone)::date >= $3::date)
      AND ($4::date IS NULL OR (e.starts_at AT TIME ZONE e.time_zone)::date <= $4::date)
      ORDER BY e.starts_at,e.id LIMIT 21 OFFSET $5`, [query.cityId ?? null, query.communityId ?? null, query.from ?? null, query.to ?? null, query.offset]);
    res.json({ listings: rows.slice(0, 20).map(map), nextOffset: rows.length > 20 ? query.offset + 20 : null });
  });
  router.get('/admin', async (_req, res) => {
    await requireCapability(pool, res.locals.user.id, 'admin', { type: 'global' });
    const { rows } = await pool.query(`${projection} ORDER BY e.updated_at DESC,e.id LIMIT 500`);
    res.json({ listings: rows.map(map) });
  });
  router.post('/admin', async (req, res) => {
    const input = listingFieldsSchema.parse(req.body);
    await requireCapability(pool, res.locals.user.id, 'admin', { type: 'global' });
    if (input.status === 'published') await adventures.review(`${input.title}\n\n${input.descriptionMarkdown}`);
    const listingId = await transaction(pool, async db => {
      await requireCapability(db, res.locals.user.id, 'admin', { type: 'global' });
      const cityId = await resolvedCity(db, input);
      const { rows } = await db.query(`INSERT INTO event_listings(title,description_markdown,starts_at,ends_at,time_zone,city_location_id,
        place_id,maps_url,venue_name,source_url,organizer_name,community_id,status,last_checked_at,created_by,updated_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,now(),$14,$14) RETURNING id`,
      [input.title, input.descriptionMarkdown, input.startsAt, input.endsAt, input.timeZone, cityId,
        input.placeId, input.mapsUrl, input.venueName, input.sourceUrl, input.organizerName, input.communityId, input.status, res.locals.user.id]);
      await version(db, rows[0].id, res.locals.user.id, 'event_listing.created');
      return rows[0].id as string;
    });
    res.status(201).json({ listing: map((await pool.query(`${projection} WHERE e.id=$1`, [listingId])).rows[0]) });
  });
  router.put('/admin/:id', async (req, res) => {
    const listingId = id(req.params.id);
    const { revision, ...input } = listingFieldsSchema.safeExtend({ revision: z.number().int().nonnegative() }).parse(req.body);
    await requireCapability(pool, res.locals.user.id, 'admin', { type: 'global' });
    if (input.status === 'published') await adventures.review(`${input.title}\n\n${input.descriptionMarkdown}`);
    await transaction(pool, async db => {
      await requireCapability(db, res.locals.user.id, 'admin', { type: 'global' });
      const old = (await db.query('SELECT revision,status,place_id FROM event_listings WHERE id=$1 FOR UPDATE', [listingId])).rows[0];
      if (!old) throw new AppError(404, 'NOT_FOUND');
      if (old.revision !== revision) throw new AppError(409, 'LISTING_CONFLICT');
      if (old.status !== 'draft' && input.status === 'draft') throw new AppError(400, 'LISTING_STATUS_INVALID');
      const cityId = await resolvedCity(db, input, old.status === 'draft' && input.status === 'published' ? null : old.place_id);
      await db.query(`UPDATE event_listings SET title=$2,description_markdown=$3,starts_at=$4,ends_at=$5,time_zone=$6,
        city_location_id=$7,place_id=$8,maps_url=$9,venue_name=$10,source_url=$11,organizer_name=$12,community_id=$13,
        status=$14,revision=revision+1,last_checked_at=now(),updated_by=$15,updated_at=now() WHERE id=$1`,
      [listingId, input.title, input.descriptionMarkdown, input.startsAt, input.endsAt, input.timeZone, cityId,
        input.placeId, input.mapsUrl, input.venueName, input.sourceUrl, input.organizerName, input.communityId, input.status, res.locals.user.id]);
      await version(db, listingId, res.locals.user.id, 'event_listing.updated');
    });
    res.json({ listing: map((await pool.query(`${projection} WHERE e.id=$1`, [listingId])).rows[0]) });
  });
  router.get('/:id', async (req, res) => {
    const listingId = id(req.params.id);
    const row = (await pool.query(`${projection} WHERE e.id=$1`, [listingId])).rows[0];
    if (!row) throw new AppError(404, 'NOT_FOUND');
    if (row.status === 'draft' && !await can(pool, res.locals.user.id, 'admin', { type: 'global' })) throw new AppError(404, 'NOT_FOUND');
    const listing: EventListingDetail = { ...map(row), adventures: await adventures.forListing(res.locals.user.id, listingId) };
    res.json({ listing });
  });
  return router;
}
