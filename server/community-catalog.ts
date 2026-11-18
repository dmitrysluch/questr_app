import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseCommunities, type Community } from '../shared/communities.ts';

export async function loadCommunityCatalog(path: string): Promise<Community[]> {
  const fullPath = resolve(path);
  let data: unknown;
  try { data = JSON.parse(await readFile(fullPath, 'utf8')); }
  catch (error) { throw new Error(`Cannot read community catalog at ${fullPath}: ${(error as Error).message}`); }
  try { return parseCommunities(data); }
  catch (error) { throw new Error(`Invalid community catalog at ${fullPath}: ${(error as Error).message}`); }
}
