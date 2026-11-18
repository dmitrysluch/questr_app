import { z } from 'zod';
import catalog from './communities.json';

export interface Community {
  id: string;
  parentId: string | null;
  name: { en: string; ru: string };
}

const communitySchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  parentId: z.string().nullable(),
  name: z.object({ en: z.string().trim().min(1), ru: z.string().trim().min(1) }).strict(),
}).strict();

// Validate the checked-in catalog before either the server or the Mini App uses it.
// Parents are ordered before children so database seeding does not depend on JSON order.
export function parseCommunities(value: unknown): Community[] {
  const input = z.object({ communities: z.array(communitySchema).min(1) }).strict().parse(value).communities;
  const byId = new Map<string, Community>();
  for (const community of input) {
    if (byId.has(community.id)) throw new Error(`Duplicate community: ${community.id}`);
    byId.set(community.id, community);
  }
  const ordered: Community[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function add(id: string) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error(`Community hierarchy has a cycle at ${id}`);
    const community = byId.get(id);
    if (!community) throw new Error(`Unknown parent community: ${id}`);
    visiting.add(id);
    if (community.parentId) add(community.parentId);
    visiting.delete(id);
    visited.add(id);
    ordered.push(community);
  }
  for (const community of input) add(community.id);
  return ordered;
}

// Stable IDs and parentage are guarded against accidental changes in migrate.ts.
// Memberships live in PostgreSQL; names and the tree live in JSON.
export const communities = parseCommunities(catalog);
const byId = new Map(communities.map(community => [community.id, community]));

export function communityAncestors(id: string): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    result.push(current.id); seen.add(current.id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return result;
}
