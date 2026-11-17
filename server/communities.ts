import type { Pool, PoolClient } from 'pg';
import { AppError } from './errors.ts';

type Db = Pool | PoolClient;

// A direct grant to a child includes its ancestors, never its descendants.
export async function hasCommunityAccess(db: Db, userId: string, communityId: string): Promise<boolean> {
  return !!(await db.query(`SELECT 1 FROM user_community_grants g
    JOIN community_closure c ON c.descendant_id=g.community_id
    WHERE g.user_id=$1 AND c.ancestor_id=$2 LIMIT 1`, [userId, communityId])).rowCount;
}

export async function requireCommunityAccess(db: Db, userId: string, communityId: string | null): Promise<void> {
  if (communityId && !await hasCommunityAccess(db, userId, communityId)) throw new AppError(403, 'COMMUNITY_ACCESS_REQUIRED');
}
