import type { Pool, PoolClient } from 'pg';
import { AppError } from './errors.ts';

type Db = Pool | PoolClient;
export type Capability = 'profile.view' | 'profile.edit' | 'events.view' | 'events.create' | 'events.edit' | 'events.accept' | 'events.group_chat' | 'events.group_chat_moderator' | 'dm.send_opener' | 'dm.message' | 'invite.create' | 'admin';
export type Resource = { type: 'global' } | { type: 'location'; id: string } | { type: 'event'; id: string } | { type: 'profile'; id: string };

export async function can(db: Db, userId: string, capability: Capability, resource: Resource): Promise<boolean> {
  const user = (await db.query('SELECT status FROM users WHERE id=$1', [userId])).rows[0];
  if (!user || !['onboarding', 'active'].includes(user.status)) return false;
  if (user.status !== 'active' && !capability.startsWith('profile.')) return false;
  // DM permissions require consent/block relationships, not just a role. Until
  // that workflow exists, these reserved capabilities always fail closed.
  if (capability.startsWith('dm.')) return false;
  if (capability.startsWith('profile.') && resource.type !== 'profile') return false;
  if (capability.startsWith('events.') && !['event', 'location'].includes(resource.type)) return false;
  if (capability === 'events.create' && resource.type !== 'location') return false;
  if (['events.edit', 'events.accept', 'events.group_chat', 'events.group_chat_moderator'].includes(capability) && resource.type !== 'event') return false;
  if (['invite.create', 'admin'].includes(capability) && resource.type !== 'global') return false;
  let locationId: string | null = resource.type === 'location' ? resource.id : null;
  let eventStatus: string | null = null;
  if (resource.type === 'event') {
    const event = (await db.query('SELECT location_id,status FROM events WHERE id=$1', [resource.id])).rows[0];
    if (!event) return false;
    locationId = event.location_id; // Resolve scope on the server, never trust a caller's country.
    eventStatus = event.status;
    if (event.status === 'draft' && capability === 'events.view') {
      return can(db, userId, 'events.edit', resource);
    }
  }
  let parentId: string | null = null;
  if (locationId) {
    const location = (await db.query('SELECT parent_id FROM locations WHERE id=$1', [locationId])).rows[0];
    if (!location) return false;
    parentId = location.parent_id;
  }
  const { rows } = await db.query(`SELECT a.location_id,a.event_id,a.profile_id,c.own_profile_only
    FROM role_assignments a JOIN role_capabilities c ON c.role_code=a.role_code
    WHERE a.user_id=$1 AND c.capability=$2 AND a.revoked_at IS NULL
      AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now())`, [userId, capability]);
  return rows.some(grant => {
    // Completed/cancelled events remain visible to their explicitly assigned
    // participants; a general discovery grant does not expose their history.
    if (capability === 'events.view' && eventStatus && eventStatus !== 'published' && !grant.event_id) return false;
    // A regional member still owns one global profile. The assignment's
    // location scope applies to event capabilities, not this self-only rule.
    if (grant.own_profile_only) return resource.type === 'profile' && resource.id === userId;
    if (grant.event_id) return resource.type === 'event' && grant.event_id === resource.id;
    if (grant.profile_id) return resource.type === 'profile' && grant.profile_id === resource.id;
    if (grant.location_id) return grant.location_id === locationId || grant.location_id === parentId;
    return true;
  });
}
export async function requireCapability(db: Db, userId: string, capability: Capability, resource: Resource) {
  if (!await can(db, userId, capability, resource)) throw new AppError(403, 'PERMISSION_DENIED');
}
export async function grantMember(db: PoolClient, userId: string) {
  await db.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'member','Invitation redeemed')", [userId]);
  await db.query("INSERT INTO permission_audit(user_id,action,details,reason) VALUES($1,'role.granted','{\"role\":\"member\"}','Invitation redeemed')", [userId]);
  await db.query("INSERT INTO capability_budgets(user_id,capability,max_uses,window_seconds) VALUES($1,'events.create',2,604800),($1,'invite.create',3,604800) ON CONFLICT DO NOTHING", [userId]);
}
// Must run in the SAME transaction as the action. Serializes competing consumes;
// rollback also restores quota. A retry cannot spend again or change its target.
export async function consumeCapability(db: PoolClient, userId: string, capability: Capability, resource: Resource, requestId: string): Promise<'new' | 'replay'> {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`budget:${userId}:${capability}`]);
  await requireCapability(db, userId, capability, resource);
  const resourceKey = resource.type === 'global' ? 'global' : `${resource.type}:${resource.id}`;
  const used = (await db.query('SELECT resource_key FROM capability_usage WHERE user_id=$1 AND capability=$2 AND request_id=$3', [userId, capability, requestId])).rows[0];
  if (used) {
    if (used.resource_key !== resourceKey) throw new AppError(409, 'REQUEST_CONFLICT');
    return 'replay';
  }
  const budget = (await db.query('SELECT max_uses,window_seconds FROM capability_budgets WHERE user_id=$1 AND capability=$2 FOR UPDATE', [userId, capability])).rows[0];
  // Creating events/invites requires an explicit budget, even for overlapping roles.
  if (!budget && ['events.create', 'invite.create', 'dm.send_opener'].includes(capability)) throw new AppError(403, 'PERMISSION_DENIED');
  if (budget) {
    const usage = (await db.query("SELECT count(*)::int AS total FROM capability_usage WHERE user_id=$1 AND capability=$2 AND used_at>now()-make_interval(secs=>$3)", [userId, capability, budget.window_seconds])).rows[0];
    if (usage.total >= budget.max_uses) throw new AppError(429, 'BUDGET_EXHAUSTED');
  }
  await db.query('INSERT INTO capability_usage(user_id,capability,request_id,resource_key) VALUES($1,$2,$3,$4)', [userId, capability, requestId, resourceKey]);
  return 'new';
}
