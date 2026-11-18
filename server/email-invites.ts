import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { domainToASCII } from 'node:url';
import { Router } from 'express';
import { z } from 'zod';
import type { Pool } from 'pg';
import type { Config } from './config.ts';
import { hash } from './auth.ts';
import { transaction } from './db.ts';
import { AppError } from './errors.ts';
import { grantMember, requireCapability } from './permissions.ts';
import { communities } from '../shared/communities.ts';

export type EmailSender = (email: string, code: string, locale: string) => Promise<void>;

function normalizeDomain(value: string): string {
  const domain = domainToASCII(value.trim().toLowerCase());
  if (!domain || domain.length > 253 || !domain.includes('.') || domain.endsWith('.') ||
    domain.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) throw new AppError(400, 'INVALID_EMAIL_DOMAIN');
  return domain;
}
function normalizeEmail(value: string): { email: string; domain: string } {
  const email = value.trim().toLowerCase();
  const parts = email.split('@');
  if (email.length > 254 || parts.length !== 2 || !/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}$/.test(parts[0]) ||
    parts[0].startsWith('.') || parts[0].endsWith('.') || parts[0].includes('..')) throw new AppError(400, 'INVALID_EMAIL');
  const domain = normalizeDomain(parts[1]);
  return { email: `${parts[0]}@${domain}`, domain };
}
const emailSchema = z.object({ email: z.string().trim().min(3).max(254) }).strict();
const verifySchema = emailSchema.extend({ code: z.string().regex(/^\d{8}$/) }).strict();
const ruleSchema = z.object({ domain: z.string().trim().min(4).max(253), enabled: z.boolean(), allowRegistration: z.boolean(),
  communityIds: z.array(z.string().refine(id => communities.some(item => item.id === id))).max(20)
    .refine(ids => new Set(ids).size === ids.length) }).strict();

export function brevoSender(config: Config): EmailSender {
  return async (email, code, locale) => {
    if (!config.brevoApiKey || !config.brevoSenderEmail) throw new AppError(503, 'EMAIL_NOT_CONFIGURED');
    const russian = locale === 'ru';
    let response: Response;
    try {
      response = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', signal: AbortSignal.timeout(10000),
        headers: { 'api-key': config.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { name: 'QUESTR', email: config.brevoSenderEmail }, to: [{ email }],
          subject: russian ? 'Код подтверждения QUESTR' : 'Your QUESTR verification code',
          textContent: russian
            ? `Код подтверждения: ${code}\n\nОн действует 10 минут. Если ты не запрашивал код, просто проигнорируй письмо.`
            : `Your verification code: ${code}\n\nIt expires in 10 minutes. If you did not request it, ignore this message.`,
          tags: ['email-domain-invite'] }),
      });
    } catch (error) { console.error('QUESTR email delivery failed:', error); throw new AppError(503, 'EMAIL_SEND_FAILED'); }
    if (!response.ok) { console.error('QUESTR Brevo rejected email:', response.status); throw new AppError(503, 'EMAIL_SEND_FAILED'); }
  };
}

export function emailInviteRoutes(pool: Pool, config: Config, throttle: (key: string, limit: number) => void,
  send: EmailSender = brevoSender(config)) {
  const router = Router();
  router.get('/status', async (_req, res) => {
    const userId = res.locals.user.id as string;
    const pendingInvite = res.locals.user.status === 'pending_invite';
    const [rules, verified] = await Promise.all([
      pool.query('SELECT 1 FROM email_invite_domains WHERE enabled=true AND ($1::boolean=false OR allow_registration=true) LIMIT 1', [pendingInvite]),
      pool.query('SELECT email,domain,registration_allowed FROM verified_emails WHERE user_id=$1 ORDER BY verified_at DESC', [userId]),
    ]);
    res.json({ available: !!(config.brevoApiKey && config.brevoSenderEmail && rules.rowCount),
      verifiedEmails: verified.rows.map(row => ({ email: row.email, domain: row.domain, registrationAllowed: row.registration_allowed })) });
  });
  router.post('/request', async (req, res) => {
    const userId = res.locals.user.id as string;
    const { email, domain } = normalizeEmail(emailSchema.parse(req.body).email);
    if (!config.brevoApiKey || !config.brevoSenderEmail) throw new AppError(503, 'EMAIL_NOT_CONFIGURED');
    throttle(`email-request-user:${userId}`, 5);
    throttle(`email-request-ip:${req.ip}`, 15);
    throttle(`email-request-address:${hash(email)}`, 5);
    const code = String(randomInt(0, 100000000)).padStart(8, '0');
    await transaction(pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`email:${email}`]);
      const user = (await db.query('SELECT status,locale FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
      if (!user || user.status === 'blocked') throw new AppError(403, 'ACCOUNT_BLOCKED');
      const rule = (await db.query('SELECT allow_registration FROM email_invite_domains WHERE domain=$1 AND enabled=true FOR SHARE', [domain])).rows[0];
      if (!rule || user.status === 'pending_invite' && !rule.allow_registration) throw new AppError(400, 'EMAIL_DOMAIN_NOT_ALLOWED');
      const owner = (await db.query('SELECT user_id FROM verified_emails WHERE email=$1', [email])).rows[0];
      if (owner && owner.user_id !== userId) throw new AppError(409, 'EMAIL_ALREADY_USED');
      const previous = (await db.query('SELECT sent_at,window_started_at,send_count FROM email_verification_challenges WHERE user_id=$1 AND email=$2 FOR UPDATE', [userId, email])).rows[0];
      if (previous && Date.now() - previous.sent_at.getTime() < 60_000) throw new AppError(429, 'EMAIL_WAIT');
      if (previous && Date.now() - previous.window_started_at.getTime() < 86_400_000 && previous.send_count >= 5) throw new AppError(429, 'EMAIL_LIMIT');
      const recent = await db.query("SELECT count(*)::int AS n FROM email_verification_challenges WHERE email=$1 AND sent_at>now()-interval '1 day'", [email]);
      if (recent.rows[0].n >= 5 && !previous) throw new AppError(429, 'EMAIL_LIMIT');
      await db.query(`INSERT INTO email_verification_challenges(user_id,email,domain,code_hash,expires_at)
        VALUES($1,$2,$3,$4,now()+interval '10 minutes') ON CONFLICT(user_id,email) DO UPDATE SET
        code_hash=EXCLUDED.code_hash,domain=EXCLUDED.domain,expires_at=EXCLUDED.expires_at,sent_at=now(),attempts=0,used_at=NULL,
        window_started_at=CASE WHEN email_verification_challenges.window_started_at<now()-interval '1 day' THEN now() ELSE email_verification_challenges.window_started_at END,
        send_count=CASE WHEN email_verification_challenges.window_started_at<now()-interval '1 day' THEN 1 ELSE email_verification_challenges.send_count+1 END`,
      [userId, email, domain, hash(`${email}:${code}`)]);
      // Keep the address lock while sending: another account cannot race a second message to it.
      await send(email, code, user.locale);
    });
    res.json({ ok: true });
  });
  router.post('/verify', async (req, res) => {
    const userId = res.locals.user.id as string;
    const input = verifySchema.parse(req.body);
    const { email, domain } = normalizeEmail(input.email);
    throttle(`email-verify:${userId}`, 12);
    const result = await transaction(pool, async db => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`email:${email}`]);
      const user = (await db.query('SELECT status FROM users WHERE id=$1 FOR UPDATE', [userId])).rows[0];
      if (!user || user.status === 'blocked') throw new AppError(403, 'ACCOUNT_BLOCKED');
      const challenge = (await db.query('SELECT * FROM email_verification_challenges WHERE user_id=$1 AND email=$2 FOR UPDATE', [userId, email])).rows[0];
      if (!challenge || challenge.used_at || challenge.expires_at <= new Date() || challenge.attempts >= 5) return 'EMAIL_CODE_EXPIRED';
      const provided = Buffer.from(hash(`${email}:${input.code}`));
      const expected = Buffer.from(challenge.code_hash);
      if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
        await db.query('UPDATE email_verification_challenges SET attempts=attempts+1 WHERE user_id=$1 AND email=$2', [userId, email]);
        return 'INVALID_EMAIL_CODE';
      }
      const rule = (await db.query('SELECT allow_registration FROM email_invite_domains WHERE domain=$1 AND enabled=true FOR SHARE', [domain])).rows[0];
      if (!rule || user.status === 'pending_invite' && !rule.allow_registration) return 'EMAIL_DOMAIN_NOT_ALLOWED';
      const previous = (await db.query('SELECT user_id,invite_id,registration_allowed FROM verified_emails WHERE email=$1 FOR UPDATE', [email])).rows[0];
      if (previous && previous.user_id !== userId) return 'EMAIL_ALREADY_USED';
      let inviteId = previous?.invite_id as string | undefined;
      if (!inviteId) {
        const created = await db.query(`INSERT INTO invites(token_hash,expires_at,redeemed_by,redeemed_at)
          VALUES($1,now()+interval '1 day',$2,now()) RETURNING id`, [hash(randomBytes(32).toString('hex')), userId]);
        inviteId = created.rows[0].id;
      }
      await db.query(`INSERT INTO invite_communities(invite_id,community_id)
        SELECT $1,community_id FROM email_invite_domain_communities WHERE domain=$2 ON CONFLICT DO NOTHING`, [inviteId, domain]);
      if (!previous) await grantMember(db, userId, { inviteId: inviteId!, eventCreator: false, inviteDepth: 0, invitedBy: null });
      else await db.query(`INSERT INTO user_community_grants(user_id,community_id,invite_id)
        SELECT $1,community_id,$2 FROM invite_communities WHERE invite_id=$2 ON CONFLICT DO NOTHING`, [userId, inviteId]);
      await db.query(`INSERT INTO verified_emails(email,user_id,domain,invite_id,registration_allowed)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO UPDATE SET verified_at=now(),
        registration_allowed=verified_emails.registration_allowed OR EXCLUDED.registration_allowed`,
      [email, userId, domain, inviteId, rule.allow_registration]);
      await db.query('UPDATE email_verification_challenges SET used_at=now() WHERE user_id=$1 AND email=$2', [userId, email]);
      await db.query("INSERT INTO permission_audit(user_id,action,details,reason) VALUES($1,'email.domain.verified',$2,'Email domain verification')",
        [userId, JSON.stringify({ domain, inviteId })]);
      return 'ok';
    });
    if (result !== 'ok') throw new AppError(result === 'EMAIL_ALREADY_USED' ? 409 : 400, result);
    res.json({ ok: true, registrationAllowed: (await pool.query('SELECT registration_allowed FROM verified_emails WHERE email=$1 AND user_id=$2', [email, userId])).rows[0].registration_allowed });
  });
  router.get('/admin/domains', async (_req, res) => {
    const userId = res.locals.user.id as string;
    await requireCapability(pool, userId, 'admin', { type: 'global' });
    const { rows } = await pool.query(`SELECT d.domain,d.enabled,d.allow_registration,
      ARRAY(SELECT community_id FROM email_invite_domain_communities WHERE domain=d.domain ORDER BY community_id) AS community_ids
      FROM email_invite_domains d ORDER BY d.domain`);
    res.json({ domains: rows.map(row => ({ domain: row.domain, enabled: row.enabled, allowRegistration: row.allow_registration, communityIds: row.community_ids })) });
  });
  router.put('/admin/domains', async (req, res) => {
    const userId = res.locals.user.id as string;
    const input = ruleSchema.parse(req.body);
    const domain = normalizeDomain(input.domain);
    if (input.enabled && !input.allowRegistration && !input.communityIds.length) throw new AppError(400, 'EMAIL_RULE_EMPTY');
    await transaction(pool, async db => {
      await requireCapability(db, userId, 'admin', { type: 'global' });
      await db.query(`INSERT INTO email_invite_domains(domain,allow_registration,enabled,updated_by)
        VALUES($1,$2,$3,$4) ON CONFLICT(domain) DO UPDATE SET allow_registration=EXCLUDED.allow_registration,
        enabled=EXCLUDED.enabled,updated_by=EXCLUDED.updated_by,updated_at=now()`,
      [domain, input.allowRegistration, input.enabled, userId]);
      await db.query('DELETE FROM email_invite_domain_communities WHERE domain=$1', [domain]);
      for (const id of input.communityIds) await db.query('INSERT INTO email_invite_domain_communities(domain,community_id) VALUES($1,$2)', [domain, id]);
      await db.query("INSERT INTO permission_audit(user_id,actor_id,action,details,reason) VALUES($1,$1,'email.domain.updated',$2,'Admin domain invite rule')",
        [userId, JSON.stringify({ ...input, domain })]);
    });
    res.json({ ok: true, domain });
  });
  return router;
}
