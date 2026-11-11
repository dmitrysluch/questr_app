import express, { type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import type { Pool, PoolClient } from 'pg';
import type { Config } from './config.ts';
import { AppError } from './errors.ts';
import { createSession, demoInvite, findUser, hash, sessionToken, setSession, verifyTelegramInitData } from './auth.ts';
import { transaction, transactionOnClient } from './db.ts';
import { Interviewer } from './assistant.ts';
import { getConversation, getDraft, getMessages, getProfile, getProposal, mapDraft, mapProposal } from './store.ts';
import { aiConsentVersion, termsVersion } from '../shared/catalog.ts';
import { draftInputSchema, messageSchema, registerSchema, tagKey, selectedTagsSchema, type ProfileTag } from '../shared/schema.ts';

type User = { id: string; status: string; locale: string };
const currentUser = (res: Response): User => res.locals.user;

export function createApp(pool: Pool, config: Config, interviewer = new Interviewer(config)) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '5mb' }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.path !== '/api/telegram/webhook') {
      if (req.get('Origin') && req.get('Origin') !== config.appOrigin) return next(new AppError(403, 'INVALID_ORIGIN'));
      if (!req.is('application/json')) return next(new AppError(415, 'JSON_REQUIRED'));
    }
    next();
  });
  const bursts = new Map<string, { count: number; until: number }>();
  function throttle(key: string, limit: number) {
    const now = Date.now();
    if (bursts.size > 2000) for (const [k, v] of bursts) if (v.until < now) bursts.delete(k);
    const entry = bursts.get(key);
    if (!entry || entry.until < now) bursts.set(key, { count: 1, until: now + 60000 });
    else if (++entry.count > limit) throw new AppError(429, 'RATE_LIMITED');
  }
  async function lockAssistant<T>(userId: string, run: (client: PoolClient) => Promise<T>): Promise<T> {
    throttle(`assistant:${userId}`, 12);
    const client = await pool.connect();
    let locked = false;
    try {
      const result = await client.query('SELECT pg_try_advisory_lock(hashtextextended($1, 73)) AS locked', [userId]);
      locked = result.rows[0].locked;
      if (!locked) throw new AppError(409, 'ASSISTANT_BUSY');
      return await run(client);
    } finally {
      if (locked) await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 73))', [userId]);
      client.release();
    }
  }
  app.get('/api/health', async (_req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); });
  app.get('/api/config', (_req, res) => res.json({ authMode: config.authMode, aiMode: config.aiMode, botUsername: 'questr_game', termsVersion }));

  app.post('/api/auth/demo', async (req, res) => {
    if (config.authMode !== 'demo') throw new AppError(404, 'NOT_FOUND');
    throttle(`auth:${req.ip}`, 30);
    let user = await findUser(req, pool);
    if (!user) {
      const created = await transaction(pool, async client => {
        const { rows } = await client.query('INSERT INTO users DEFAULT VALUES RETURNING id,status,locale');
        return { user: rows[0], token: await createSession(rows[0].id, client) };
      });
      user = created.user;
      setSession(res, created.token, config);
    }
    if (user!.status === 'pending_invite') {
      await pool.query("INSERT INTO invites(token_hash,expires_at) VALUES($1,now()+interval '7 days') ON CONFLICT(token_hash) DO NOTHING", [hash(demoInvite(user!.id))]);
    }
    res.json({ ok: true });
  });
  app.post('/api/auth/telegram', async (req, res) => {
    if (config.authMode !== 'telegram') throw new AppError(404, 'NOT_FOUND');
    throttle(`auth:${req.ip}`, 30);
    const { initData } = z.object({ initData: z.string().max(20000) }).strict().parse(req.body);
    const telegramId = verifyTelegramInitData(initData, config.botToken);
    const token = await transaction(pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [telegramId]);
      const existing = await client.query('SELECT u.id,u.status FROM telegram_accounts t JOIN users u ON u.id=t.user_id WHERE telegram_user_id=$1', [telegramId]);
      let user = existing.rows[0];
      if (user?.status === 'blocked') throw new AppError(403, 'ACCOUNT_BLOCKED');
      if (!user) {
        user = (await client.query('INSERT INTO users DEFAULT VALUES RETURNING id')).rows[0];
        await client.query('INSERT INTO telegram_accounts(user_id,telegram_user_id) VALUES($1,$2)', [user.id, telegramId]);
      }
      return createSession(user.id, client);
    });
    setSession(res, token, config);
    res.json({ ok: true });
  });
  app.post('/api/telegram/webhook', async (req, res) => {
    const provided = req.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
    if (!config.webhookSecret || Buffer.byteLength(provided) !== Buffer.byteLength(config.webhookSecret) || !timingSafeEqual(Buffer.from(provided), Buffer.from(config.webhookSecret))) throw new AppError(401, 'INVALID_TELEGRAM_AUTH');
    const update = z.object({ update_id: z.number().int(), message: z.object({ text: z.string().optional(), from: z.object({ id: z.number().int() }) }).optional() }).parse(req.body);
    await transaction(pool, async client => {
      const inserted = await client.query('INSERT INTO bot_updates(update_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING update_id', [update.update_id]);
      if (inserted.rowCount && update.message?.text?.startsWith('/start')) {
        const telegramId = update.message.from.id;
        await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [telegramId]);
        const account = await client.query('SELECT user_id FROM telegram_accounts WHERE telegram_user_id=$1', [telegramId]);
        if (!account.rowCount) {
          const { rows } = await client.query('INSERT INTO users DEFAULT VALUES RETURNING id');
          await client.query('INSERT INTO telegram_accounts(user_id,telegram_user_id) VALUES($1,$2)', [rows[0].id, telegramId]);
        }
        await client.query('UPDATE telegram_accounts SET bot_started_at=COALESCE(bot_started_at,now()) WHERE telegram_user_id=$1', [update.message.from.id]);
      }
    });
    res.json({ ok: true });
  });

  app.use('/api', async (req, res, next) => {
    const user = await findUser(req, pool);
    if (!user) throw new AppError(401, 'AUTH_REQUIRED');
    res.locals.user = user;
    next();
  });
  app.post('/api/logout', async (req, res) => {
    await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hash(sessionToken(req) ?? '')]);
    res.clearCookie('questr_session', { path: '/', httpOnly: true, sameSite: 'lax', secure: config.secureCookie });
    res.json({ ok: true });
  });
  app.get('/api/me', async (_req, res) => {
    const user = currentUser(res);
    const [draft, profile, conversation, proposal] = await Promise.all([
      getDraft(pool, user.id), getProfile(pool, user.id), getConversation(pool, user.id), getProposal(pool, user.id),
    ]);
    const consent = await pool.query("SELECT 1 FROM user_consents WHERE user_id=$1 AND kind='ai_interview' AND document_version=$2", [user.id, `${aiConsentVersion}:${config.aiMode}`]);
    const ready = conversation?.mode === config.aiMode && !!consent.rowCount;
    res.json({ user, draft, profile, conversation: ready ? conversation : null, proposal: ready ? proposal : null, demoInvite: config.authMode === 'demo' && user.status === 'pending_invite' ? demoInvite(user.id) : null });
  });
  app.post('/api/register', async (req, res) => {
    const user = currentUser(res);
    throttle(`register:${user.id}`, 10);
    const input = registerSchema.parse(req.body);
    await transaction(pool, async client => {
      const fresh = (await client.query('SELECT status FROM users WHERE id=$1 FOR UPDATE', [user.id])).rows[0];
      if (fresh.status === 'blocked') throw new AppError(403, 'ACCOUNT_BLOCKED');
      if (fresh.status !== 'pending_invite') return;
      const redeemed = await client.query(`UPDATE invites i SET redeemed_by=$1,redeemed_at=now()
        WHERE token_hash=$2 AND redeemed_by IS NULL AND revoked_at IS NULL AND expires_at>now()
        AND (created_by IS NULL OR EXISTS(SELECT 1 FROM users inviter WHERE inviter.id=i.created_by AND inviter.status='active')) RETURNING id`, [user.id, hash(input.invite)]);
      if (!redeemed.rowCount) throw new AppError(400, 'INVALID_INVITE');
      await client.query("UPDATE users SET status='onboarding',locale=$2,updated_at=now() WHERE id=$1", [user.id, input.locale]);
      for (const kind of ['adult', 'terms']) await client.query('INSERT INTO user_consents(user_id,kind,document_version) VALUES($1,$2,$3)', [user.id, kind, termsVersion]);
      await client.query('INSERT INTO profile_drafts(user_id,display_name) VALUES($1,$2)', [user.id, input.displayName]);
    });
    res.json({ draft: await getDraft(pool, user.id) });
  });
  app.use('/api', (_req, res, next) => {
    if (currentUser(res).status === 'pending_invite') throw new AppError(403, 'INVITE_REQUIRED');
    next();
  });
  app.put('/api/draft', async (req, res) => {
    const input = draftInputSchema.parse(req.body);
    const { rows } = await pool.query(`UPDATE profile_drafts SET display_name=$2,avatar_preset_id=$3,intro_markdown=$4,tags=$5,
      mode=$6,current_step=$7,revision=revision+1,updated_at=now() WHERE user_id=$1 AND revision=$8 RETURNING *`,
    [currentUser(res).id, input.displayName, input.avatarId, input.introMarkdown, JSON.stringify(input.tags), input.mode, input.currentStep, input.revision]);
    if (!rows[0]) throw new AppError(409, 'DRAFT_CONFLICT');
    res.json({ draft: mapDraft(rows[0]) });
  });
  app.post('/api/profile/publish', async (req, res) => {
    const { revision } = z.object({ revision: z.number().int().nonnegative() }).strict().parse(req.body);
    const userId = currentUser(res).id;
    await transaction(pool, async client => {
      const { rows } = await client.query('SELECT * FROM profile_drafts WHERE user_id=$1 FOR UPDATE', [userId]);
      if (!rows[0] || rows[0].revision !== revision) throw new AppError(409, 'DRAFT_CONFLICT');
      const draft = draftInputSchema.parse(mapDraft(rows[0]));
      if (!draft.avatarId) throw new AppError(400, 'AVATAR_REQUIRED');
      await client.query(`INSERT INTO profiles(user_id,display_name,avatar_preset_id,intro_markdown) VALUES($1,$2,$3,$4)
        ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,avatar_preset_id=EXCLUDED.avatar_preset_id,
        intro_markdown=EXCLUDED.intro_markdown,revision=profiles.revision+1,updated_at=now()`, [userId, draft.displayName, draft.avatarId, draft.introMarkdown]);
      await client.query('DELETE FROM profile_tags WHERE user_id=$1', [userId]);
      for (const [i, tag] of draft.tags.entries()) {
        await client.query('INSERT INTO profile_tags(user_id,tag_id,custom_label,custom_emoji,locale,position) VALUES($1,$2,$3,$4,$5,$6)',
          [userId, tag.kind === 'catalog' ? tag.code : null, tag.kind === 'custom' ? tag.label : null, tag.kind === 'custom' ? tag.emoji : null, tag.kind === 'custom' ? tag.locale : null, i]);
      }
      await client.query("UPDATE users SET status='active',updated_at=now() WHERE id=$1", [userId]);
    });
    res.json({ profile: await getProfile(pool, userId) });
  });

  app.post('/api/assistant/start', async (req, res) => {
    z.object({ consent: z.literal(true) }).strict().parse(req.body);
    const user = currentUser(res);
    await lockAssistant(user.id, async client => {
      await client.query("INSERT INTO user_consents(user_id,kind,document_version) VALUES($1,'ai_interview',$2) ON CONFLICT DO NOTHING", [user.id, `${aiConsentVersion}:${config.aiMode}`]);
      const existing = await getConversation(client, user.id);
      if (existing?.mode === config.aiMode && existing.messages.length) return;
      const draft = (await getDraft(client, user.id))!;
      // Generate before switching modes. A failed provider request is safely retryable,
      // and a consented upgrade retains answers from the old demo conversation.
      const question = await interviewer.question(existing?.messages ?? [], draft.introMarkdown);
      await transactionOnClient(client, async tx => {
        const id = existing?.id ?? (await tx.query('INSERT INTO ai_conversations(user_id,locale,mode) VALUES($1,$2,$3) RETURNING id', [user.id, user.locale, config.aiMode])).rows[0].id;
        await tx.query('UPDATE ai_conversations SET mode=$2,updated_at=now() WHERE id=$1', [id, config.aiMode]);
        await tx.query("INSERT INTO ai_messages(conversation_id,role,content) VALUES($1,'assistant',$2)", [id, question]);
        await tx.query("UPDATE ai_proposals SET status='rejected',updated_at=now() WHERE user_id=$1 AND status='pending'", [user.id]);
      });
    });
    res.json({ conversation: await getConversation(pool, user.id) });
  });
  async function requireConversation(client: PoolClient, userId: string) {
    const consent = await client.query("SELECT 1 FROM user_consents WHERE user_id=$1 AND kind='ai_interview' AND document_version=$2", [userId, `${aiConsentVersion}:${config.aiMode}`]);
    if (!consent.rowCount) throw new AppError(403, 'AI_CONSENT_REQUIRED');
    const conversation = await getConversation(client, userId);
    if (!conversation || conversation.mode !== config.aiMode) throw new AppError(400, 'CONVERSATION_REQUIRED');
    return conversation;
  }
  app.post('/api/assistant/messages', async (req, res) => {
    const input = messageSchema.parse(req.body);
    const userId = currentUser(res).id;
    await lockAssistant(userId, async client => {
      const conversation = await requireConversation(client, userId);
      const draft = (await getDraft(client, userId))!;
      const inserted = await client.query("INSERT INTO ai_messages(conversation_id,role,content,request_id) VALUES($1,'user',$2,$3) ON CONFLICT(conversation_id,request_id) DO NOTHING RETURNING id", [conversation.id, input.content, input.requestId]);
      const userMessage = inserted.rows[0] ?? (await client.query('SELECT id,content FROM ai_messages WHERE conversation_id=$1 AND request_id=$2', [conversation.id, input.requestId])).rows[0];
      if (userMessage.content && userMessage.content !== input.content) throw new AppError(409, 'REQUEST_CONFLICT');
      if ((await client.query('SELECT 1 FROM ai_messages WHERE reply_to=$1', [userMessage.id])).rowCount) return;
      const messages = await getMessages(client, conversation.id);
      const question = await interviewer.question(messages, draft.introMarkdown);
      await client.query("INSERT INTO ai_messages(conversation_id,role,content,reply_to) VALUES($1,'assistant',$2,$3) ON CONFLICT(reply_to) DO NOTHING", [conversation.id, question, userMessage.id]);
      await client.query('UPDATE ai_conversations SET updated_at=now() WHERE id=$1', [conversation.id]);
    });
    res.json({ conversation: await getConversation(pool, userId) });
  });
  app.post('/api/assistant/proposals', async (req, res) => {
    z.object({}).strict().parse(req.body);
    const userId = currentUser(res).id;
    const result = await lockAssistant(userId, async client => {
      const conversation = await requireConversation(client, userId);
      const draft = (await getDraft(client, userId))!;
      const proposal = await interviewer.proposal(conversation.messages, draft.introMarkdown);
      return transactionOnClient(client, async tx => {
        await tx.query("UPDATE ai_proposals SET status='rejected',updated_at=now() WHERE user_id=$1 AND status='pending'", [userId]);
        const { rows } = await tx.query(`INSERT INTO ai_proposals(user_id,conversation_id,based_on_draft_revision,intro_markdown,suggested_tags,source_ids,base_markdown,change_summary)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [userId, conversation.id, draft.revision, proposal.introMarkdown, JSON.stringify(proposal.suggestedTags), JSON.stringify(proposal.sourceIds), draft.introMarkdown, proposal.changeSummary]);
        return mapProposal(rows[0]);
      });
    });
    res.json({ proposal: result });
  });
  app.post('/api/assistant/proposals/:id/apply', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = z.object({ revision: z.number().int().nonnegative(), tagCodes: z.array(z.string()).max(12) }).strict().parse(req.body);
    const userId = currentUser(res).id;
    await transaction(pool, async client => {
      const proposal = (await client.query("SELECT * FROM ai_proposals WHERE id=$1 AND user_id=$2 AND status='pending' FOR UPDATE", [id, userId])).rows[0];
      if (!proposal) throw new AppError(404, 'NOT_FOUND');
      const row = (await client.query('SELECT * FROM profile_drafts WHERE user_id=$1 FOR UPDATE', [userId])).rows[0];
      if (row.revision !== proposal.based_on_draft_revision || row.revision !== input.revision) throw new AppError(409, 'PROPOSAL_STALE');
      const suggestedCodes = new Set(proposal.suggested_tags.map((t: { code: string }) => t.code));
      if (input.tagCodes.some(code => !suggestedCodes.has(code))) throw new AppError(400, 'INVALID_INPUT');
      const combined: ProfileTag[] = [...row.tags, ...input.tagCodes.map(code => ({ kind: 'catalog' as const, code }))];
      const nextTags = selectedTagsSchema.parse([...new Map(combined.map(t => [tagKey(t), t])).values()]);
      await client.query('UPDATE profile_drafts SET intro_markdown=$2,tags=$3,revision=revision+1,updated_at=now() WHERE user_id=$1', [userId, proposal.intro_markdown, JSON.stringify(nextTags)]);
      await client.query("UPDATE ai_proposals SET status='accepted',updated_at=now() WHERE id=$1", [id]);
    });
    res.json({ draft: await getDraft(pool, userId) });
  });
  app.post('/api/assistant/proposals/:id/reject', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const result = await pool.query("UPDATE ai_proposals SET status='rejected',updated_at=now() WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING id", [id, currentUser(res).id]);
    if (!result.rowCount) throw new AppError(404, 'NOT_FOUND');
    res.json({ ok: true });
  });
  app.use('/api', (_req, _res) => { throw new AppError(404, 'NOT_FOUND'); });
  const dist = resolve('dist');
  if (existsSync(resolve(dist, 'index.html'))) {
    app.use(express.static(dist));
    app.get('/{*path}', (_req, res) => res.sendFile(resolve(dist, 'index.html')));
  }
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) return res.status(error.status).json({ error: error.code });
    if (error instanceof ZodError) return res.status(400).json({ error: 'INVALID_INPUT' });
    if ((error as { type?: string })?.type === 'entity.too.large') return res.status(413).json({ error: 'REQUEST_TOO_LARGE' });
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'INVALID_INPUT' });
    // Do not log request bodies, SQL parameters, answers, credentials or Telegram IDs.
    console.error('QUESTR request failed', error instanceof Error ? error.name : 'UnknownError');
    res.status(500).json({ error: 'SERVER_ERROR' });
  });
  return app;
}
