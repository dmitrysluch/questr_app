import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';

const locationSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  kind: z.enum(['online', 'country', 'city']),
  parentId: z.string().nullable(),
  population: z.number().int().nonnegative(),
  search: z.string().min(1),
}).strict();

export type CatalogLocation = z.infer<typeof locationSchema>;

export async function loadLocationCatalog(path: string): Promise<CatalogLocation[]> {
  const fullPath = resolve(path);
  let data: unknown;
  try { data = JSON.parse(await readFile(fullPath, 'utf8')); }
  catch (error) { throw new Error(`Cannot read location catalog at ${fullPath}: ${(error as Error).message}`); }
  const parsed = z.array(locationSchema).min(1).safeParse(data);
  if (!parsed.success) throw new Error(`Invalid location catalog at ${fullPath}: ${parsed.error.issues[0]?.message}`);
  const locations = parsed.data;
  const byId = new Map<string, CatalogLocation>();
  for (const location of locations) {
    if (byId.has(location.id)) throw new Error(`Duplicate location ID ${location.id} in ${fullPath}`);
    byId.set(location.id, location);
  }
  if (byId.get('online')?.kind !== 'online') throw new Error(`Location catalog at ${fullPath} must contain Online`);
  for (const location of locations) {
    if (location.kind === 'online' && (location.id !== 'online' || location.parentId !== null)) throw new Error(`Invalid Online location ${location.id} in ${fullPath}`);
    if (location.kind === 'country' && (!/^country:[A-Z]{2}$/.test(location.id) || location.parentId !== null)) throw new Error(`Invalid country ${location.id} in ${fullPath}`);
    if (location.kind === 'city' && (!/^city:[0-9]+$/.test(location.id) || byId.get(location.parentId ?? '')?.kind !== 'country')) throw new Error(`Invalid city ${location.id} or parent in ${fullPath}`);
  }
  return locations;
}
