import { Router } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { placeFieldsSchema, type Place } from '../shared/places.ts';
import { locationIdSchema } from '../shared/discovery.ts';
import { AppError } from './errors.ts';
import { requireCapability } from './permissions.ts';

const projection = `SELECT p.id,p.city_location_id AS "cityLocationId",l.name AS "cityName",
  p.name,p.address,p.active,p.revision FROM places p JOIN locations l ON l.id=p.city_location_id`;
const placeId = (value: unknown) => z.uuid().parse(value);

export function placeRoutes(pool: Pool) {
  const router = Router();
  router.get('/', async (req, res) => {
    const { cityId, q } = z.object({ cityId: locationIdSchema.optional(), q: z.string().trim().max(80).default('') }).strict().parse(req.query);
    if (!cityId) return res.json({ places: [] });
    const { rows } = await pool.query(`${projection} WHERE p.active AND p.city_location_id=$1
      AND ($2='' OR p.name ILIKE '%' || $2 || '%' OR p.address ILIKE '%' || $2 || '%')
      ORDER BY p.name,p.id LIMIT 50`, [cityId, q]);
    res.json({ places: rows as Place[] });
  });
  router.get('/admin', async (_req, res) => {
    await requireCapability(pool, res.locals.user.id, 'admin', { type: 'global' });
    const { rows } = await pool.query(`${projection} ORDER BY p.active DESC,l.name,p.name,p.id LIMIT 500`);
    res.json({ places: rows as Place[] });
  });
  router.post('/admin', async (req, res) => {
    await requireCapability(pool, res.locals.user.id, 'admin', { type: 'global' });
    const input = placeFieldsSchema.parse(req.body);
    const city = await pool.query("SELECT 1 FROM locations WHERE id=$1 AND kind='city'", [input.cityLocationId]);
    if (!city.rowCount) throw new AppError(400, 'PLACE_CITY_INVALID');
    const { rows } = await pool.query(`INSERT INTO places(city_location_id,name,address,active,created_by)
      VALUES($1,$2,$3,$4,$5) RETURNING id`, [input.cityLocationId, input.name, input.address, input.active, res.locals.user.id]);
    res.status(201).json({ place: (await pool.query(`${projection} WHERE p.id=$1`, [rows[0].id])).rows[0] as Place });
  });
  router.put('/admin/:id', async (req, res) => {
    await requireCapability(pool, res.locals.user.id, 'admin', { type: 'global' });
    const input = placeFieldsSchema.extend({ revision: z.number().int().nonnegative() }).parse(req.body);
    const id = placeId(req.params.id);
    const existing = (await pool.query('SELECT city_location_id FROM places WHERE id=$1', [id])).rows[0];
    if (!existing) throw new AppError(404, 'NOT_FOUND');
    if (existing.city_location_id !== input.cityLocationId) throw new AppError(400, 'PLACE_CITY_IMMUTABLE');
    const city = await pool.query("SELECT 1 FROM locations WHERE id=$1 AND kind='city'", [input.cityLocationId]);
    if (!city.rowCount) throw new AppError(400, 'PLACE_CITY_INVALID');
    const { rows } = await pool.query(`UPDATE places SET city_location_id=$2,name=$3,address=$4,active=$5,
      revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$6 RETURNING id`,
      [id, input.cityLocationId, input.name, input.address, input.active, input.revision]);
    if (!rows[0]) throw new AppError(409, 'PLACE_CONFLICT');
    res.json({ place: (await pool.query(`${projection} WHERE p.id=$1`, [rows[0].id])).rows[0] as Place });
  });
  return router;
}
