import { Router } from 'express';
import { z } from 'zod';
import type { Pool, PoolClient } from 'pg';
import { hash } from './auth.ts';
import { transaction } from './db.ts';
import { AppError } from './errors.ts';
import { can, consumeCapability, requireCapability } from './permissions.ts';
import type { InviteBudget, InviteRecord, InviterAccount } from '../shared/schema.ts';
import { getProfile } from './store.ts';
import { redeemInvite } from './invite-redemption.ts';

const issueSchema = z.object({
  requestId: z.uuid(),
  code: z.string().regex(/^QUEST-[A-Za-z0-9_-]{24}$/),
  expiresInDays: z.number().int().min(1).max(30),
  maxRedemptions: z.number().int().min(1).max(20).default(1),
  eventCreator: z.boolean().optional(),
  inviteDepth: z.number().int().min(0).max(2).optional(),
  communityIds: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).max(20)
    .refine(ids => new Set(ids).size === ids.length).default([]),
}).strict();
const accessSchema = z.object({
  enabled: z.boolean(), maxUses: z.number().int().min(0).max(100), windowDays: z.number().int().min(1).max(90),
}).strict();
const roleSchema = z.object({
  eventCreator: z.boolean(), eventMaxUses: z.number().int().min(0).max(100), eventWindowDays: z.number().int().min(1).max(90),
  inviter: z.boolean(), inviteDepth: z.number().int().min(1).max(2), inviteMaxUses: z.number().int().min(0).max(100), inviteWindowDays: z.number().int().min(1).max(90),
  admin: z.boolean(),
}).strict();
const id = (value: unknown) => z.uuid().parse(value);

async function grantOptions(db: Pool | PoolClient, userId: string, admin: boolean) {
  if (admin) return { eventCreator: true, maxInviteDepth: 2 };
  const { rows } = await db.query(`SELECT
    EXISTS(SELECT 1 FROM role_assignments a WHERE a.user_id=$1 AND a.role_code='event_creator' AND a.location_id IS NULL
      AND a.revoked_at IS NULL AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now())) AS event_creator,
    COALESCE((SELECT max(a.invite_depth) FROM role_assignments a WHERE a.user_id=$1 AND a.role_code='inviter'
      AND a.revoked_at IS NULL AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now())),0) AS depth`, [userId]);
  return { eventCreator: rows[0].event_creator as boolean, maxInviteDepth: Math.max(0, (rows[0].depth as number) - 1) };
}

async function budgetFor(db: Pool | PoolClient, userId: string): Promise<InviteBudget | null> {
  const { rows } = await db.query(`SELECT b.max_uses,b.window_seconds,
    (SELECT COALESCE(sum(u.cost),0)::int FROM capability_usage u WHERE u.user_id=b.user_id AND u.capability='invite.create'
      AND u.used_at>now()-make_interval(secs=>b.window_seconds)) AS used
    FROM capability_budgets b WHERE b.user_id=$1 AND b.capability='invite.create'`, [userId]);
  const row = rows[0];
  return row ? { maxUses: row.max_uses, used: row.used, windowDays: row.window_seconds / 86400 } : null;
}

function mapInvite(row: Record<string, any>): InviteRecord {
  return {
    id: row.id, createdAt: row.created_at.toISOString(), expiresAt: row.expires_at.toISOString(),
    status: row.revoked_at ? 'revoked' : row.redemption_count >= row.max_redemptions ? 'redeemed' : row.expires_at <= new Date() ? 'expired' : 'active',
    createdBy: row.creator_name, redeemedBy: row.redeemer_name,
    eventCreator: row.grants_event_creation, inviteDepth: row.invite_depth, communityIds: row.community_ids,
    maxRedemptions: row.max_redemptions, redemptionCount: row.redemption_count,
  };
}

export function inviteRoutes(pool: Pool) {
  const router = Router();
  router.get('/', async (req, res) => {
    const userId = res.locals.user.id as string;
    await requireCapability(pool, userId, 'invite.create', { type: 'global' });
    const admin = await can(pool, userId, 'admin', { type: 'global' });
    const { offset } = z.object({ offset: z.coerce.number().int().min(0).max(100000).default(0) }).strict().parse(req.query);
    const { rows } = await pool.query(`SELECT i.id,i.created_at,i.expires_at,i.revoked_at,i.redeemed_at,i.grants_event_creation,i.invite_depth,i.max_redemptions,i.redemption_count,
      ARRAY(SELECT community_id FROM invite_communities WHERE invite_id=i.id ORDER BY community_id) AS community_ids,
      COALESCE(cp.display_name,cd.display_name) AS creator_name,
      COALESCE(rp.display_name,rd.display_name) AS redeemer_name
      FROM invites i
      LEFT JOIN profiles cp ON cp.user_id=i.created_by LEFT JOIN profile_drafts cd ON cd.user_id=i.created_by
      LEFT JOIN profiles rp ON rp.user_id=i.redeemed_by LEFT JOIN profile_drafts rd ON rd.user_id=i.redeemed_by
      WHERE ($1::boolean OR i.created_by=$2) AND NOT EXISTS(SELECT 1 FROM verified_emails v WHERE v.invite_id=i.id)
      ORDER BY i.created_at DESC,i.id DESC LIMIT 50 OFFSET $3`, [admin, userId, offset]);
    const { rows: countRows } = await pool.query('SELECT count(*)::int AS total FROM invites i WHERE ($1::boolean OR created_by=$2) AND NOT EXISTS(SELECT 1 FROM verified_emails v WHERE v.invite_id=i.id)', [admin, userId]);
    res.json({ invites: rows.map(mapInvite), total: countRows[0].total, budget: await budgetFor(pool, userId), admin,
      grantOptions: await grantOptions(pool, userId, admin) });
  });
  router.post('/', async (req, res) => {
    const input = issueSchema.parse(req.body);
    const userId = res.locals.user.id as string;
    const tokenHash = hash(input.code);
    const record = await transaction(pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`roles:${userId}`]);
      const admin = await can(db, userId, 'admin', { type: 'global' });
      const allowed = await grantOptions(db, userId, admin);
      const eventCreator = input.eventCreator ?? allowed.eventCreator;
      const inviteDepth = input.inviteDepth ?? 0;
      if (eventCreator && !allowed.eventCreator || inviteDepth > allowed.maxInviteDepth) throw new AppError(403, 'PERMISSION_DENIED');
      if (input.communityIds.length && !admin) throw new AppError(403, 'PERMISSION_DENIED');
      if (input.communityIds.length && (await db.query('SELECT id FROM communities WHERE id=ANY($1::text[])', [input.communityIds])).rowCount !== input.communityIds.length) throw new AppError(400, 'COMMUNITY_INVALID');
      const result = await consumeCapability(db, userId, 'invite.create', { type: 'global' }, input.requestId, input.maxRedemptions);
      if (result === 'replay') {
        const old = (await db.query('SELECT id,token_hash,expires_at,grants_event_creation,invite_depth,expiry_days,max_redemptions FROM invites WHERE created_by=$1 AND issuance_request_id=$2', [userId, input.requestId])).rows[0];
        const oldCommunities = old && (await db.query('SELECT community_id FROM invite_communities WHERE invite_id=$1 ORDER BY community_id', [old.id])).rows.map(row => row.community_id);
        if (!old || old.token_hash !== tokenHash || old.grants_event_creation !== eventCreator || old.invite_depth !== inviteDepth || old.expiry_days !== input.expiresInDays || old.max_redemptions !== input.maxRedemptions || JSON.stringify(oldCommunities) !== JSON.stringify([...input.communityIds].sort())) throw new AppError(409, 'REQUEST_CONFLICT');
        return old;
      }
      if ((await db.query('SELECT 1 FROM invites WHERE token_hash=$1', [tokenHash])).rowCount) throw new AppError(409, 'INVITE_CODE_CONFLICT');
      const { rows } = await db.query(`INSERT INTO invites(token_hash,created_by,issuance_request_id,expires_at,expiry_days,grants_event_creation,invite_depth,max_redemptions)
        VALUES($1,$2,$3,now()+make_interval(days=>$4),$4,$5,$6,$7) RETURNING id,expires_at`, [tokenHash, userId, input.requestId, input.expiresInDays, eventCreator, inviteDepth, input.maxRedemptions]);
      for (const communityId of input.communityIds) await db.query('INSERT INTO invite_communities(invite_id,community_id) VALUES($1,$2)', [rows[0].id, communityId]);
      await db.query("INSERT INTO permission_audit(user_id,actor_id,action,details,reason) VALUES($1,$1,'invite.created',$2,'Invitation issued')",
        [userId, JSON.stringify({ inviteId: rows[0].id, expiresInDays: input.expiresInDays, maxRedemptions: input.maxRedemptions, eventCreator, inviteDepth, communityIds: input.communityIds })]);
      return rows[0];
    });
    res.status(201).json({ id: record.id, expiresAt: record.expires_at.toISOString() });
  });
  router.post('/redeem', async (req, res) => {
    const { code } = z.object({ code: z.string().trim().min(6).max(120) }).strict().parse(req.body);
    const userId = res.locals.user.id as string;
    const result = await transaction(pool, async db => {
      const user = (await db.query('SELECT status FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
      if (user?.status !== 'active') throw new AppError(403, 'PROFILE_REQUIRED');
      return redeemInvite(db, userId, code);
    });
    res.json(result);
  });
  router.post('/:id/revoke', async (req, res) => {
    z.object({}).strict().parse(req.body);
    const inviteId = id(req.params.id);
    const userId = res.locals.user.id as string;
    const admin = await can(pool, userId, 'admin', { type: 'global' });
    if (!admin) await requireCapability(pool, userId, 'invite.create', { type: 'global' });
    await transaction(pool, async db => {
      const invite = (await db.query('SELECT created_by,redemption_count,max_redemptions,revoked_at FROM invites WHERE id=$1 FOR UPDATE', [inviteId])).rows[0];
      if (!invite || (!admin && invite.created_by !== userId)) throw new AppError(404, 'NOT_FOUND');
      if (invite.redemption_count >= invite.max_redemptions || invite.revoked_at) throw new AppError(409, 'INVITE_NOT_REVOCABLE');
      await db.query('UPDATE invites SET revoked_at=now() WHERE id=$1', [inviteId]);
      await db.query("INSERT INTO permission_audit(user_id,actor_id,action,details,reason) VALUES($1,$2,'invite.revoked',$3,'Invitation revoked')",
        [invite.created_by, userId, JSON.stringify({ inviteId })]);
    });
    res.json({ ok: true });
  });

  router.get('/admin/inviters', async (req, res) => {
    const actorId = res.locals.user.id as string;
    await requireCapability(pool, actorId, 'admin', { type: 'global' });
    const { q } = z.object({ q: z.string().trim().max(80).default('') }).strict().parse(req.query);
    const { rows } = await pool.query(`SELECT u.id,COALESCE(p.display_name,d.display_name,'?') AS display_name,
      p.user_id IS NOT NULL AS has_profile,
      EXISTS(SELECT 1 FROM role_assignments a WHERE a.user_id=u.id AND a.role_code='admin' AND a.revoked_at IS NULL
        AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now())) AS is_admin,
      EXISTS(SELECT 1 FROM role_assignments a WHERE a.user_id=u.id AND a.role_code='inviter' AND a.revoked_at IS NULL
        AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now())) AS is_inviter,
      COALESCE((SELECT max(a.invite_depth) FROM role_assignments a WHERE a.user_id=u.id AND a.role_code='inviter' AND a.revoked_at IS NULL
        AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now())),0) AS invite_depth,
      EXISTS(SELECT 1 FROM role_assignments a WHERE a.user_id=u.id AND a.role_code='event_creator' AND a.location_id IS NULL
        AND a.revoked_at IS NULL AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now())) AS is_event_creator,
      b.max_uses,b.window_seconds,
      (SELECT COALESCE(sum(x.cost),0)::int FROM capability_usage x WHERE x.user_id=u.id AND x.capability='invite.create'
        AND b.window_seconds IS NOT NULL AND x.used_at>now()-make_interval(secs=>b.window_seconds)) AS used,
      eb.max_uses AS event_max_uses,eb.window_seconds AS event_window_seconds,
      (SELECT count(*)::int FROM capability_usage x WHERE x.user_id=u.id AND x.capability='events.create'
        AND eb.window_seconds IS NOT NULL AND x.used_at>now()-make_interval(secs=>eb.window_seconds)) AS event_used
      FROM users u LEFT JOIN profiles p ON p.user_id=u.id LEFT JOIN profile_drafts d ON d.user_id=u.id
      LEFT JOIN capability_budgets b ON b.user_id=u.id AND b.capability='invite.create'
      LEFT JOIN capability_budgets eb ON eb.user_id=u.id AND eb.capability='events.create'
      WHERE u.status='active' AND ($1='' OR position(lower($1) in lower(COALESCE(p.display_name,d.display_name,'')))>0)
      ORDER BY is_admin DESC,is_inviter DESC,display_name LIMIT 50`, [q]);
    const users: InviterAccount[] = rows.map(row => ({ id: row.id, displayName: row.display_name, hasProfile: row.has_profile, isAdmin: row.is_admin,
      isInviter: row.is_inviter, inviteDepth: row.invite_depth, isEventCreator: row.is_event_creator,
      budget: row.max_uses === null ? null : { maxUses: row.max_uses, used: row.used, windowDays: row.window_seconds / 86400 },
      eventBudget: row.event_max_uses === null ? null : { maxUses: row.event_max_uses, used: row.event_used, windowDays: row.event_window_seconds / 86400 } }));
    res.json({ users });
  });
  router.get('/admin/profiles/:userId', async (req, res) => {
    await requireCapability(pool, res.locals.user.id as string, 'admin', { type: 'global' });
    const userId = id(req.params.userId);
    const account = (await pool.query("SELECT status FROM users WHERE id=$1", [userId])).rows[0];
    if (!account || account.status !== 'active') throw new AppError(404, 'NOT_FOUND');
    const profile = await getProfile(pool, userId);
    if (!profile) throw new AppError(404, 'NOT_FOUND');
    res.json({ profile });
  });
  router.put('/admin/inviters/:userId', async (req, res) => {
    const actorId = res.locals.user.id as string;
    const targetId = id(req.params.userId);
    const input = accessSchema.parse(req.body);
    await transaction(pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`roles:${targetId}`]);
      await requireCapability(db, actorId, 'admin', { type: 'global' });
      const target = (await db.query("SELECT status FROM users WHERE id=$1 FOR UPDATE", [targetId])).rows[0];
      if (!target || target.status !== 'active') throw new AppError(404, 'NOT_FOUND');
      const isAdmin = await can(db, targetId, 'admin', { type: 'global' });
      if (isAdmin && !input.enabled) throw new AppError(400, 'INVALID_INPUT');
      const assignments = await db.query("SELECT id FROM role_assignments WHERE user_id=$1 AND role_code='inviter' AND revoked_at IS NULL AND valid_from<=now() AND (valid_until IS NULL OR valid_until>now()) FOR UPDATE", [targetId]);
      if (input.enabled && !assignments.rowCount && !isAdmin) {
        await db.query("INSERT INTO role_assignments(user_id,role_code,granted_by,reason) VALUES($1,'inviter',$2,'Admin invite access')", [targetId, actorId]);
      } else if (!input.enabled && assignments.rowCount) {
        await db.query("UPDATE role_assignments SET revoked_at=now() WHERE user_id=$1 AND role_code='inviter' AND revoked_at IS NULL", [targetId]);
      }
      await db.query(`INSERT INTO capability_budgets(user_id,capability,max_uses,window_seconds) VALUES($1,'invite.create',$2,$3)
        ON CONFLICT(user_id,capability) DO UPDATE SET max_uses=EXCLUDED.max_uses,window_seconds=EXCLUDED.window_seconds,updated_at=now()`,
        [targetId, input.maxUses, input.windowDays * 86400]);
      await db.query("INSERT INTO permission_audit(user_id,actor_id,action,details,reason) VALUES($1,$2,'invite.access.updated',$3,'Admin invite settings')",
        [targetId, actorId, JSON.stringify(input)]);
    });
    res.json({ ok: true });
  });
  router.put('/admin/roles/:userId', async (req, res) => {
    const actorId = res.locals.user.id as string;
    const targetId = id(req.params.userId);
    const input = roleSchema.parse(req.body);
    await transaction(pool, async db => {
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended('admin:roles',0))");
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`roles:${targetId}`]);
      await requireCapability(db, actorId, 'admin', { type: 'global' });
      const target = (await db.query('SELECT status FROM users WHERE id=$1 FOR UPDATE', [targetId])).rows[0];
      if (!target || target.status !== 'active') throw new AppError(404, 'NOT_FOUND');
      if (actorId === targetId && !input.admin) throw new AppError(400, 'INVALID_INPUT');
      for (const [role, enabled] of [['event_creator', input.eventCreator], ['inviter', input.inviter], ['admin', input.admin]] as const) {
        const scope = role === 'event_creator' ? 'AND location_id IS NULL' : '';
        const current = await db.query(`SELECT id,invite_depth FROM role_assignments WHERE user_id=$1 AND role_code=$2
          ${scope} AND revoked_at IS NULL AND valid_from<=now() AND (valid_until IS NULL OR valid_until>now()) FOR UPDATE`, [targetId, role]);
        if (enabled && !current.rowCount) await db.query(`INSERT INTO role_assignments(user_id,role_code,invite_depth,granted_by,reason)
          VALUES($1,$2,$3,$4,'Admin role grant')`, [targetId, role, role === 'inviter' ? input.inviteDepth : 1, actorId]);
        else if (enabled && role === 'inviter') await db.query(`UPDATE role_assignments SET invite_depth=$2 WHERE user_id=$1 AND role_code='inviter'
          AND revoked_at IS NULL AND valid_from<=now() AND (valid_until IS NULL OR valid_until>now())`, [targetId, input.inviteDepth]);
        else if (!enabled && current.rowCount) {
          if (role === 'admin') {
            const admins = await db.query(`SELECT count(DISTINCT a.user_id)::int AS count FROM role_assignments a JOIN users u ON u.id=a.user_id
              WHERE u.status='active' AND a.role_code='admin' AND a.revoked_at IS NULL AND a.valid_from<=now() AND (a.valid_until IS NULL OR a.valid_until>now())`);
            if (admins.rows[0].count <= 1) throw new AppError(400, 'LAST_ADMIN');
          }
          await db.query(`UPDATE role_assignments SET revoked_at=now() WHERE user_id=$1 AND role_code=$2 ${scope} AND revoked_at IS NULL`, [targetId, role]);
        }
      }
      for (const [capability, maxUses, days] of [['events.create', input.eventMaxUses, input.eventWindowDays], ['invite.create', input.inviteMaxUses, input.inviteWindowDays]] as const) {
        await db.query(`INSERT INTO capability_budgets(user_id,capability,max_uses,window_seconds) VALUES($1,$2,$3,$4)
          ON CONFLICT(user_id,capability) DO UPDATE SET max_uses=EXCLUDED.max_uses,window_seconds=EXCLUDED.window_seconds,updated_at=now()`, [targetId, capability, maxUses, days * 86400]);
      }
      await db.query("INSERT INTO permission_audit(user_id,actor_id,action,details,reason) VALUES($1,$2,'roles.updated',$3,'Admin role settings')", [targetId, actorId, JSON.stringify(input)]);
    });
    res.json({ ok: true });
  });
  return router;
}
