import express, { type Request, type Response, type NextFunction } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z, ZodError } from 'zod';
import type { Pool, PoolClient } from 'pg';
import type { Config } from './config.ts';
import { AppError } from './errors.ts';
import { clearSession, createSession, demoInvite, findUser, hash, sessionToken, setSession, verifyTelegramUser } from './auth.ts';
import { transaction, transactionOnClient } from './db.ts';
import { Interviewer } from './assistant.ts';
import { ContentReviewer, reviewContent, storedReview } from './moderation.ts';
import { getConversation, getDraft, getMessages, getProfile, getProposal, mapDraft, mapProposal } from './store.ts';
import { aiConsentVersion, termsVersion } from '../shared/catalog.ts';
import { askMeTopicsSchema, draftInputSchema, messageSchema, registerSchema, tagKey, selectedTagsSchema, type ProfileTag } from '../shared/schema.ts';
import { preferredLocale } from '../shared/locale.ts';
import { locationIdSchema } from '../shared/discovery.ts';
import { getDiscovery, saveDiscovery, searchLocations } from './discovery.ts';
import { can, requireCapability } from './permissions.ts';
import { Adventures } from './events.ts';
import { eventRoutes } from './event-routes.ts';
import { inviteRoutes } from './invite-routes.ts';
import { redeemInvite } from './invite-redemption.ts';
import { romanceConsentVersion, romanceInputSchema } from '../shared/romance.ts';
import { placeRoutes } from './place-routes.ts';
import { brevoSender, emailInviteRoutes, type EmailSender } from './email-invites.ts';
import { parseCommunities } from '../shared/communities.ts';
import { OperationalMetrics } from './metrics.ts';

type User = { id: string; status: string; locale: string };
const currentUser = (res: Response): User => res.locals.user;

export function createApp(pool: Pool, config: Config, interviewer?: Interviewer, reviewer?: ContentReviewer, sendEmail?: EmailSender, metrics?: OperationalMetrics) {
  metrics ??= config.metricsPath ? new OperationalMetrics(pool) : undefined;
  interviewer ??= new Interviewer(config, fetch, metrics);
  reviewer ??= new ContentReviewer(config, fetch, metrics);
  const app = express();
  app.disable('x-powered-by');
  if (metrics && config.metricsPath) metrics.install(app, config.metricsPath, config.metricsToken);
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
  app.get('/api/config', (_req, res) => res.json({ authMode: config.authMode, aiMode: config.aiMode, botUsername: 'questr_game', termsVersion, googleMapsBrowserKey: config.googleMapsBrowserKey, posthogProjectKey: config.posthogProjectKey }));

  app.post('/api/auth/demo', async (req, res) => {
    if (config.authMode !== 'demo') throw new AppError(404, 'NOT_FOUND');
    const { browserLanguage } = z.object({ browserLanguage: z.string().max(64).optional() }).strict().parse(req.body);
    let user = await findUser(req, pool);
    if (!user) {
      // Resuming a valid local session does not create an account. Keep the
      // creation limit for anonymous browsers without charging every reload.
      throttle(`auth:${req.ip}`, 30);
      const created = await transaction(pool, async client => {
        const { rows } = await client.query('INSERT INTO users(locale) VALUES($1) RETURNING id,status,locale', [preferredLocale(browserLanguage)]);
        return { user: rows[0], token: await createSession(rows[0].id, client) };
      });
      user = created.user;
      setSession(res, created.token, config);
    }
    if (browserLanguage) await pool.query("UPDATE users SET locale=$2 WHERE id=$1 AND locale_source='auto' AND locale<>$2", [user!.id, preferredLocale(browserLanguage)]);
    if (user!.status === 'pending_invite') {
      await pool.query("INSERT INTO invites(token_hash,expires_at) VALUES($1,now()+interval '7 days') ON CONFLICT(token_hash) DO NOTHING", [hash(demoInvite(user!.id))]);
    }
    res.json({ ok: true });
  });
  app.post('/api/auth/telegram', async (req, res) => {
    if (config.authMode !== 'telegram') throw new AppError(404, 'NOT_FOUND');
    throttle(`auth:${req.ip}`, 30);
    const { initData, browserLanguage } = z.object({ initData: z.string().max(20000), browserLanguage: z.string().max(64).optional() }).strict().parse(req.body);
    const telegramUser = verifyTelegramUser(initData, config.botToken);
    const telegramId = telegramUser.id;
    const automaticLocale = preferredLocale(telegramUser.languageCode ?? browserLanguage);
    const token = await transaction(pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [telegramId]);
      const existing = await client.query('SELECT u.id,u.status FROM telegram_accounts t JOIN users u ON u.id=t.user_id WHERE telegram_user_id=$1', [telegramId]);
      let user = existing.rows[0];
      if (user?.status === 'blocked') throw new AppError(403, 'ACCOUNT_BLOCKED');
      if (!user) {
        user = (await client.query('INSERT INTO users(locale) VALUES($1) RETURNING id', [automaticLocale])).rows[0];
        await client.query('INSERT INTO telegram_accounts(user_id,telegram_user_id) VALUES($1,$2)', [user.id, telegramId]);
      }
      await client.query("UPDATE users SET locale=$2 WHERE id=$1 AND locale_source='auto' AND locale<>$2", [user.id, automaticLocale]);
      return createSession(user.id, client);
    });
    setSession(res, token, config);
    res.json({ ok: true, sessionToken: token });
  });
  app.post('/api/telegram/webhook', async (req, res) => {
    const provided = req.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
    if (!config.webhookSecret || Buffer.byteLength(provided) !== Buffer.byteLength(config.webhookSecret) || !timingSafeEqual(Buffer.from(provided), Buffer.from(config.webhookSecret))) throw new AppError(401, 'INVALID_TELEGRAM_AUTH');
    const telegramUser = z.object({ id: z.number().int(), language_code: z.string().max(64).optional() }).passthrough();
    const telegramChat = z.object({ id: z.number().int(), type: z.string() }).passthrough();
    const update = z.object({ update_id: z.number().int(),
      message: z.object({ text: z.string().max(20000).optional(), caption: z.string().max(2000).optional(),
        photo: z.array(z.object({ file_id: z.string().min(1).max(1024) }).passthrough()).min(1).max(20).optional(),
        message_thread_id: z.number().int().optional(), chat: telegramChat.optional(), from: telegramUser.optional() }).optional(),
      callback_query: z.object({ id: z.string().max(128), from: telegramUser, data: z.string().max(64).optional(), message: z.object({ message_id: z.number().int(), chat: telegramChat }).optional() }).optional(),
    }).parse(req.body);
    await transaction(pool, async client => {
      const inserted = await client.query('INSERT INTO bot_updates(update_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING update_id', [update.update_id]);
      if (!inserted.rowCount) return;
      const message = update.message;
      if (message?.from && message.chat?.type === 'private' && message.chat.id === message.from.id) {
        if (/^\/start(?:@questr_game)?(?: |$)/.test(message.text ?? '')) {
          const telegramId = message.from.id;
          await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [telegramId]);
          const account = await client.query('SELECT user_id FROM telegram_accounts WHERE telegram_user_id=$1', [telegramId]);
          if (!account.rowCount) {
            const { rows } = await client.query('INSERT INTO users(locale) VALUES($1) RETURNING id', [preferredLocale(message.from.language_code)]);
            await client.query('INSERT INTO telegram_accounts(user_id,telegram_user_id) VALUES($1,$2)', [rows[0].id, telegramId]);
          }
          if (message.from.language_code) await client.query("UPDATE users SET locale=$2 WHERE id=(SELECT user_id FROM telegram_accounts WHERE telegram_user_id=$1) AND locale_source='auto'", [telegramId, preferredLocale(message.from.language_code)]);
          await client.query('UPDATE telegram_accounts SET bot_started_at=COALESCE(bot_started_at,now()) WHERE telegram_user_id=$1', [message.from.id]);
        }
        if (message.text || message.photo?.length) {
          const incoming = await client.query(`INSERT INTO bot_inbox(update_id,user_id,text,thread_id,photo_file_id)
            SELECT $1,user_id,$3,$4,$5 FROM telegram_accounts WHERE telegram_user_id=$2 RETURNING user_id`,
          [update.update_id, message.from.id, message.photo?.length ? message.caption ?? '' : message.text, message.message_thread_id ?? null, message.photo?.at(-1)?.file_id ?? null]);
          if (incoming.rowCount) console.info('QUESTR bot message received:', JSON.stringify({
            updateId: update.update_id, userId: incoming.rows[0].user_id,
            telegramUserId: message.from.id, threadId: message.message_thread_id ?? null,
          }));
        }
      }
      const callback = update.callback_query;
      if (callback?.data && callback.message?.chat.type === 'private' && callback.message.chat.id === callback.from.id) {
        await client.query(`INSERT INTO bot_inbox(update_id,user_id,text,callback_query_id,callback_data,callback_message_id)
          SELECT $1,user_id,'',$3,$4,$5 FROM telegram_accounts WHERE telegram_user_id=$2`,
        [update.update_id, callback.from.id, callback.id, callback.data, callback.message.message_id]);
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
    clearSession(res, config);
    res.json({ ok: true });
  });
  app.get('/api/me', async (_req, res) => {
    const user = currentUser(res);
    const [draft, profile, conversation, proposal, discovery, admin, inviteCreate, emailRegistration] = await Promise.all([
      getDraft(pool, user.id), getProfile(pool, user.id), getConversation(pool, user.id), getProposal(pool, user.id), getDiscovery(pool, user.id),
      can(pool, user.id, 'admin', { type: 'global' }), can(pool, user.id, 'invite.create', { type: 'global' }),
      pool.query('SELECT 1 FROM verified_emails WHERE user_id=$1 AND registration_allowed=true LIMIT 1', [user.id]),
    ]);
    const consent = await pool.query("SELECT 1 FROM user_consents WHERE user_id=$1 AND kind='ai_interview' AND document_version=$2", [user.id, `${aiConsentVersion}:${config.aiMode}`]);
    const ready = conversation?.mode === config.aiMode && !!consent.rowCount;
    const review = draft ? await storedReview(pool, reviewer, draft.introMarkdown) : null;
    const topicReviews = draft ? await Promise.all(draft.askMeTopics.map(topic => storedReview(pool, reviewer, topic))) : [];
    res.json({ user, permissions: { admin, inviteCreate }, draft, profile, discovery, conversation: ready ? conversation : null, proposal: ready ? proposal : null, bioReview: review && draft ? { ...review, introMarkdown: draft.introMarkdown, askMeTopics: draft.askMeTopics, topicReviews: topicReviews.every(Boolean) ? topicReviews : undefined } : null, demoInvite: config.authMode === 'demo' && user.status === 'pending_invite' ? demoInvite(user.id) : null, emailRegistrationAllowed: !!emailRegistration.rowCount });
  });
  app.get('/api/communities', async (_req, res) => {
    const { rows } = await pool.query('SELECT id,parent_id AS "parentId",name_en AS en,name_ru AS ru FROM communities ORDER BY id');
    res.json({ communities: parseCommunities({ communities: rows.map(row => ({ id: row.id, parentId: row.parentId, name: { en: row.en, ru: row.ru } })) }) });
  });
  app.put('/api/locale', async (req, res) => {
    const { locale } = z.object({ locale: z.enum(['en', 'ru']) }).strict().parse(req.body);
    await pool.query("UPDATE users SET locale=$2,locale_source='manual',updated_at=now() WHERE id=$1", [currentUser(res).id, locale]);
    res.json({ locale });
  });
  app.use('/api/email-invites', emailInviteRoutes(pool, config, throttle, sendEmail ?? brevoSender(config, metrics)));
  app.post('/api/register', async (req, res) => {
    const user = currentUser(res);
    throttle(`register:${user.id}`, 10);
    const input = registerSchema.parse(req.body);
    await transaction(pool, async client => {
      const fresh = (await client.query('SELECT status FROM users WHERE id=$1 FOR UPDATE', [user.id])).rows[0];
      if (fresh.status === 'blocked') throw new AppError(403, 'ACCOUNT_BLOCKED');
      if (fresh.status !== 'pending_invite') return;
      if (input.invite) await redeemInvite(client, user.id, input.invite);
      else if (!(await client.query('SELECT 1 FROM verified_emails WHERE user_id=$1 AND registration_allowed=true LIMIT 1', [user.id])).rowCount) throw new AppError(403, 'INVITE_REQUIRED');
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
  app.use('/api/events', (req, res, next) => { if (req.method !== 'GET') throttle(`events:${currentUser(res).id}`, 20); next(); });
  app.use('/api/events', eventRoutes(new Adventures(pool, reviewer)));
  app.use('/api/places', placeRoutes(pool));
  app.use('/api/invites', (req, res, next) => { if (req.method !== 'GET') throttle(`invites:${currentUser(res).id}`, 30); next(); });
  app.use('/api/invites', inviteRoutes(pool));
  app.put('/api/draft', async (req, res) => {
    await requireCapability(pool, currentUser(res).id, 'profile.edit', { type: 'profile', id: currentUser(res).id });
    const input = draftInputSchema.parse(req.body);
    const { rows } = await pool.query(`UPDATE profile_drafts SET display_name=$2,avatar_preset_id=$3,intro_markdown=$4,tags=$5,
      mode=$6,current_step=$7,spoken_languages=$9,open_to_romance=false,ask_me_topics=$10,avatar_appearance=$11,revision=revision+1,updated_at=now() WHERE user_id=$1 AND revision=$8 RETURNING *`,
    [currentUser(res).id, input.displayName, input.avatarId, input.introMarkdown, JSON.stringify(input.tags), input.mode, input.currentStep, input.revision, input.spokenLanguages, JSON.stringify(input.askMeTopics), input.avatarAppearance ? JSON.stringify(input.avatarAppearance) : null]);
    if (!rows[0]) throw new AppError(409, 'DRAFT_CONFLICT');
    res.json({ draft: mapDraft(rows[0]) });
  });
  app.post('/api/profile/publish', async (req, res) => {
    const { revision } = z.object({ revision: z.number().int().nonnegative() }).strict().parse(req.body);
    const userId = currentUser(res).id;
    const firstPublication = currentUser(res).status !== 'active';
    await requireCapability(pool, userId, 'profile.edit', { type: 'profile', id: userId });
    if (firstPublication) {
      const discovery = await getDiscovery(pool, userId);
      if (!discovery.locationIds.length || !discovery.languageCodes.length) throw new AppError(422, 'DISCOVERY_REQUIRED');
    }
    const checked = await validateDraft(userId, revision);
    if (checked.status === 'blocked' || checked.topicReviews.some(review => review.status === 'blocked')) throw new AppError(422, 'CONTENT_REQUIRES_CHANGES', { bioReview: checked });
    await transaction(pool, async client => {
      await requireCapability(client, userId, 'profile.edit', { type: 'profile', id: userId });
      const { rows } = await client.query('SELECT * FROM profile_drafts WHERE user_id=$1 FOR UPDATE', [userId]);
      if (!rows[0] || rows[0].revision !== revision) throw new AppError(409, 'DRAFT_CONFLICT');
      const draft = draftInputSchema.parse(mapDraft(rows[0]));
      if (!draft.avatarId) throw new AppError(400, 'AVATAR_REQUIRED');
      if (firstPublication) {
        const discovery = await getDiscovery(client, userId);
        if (!discovery.locationIds.length || !discovery.languageCodes.length) throw new AppError(422, 'DISCOVERY_REQUIRED');
      }
      await client.query(`INSERT INTO profiles(user_id,display_name,avatar_preset_id,intro_markdown,open_to_romance,ask_me_topics,avatar_appearance) VALUES($1,$2,$3,$4,false,$5,$6)
        ON CONFLICT(user_id) DO UPDATE SET display_name=EXCLUDED.display_name,avatar_preset_id=EXCLUDED.avatar_preset_id,
        intro_markdown=EXCLUDED.intro_markdown,open_to_romance=false,ask_me_topics=EXCLUDED.ask_me_topics,avatar_appearance=EXCLUDED.avatar_appearance,revision=profiles.revision+1,updated_at=now()`, [userId, draft.displayName, draft.avatarId, draft.introMarkdown, JSON.stringify(draft.askMeTopics), draft.avatarAppearance ? JSON.stringify(draft.avatarAppearance) : null]);
      await client.query('DELETE FROM profile_tags WHERE user_id=$1', [userId]);
      await client.query('DELETE FROM profile_languages WHERE user_id=$1', [userId]);
      await client.query('INSERT INTO profile_languages(user_id,language_code,position) SELECT $1,code,ordinality-1 FROM unnest($2::text[]) WITH ORDINALITY AS x(code,ordinality)', [userId, draft.spokenLanguages]);
      for (const [i, tag] of draft.tags.entries()) {
        await client.query('INSERT INTO profile_tags(user_id,tag_id,custom_label,custom_emoji,locale,position) VALUES($1,$2,$3,$4,$5,$6)',
          [userId, tag.kind === 'catalog' ? tag.code : null, tag.kind === 'custom' ? tag.label : null, tag.kind === 'custom' ? tag.emoji : null, tag.kind === 'custom' ? tag.locale : null, i]);
      }
      await client.query("UPDATE users SET status='active',updated_at=now() WHERE id=$1", [userId]);
    });
    res.json({ profile: await getProfile(pool, userId) });
  });

  async function romanceSettings(userId: string) {
    const { rows } = await pool.query(`SELECT p.revision,r.gender_code,r.interested_in,r.consent_version
      FROM profiles p JOIN users u ON u.id=p.user_id AND u.status='active'
      LEFT JOIN romance_preferences r ON r.user_id=p.user_id WHERE p.user_id=$1`, [userId]);
    if (!rows[0]) throw new AppError(403, 'PROFILE_REQUIRED');
    const row = rows[0];
    return { enabled: !!row.gender_code, gender: row.gender_code ?? null, interestedIn: row.interested_in ?? [], revision: row.revision, consentVersion: row.consent_version ?? null };
  }
  async function disableRomance(userId: string) {
    await transaction(pool, async db => {
      await requireCapability(db, userId, 'profile.edit', { type: 'profile', id: userId });
      const profile = (await db.query(`SELECT p.revision FROM profiles p JOIN users u ON u.id=p.user_id AND u.status='active'
        WHERE p.user_id=$1 FOR UPDATE OF p`, [userId])).rows[0];
      if (!profile) throw new AppError(403, 'PROFILE_REQUIRED');
      const deleted = await db.query('DELETE FROM romance_preferences WHERE user_id=$1', [userId]);
      if (deleted.rowCount) await db.query('UPDATE profiles SET revision=revision+1,updated_at=now() WHERE user_id=$1', [userId]);
    });
  }
  app.get('/api/me/romance', async (_req, res) => {
    res.json({ romance: await romanceSettings(currentUser(res).id) });
  });
  app.put('/api/me/romance', async (req, res) => {
    const input = romanceInputSchema.parse(req.body);
    const userId = currentUser(res).id;
    await transaction(pool, async db => {
      await requireCapability(db, userId, 'profile.edit', { type: 'profile', id: userId });
      const profile = (await db.query(`SELECT p.revision FROM profiles p JOIN users u ON u.id=p.user_id AND u.status='active'
        WHERE p.user_id=$1 FOR UPDATE OF p`, [userId])).rows[0];
      if (!(await db.query("SELECT 1 FROM user_consents WHERE user_id=$1 AND kind='adult'", [userId])).rowCount) throw new AppError(403, 'ADULT_CONSENT_REQUIRED');
      if (!profile || profile.revision !== input.revision) throw new AppError(409, 'PROFILE_CONFLICT');
      await db.query(`INSERT INTO romance_preferences(user_id,gender_code,interested_in,consent_version) VALUES($1,$2,$3,$4)
        ON CONFLICT(user_id) DO UPDATE SET gender_code=EXCLUDED.gender_code,interested_in=EXCLUDED.interested_in,
        consent_version=EXCLUDED.consent_version,consented_at=now(),updated_at=now()`, [userId, input.gender, input.interestedIn, romanceConsentVersion]);
      await db.query('UPDATE profiles SET revision=revision+1,updated_at=now() WHERE user_id=$1', [userId]);
    });
    res.json({ romance: await romanceSettings(userId) });
  });
  app.delete('/api/me/romance', async (_req, res) => {
    const userId = currentUser(res).id;
    await disableRomance(userId);
    res.json({ romance: await romanceSettings(userId) });
  });
  // Legacy clients may withdraw consent, but cannot turn the old flag into a new opt-in.
  app.put('/api/profile/romance', async (req, res) => {
    const input = z.object({ openToRomance: z.boolean(), revision: z.number().int().nonnegative() }).strict().parse(req.body);
    if (input.openToRomance) throw new AppError(409, 'ROMANCE_SETUP_REQUIRED');
    const userId = currentUser(res).id;
    await disableRomance(userId);
    res.json({ profile: await getProfile(pool, userId), draft: await getDraft(pool, userId) });
  });

  app.get('/api/locations', async (req, res) => {
    const input = z.object({ q: z.string().max(100).optional(), parentId: locationIdSchema.optional(), ids: z.string().max(2000).optional() }).strict().parse(req.query);
    const ids = input.ids === undefined ? undefined : z.array(locationIdSchema).max(50).parse(input.ids.split(','));
    res.json({ locations: await searchLocations(pool, { query: input.q, parentId: input.parentId, ids }) });
  });
  app.put('/api/discovery', async (req, res) => {
    res.json({ discovery: await saveDiscovery(pool, currentUser(res).id, req.body) });
  });

  async function validateDraft(userId: string, revision: number) {
    throttle(`review:${userId}`, 15);
    const draft = await getDraft(pool, userId);
    if (!draft || draft.revision !== revision) throw new AppError(409, 'DRAFT_CONFLICT');
    const draftReviewer = reviewer ?? new ContentReviewer(config, fetch, metrics);
    const [review, ...topicReviews] = await Promise.all([draft.introMarkdown, ...draft.askMeTopics].map(text => reviewContent(pool, draftReviewer, text)));
    // Never attach a completed review to text edited while the model was running.
    const latest = await getDraft(pool, userId);
    if (!latest || latest.revision !== draft.revision) throw new AppError(409, 'REVIEW_STALE');
    return { ...review, introMarkdown: draft.introMarkdown, askMeTopics: draft.askMeTopics, topicReviews };
  }
  app.post('/api/draft/validate', async (req, res) => {
    const { revision } = z.object({ revision: z.number().int().nonnegative() }).strict().parse(req.body);
    res.json({ bioReview: await validateDraft(currentUser(res).id, revision) });
  });

  app.post('/api/assistant/start', async (req, res) => {
    z.object({ consent: z.literal(true) }).strict().parse(req.body);
    const user = currentUser(res);
    await lockAssistant(user.id, async client => {
      await client.query("INSERT INTO user_consents(user_id,kind,document_version) VALUES($1,'ai_interview',$2) ON CONFLICT DO NOTHING", [user.id, `${aiConsentVersion}:${config.aiMode}`]);
      const existing = await getConversation(client, user.id);
      if (existing?.mode === config.aiMode && existing.messages.length) return;
      const draft = (await getDraft(client, user.id))!;
      const bioReview = await reviewContent(client, reviewer, draft.introMarkdown);
      // Generate before switching modes. A failed provider request is safely retryable,
      // and a consented upgrade retains answers from the old demo conversation.
      const question = await interviewer.question(existing?.messages ?? [], draft.introMarkdown, bioReview.status === 'blocked', draft.tags, preferredLocale(currentUser(res).locale));
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
  app.post('/api/assistant/review', async (_req, res) => {
    const userId = currentUser(res).id;
    await lockAssistant(userId, async client => {
      const conversation = await requireConversation(client, userId);
      const { rows } = await client.query("SELECT id,content FROM ai_messages WHERE conversation_id=$1 AND role='user' AND kind='text' AND review_version IS DISTINCT FROM $2 ORDER BY sequence", [conversation.id, reviewer.key]);
      for (const row of rows) {
        const review = await reviewContent(client, reviewer, row.content);
        await client.query('UPDATE ai_messages SET content_review=$2,review_version=$3 WHERE id=$1', [row.id, JSON.stringify(review), reviewer.key]);
      }
    });
    res.json({ conversation: await getConversation(pool, userId) });
  });
  app.post('/api/assistant/messages', async (req, res) => {
    const input = messageSchema.parse(req.body);
    const kind = 'action' in input ? input.action : 'text';
    const content = 'content' in input ? input.content : '';
    const userId = currentUser(res).id;
    await lockAssistant(userId, async client => {
      const conversation = await requireConversation(client, userId);
      const draft = (await getDraft(client, userId))!;
      const inserted = await client.query("INSERT INTO ai_messages(conversation_id,role,content,request_id,kind) VALUES($1,'user',$2,$3,$4) ON CONFLICT(conversation_id,request_id) DO NOTHING RETURNING id,content,kind", [conversation.id, content, input.requestId, kind]);
      const userMessage = inserted.rows[0] ?? (await client.query('SELECT id,content,kind FROM ai_messages WHERE conversation_id=$1 AND request_id=$2', [conversation.id, input.requestId])).rows[0];
      if (userMessage.content !== content || userMessage.kind !== kind) throw new AppError(409, 'REQUEST_CONFLICT');
      if ((await client.query('SELECT 1 FROM ai_messages WHERE reply_to=$1', [userMessage.id])).rowCount) return;
      const review = kind === 'text' ? await reviewContent(client, reviewer, content) : null;
      if (review) await client.query('UPDATE ai_messages SET content_review=$2,review_version=$3 WHERE id=$1', [userMessage.id, JSON.stringify(review), reviewer.key]);
      const messages = await getMessages(client, conversation.id);
      const question = await interviewer.question(messages, draft.introMarkdown, review?.status === 'blocked', draft.tags, preferredLocale(currentUser(res).locale));
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
      const proposal = await interviewer.proposal(conversation.messages, draft.introMarkdown, preferredLocale(currentUser(res).locale), draft.askMeTopics);
      const generatedReviews = await Promise.all([proposal.introMarkdown, ...proposal.suggestedAskMeTopics.map(topic => topic.text)].map(text => reviewContent(client, reviewer, text)));
      if (generatedReviews.some(review => review.status === 'blocked')) throw new AppError(422, 'ASSISTANT_DRAFT_REJECTED');
      return transactionOnClient(client, async tx => {
        await tx.query("UPDATE ai_proposals SET status='rejected',updated_at=now() WHERE user_id=$1 AND status='pending'", [userId]);
        const { rows } = await tx.query(`INSERT INTO ai_proposals(user_id,conversation_id,based_on_draft_revision,intro_markdown,suggested_tags,source_ids,base_markdown,change_summary,suggested_ask_me_topics)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [userId, conversation.id, draft.revision, proposal.introMarkdown, JSON.stringify(proposal.suggestedTags), JSON.stringify(proposal.sourceIds), draft.introMarkdown, proposal.changeSummary, JSON.stringify(proposal.suggestedAskMeTopics)]);
        return mapProposal(rows[0]);
      });
    });
    res.json({ proposal: result });
  });
  app.post('/api/assistant/proposals/:id/apply', async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    const input = z.object({ revision: z.number().int().nonnegative(), tagCodes: z.array(z.string()).max(12), askMeTopicIndexes: z.array(z.number().int().nonnegative()).max(3).default([]) }).strict().parse(req.body);
    const userId = currentUser(res).id;
    await requireCapability(pool, userId, 'profile.edit', { type: 'profile', id: userId });
    await transaction(pool, async client => {
      const proposal = (await client.query("SELECT * FROM ai_proposals WHERE id=$1 AND user_id=$2 AND status='pending' FOR UPDATE", [id, userId])).rows[0];
      if (!proposal) throw new AppError(404, 'NOT_FOUND');
      const row = (await client.query('SELECT * FROM profile_drafts WHERE user_id=$1 FOR UPDATE', [userId])).rows[0];
      if (row.revision !== proposal.based_on_draft_revision || row.revision !== input.revision) throw new AppError(409, 'PROPOSAL_STALE');
      const suggestedCodes = new Set(proposal.suggested_tags.map((t: { code: string }) => t.code));
      if (input.tagCodes.some(code => !suggestedCodes.has(code))) throw new AppError(400, 'INVALID_INPUT');
      if (new Set(input.askMeTopicIndexes).size !== input.askMeTopicIndexes.length || input.askMeTopicIndexes.some(index => index >= proposal.suggested_ask_me_topics.length)) throw new AppError(400, 'INVALID_INPUT');
      const combined: ProfileTag[] = [...row.tags, ...input.tagCodes.map(code => ({ kind: 'catalog' as const, code }))];
      const nextTags = selectedTagsSchema.parse([...new Map(combined.map(t => [tagKey(t), t])).values()]);
      const nextTopics = askMeTopicsSchema.parse([...row.ask_me_topics, ...input.askMeTopicIndexes.map(index => proposal.suggested_ask_me_topics[index].text)]);
      await client.query('UPDATE profile_drafts SET intro_markdown=$2,tags=$3,ask_me_topics=$4,revision=revision+1,updated_at=now() WHERE user_id=$1', [userId, proposal.intro_markdown, JSON.stringify(nextTags), JSON.stringify(nextTopics)]);
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
    if (error instanceof AppError) return res.status(error.status).json({ error: error.code, ...(error.details ? { details: error.details } : {}) });
    if (error instanceof ZodError) return res.status(400).json({ error: 'INVALID_INPUT' });
    if ((error as { type?: string })?.type === 'entity.too.large') return res.status(413).json({ error: 'REQUEST_TOO_LARGE' });
    if (error instanceof SyntaxError) return res.status(400).json({ error: 'INVALID_INPUT' });
    // Do not log request bodies, SQL parameters, answers, credentials or Telegram IDs.
    console.error('QUESTR request failed', error instanceof Error ? error.name : 'UnknownError');
    res.status(500).json({ error: 'SERVER_ERROR' });
  });
  return app;
}
