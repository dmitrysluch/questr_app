import { randomUUID } from 'node:crypto';
import { hash } from './auth.ts';
import { Router } from 'express';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { dateConsentVersion, dateCreateSchema, dateReopenSchema, dateResponseSchema, datePeriodSchema, type DateCard, type DateDetail, type DateWindow } from '../shared/dates.ts';
import { romanceConsentVersion } from '../shared/romance.ts';
import { hasPublicLink, wallTime, wallTimeToInstant } from '../shared/events.ts';
import { discoveryFilterSchema } from '../shared/discovery.ts';
import type { DiscoveryFilter } from '../shared/discovery.ts';
import { AppError } from './errors.ts';
import { transaction } from './db.ts';
import { getDiscovery, validateDiscoveryFilter } from './discovery.ts';
import { hasCommunityAccess } from './communities.ts';
import { reviewContent, type ContentReviewer } from './moderation.ts';
import { can } from './permissions.ts';
import { queueBot } from './event-notifications.ts';
import { prepareDatePhoto, cleanupDatePhotoDeletions, type DatePhotoStorage } from './date-photo-storage.ts';
import type { Config } from './config.ts';

type Db = Pool | PoolClient;
const uuid = (value: unknown) => z.uuid().parse(value);
const periods = { morning: [8, 12], day: [12, 18], evening: [18, 23] } as const;
const contactPattern = /(?:https?:\/\/|www\.|@[\p{L}\p{N}_]{3,}|(?:\+?\d[\d\s().-]{7,}\d))/iu;
const dateProjection = (allRounds = false) => `SELECT d.*,r.id AS round_id,r.number AS round_number,r.status AS round_status,
  r.request_id AS round_request_id,r.request_hash AS round_request_hash,
  p.display_name,p.intro_markdown,p.ask_me_topics,l.name AS location_name,l.parent_id
  FROM dates d ${allRounds ? 'JOIN date_rounds r ON r.date_id=d.id' : 'JOIN LATERAL (SELECT * FROM date_rounds WHERE date_id=d.id ORDER BY number DESC LIMIT 1) r ON true'}
  JOIN profiles p ON p.user_id=d.owner_id JOIN locations l ON l.id=d.location_id`;

function localDay(instant: string, zone: string) { return wallTime(instant, zone).slice(0, 10); }
function windowBounds(day: string, period: keyof typeof periods, zone: string) {
  const [first, last] = periods[period];
  try { return [Date.parse(wallTimeToInstant(`${day}T${String(first).padStart(2, '0')}:00`, zone)),
    Date.parse(wallTimeToInstant(`${day}T${String(last).padStart(2, '0')}:00`, zone))] as const; }
  catch { throw new AppError(400, 'DATE_WINDOW_INVALID'); }
}
function validateWindows(windows: DateWindow[], zone: string) {
  const today = localDay(new Date().toISOString(), zone);
  const todayUtc = Date.parse(`${today}T00:00:00Z`);
  const seen = new Set<string>();
  for (const item of windows) {
    const key = `${item.day}:${item.period}`;
    if (seen.has(key)) throw new AppError(400, 'DATE_WINDOW_INVALID');
    seen.add(key);
    const diff = (Date.parse(`${item.day}T00:00:00Z`) - todayUtc) / 86400000;
    if (!Number.isInteger(diff) || diff < 0 || diff > 13) throw new AppError(400, 'DATE_WINDOW_INVALID');
    const [, end] = windowBounds(item.day, item.period, zone);
    if (end - Date.now() < 2 * 3600000) throw new AppError(400, 'DATE_WINDOW_INVALID');
  }
}
async function eligible(db: Db, userId: string, requirePhoto = true) {
  const result = await db.query(`SELECT 1 FROM users u JOIN profiles p ON p.user_id=u.id
    JOIN romance_preferences rp ON rp.user_id=u.id AND rp.consent_version=$2
    JOIN date_settings ds ON ds.user_id=u.id AND ds.enabled AND NOT ds.paused AND ds.consent_version=$3
    ${requirePhoto ? "JOIN date_photos ph ON ph.user_id=u.id AND ph.status='approved'" : ''}
    WHERE u.id=$1 AND u.status='active' AND EXISTS(SELECT 1 FROM user_consents c WHERE c.user_id=u.id AND c.kind='adult')`,
  [userId, romanceConsentVersion, dateConsentVersion]);
  return !!result.rowCount;
}
async function requireEligible(db: Db, userId: string) { if (!await eligible(db, userId)) throw new AppError(403, 'DATE_SETUP_REQUIRED'); }
async function pairAllowed(db: Db, a: string, b: string) {
  const result = await db.query(`SELECT 1 FROM romance_preferences x JOIN romance_preferences y ON y.user_id=$2
    WHERE x.user_id=$1 AND x.consent_version=$3 AND y.consent_version=$3
      AND x.gender_code=ANY(y.interested_in) AND y.gender_code=ANY(x.interested_in)
      AND NOT EXISTS(SELECT 1 FROM dm_conversations c WHERE c.first_user_id=LEAST($1::uuid,$2::uuid)
        AND c.second_user_id=GREATEST($1::uuid,$2::uuid) AND c.status='blocked')
      AND NOT EXISTS(SELECT 1 FROM date_blocks b WHERE b.blocker_id IN ($1::uuid,$2::uuid)
        AND b.blocked_id IN ($1::uuid,$2::uuid))`, [a, b, romanceConsentVersion]);
  return !!result.rowCount;
}
async function windowsFor(db: Db, roundId: string) {
  const rows = (await db.query('SELECT id,local_day::text AS day,period FROM date_windows WHERE round_id=$1 ORDER BY local_day,period', [roundId])).rows;
  return rows as Array<DateWindow & { id: string }>;
}
function activeWindow(windows: DateWindow[], zone: string) { return windows.some(w => windowBounds(w.day, w.period, zone)[1] > Date.now()); }
async function isParticipant(db: Db, row: any, userId: string) {
  if (row.owner_id === userId) return true;
  return !!(await db.query('SELECT 1 FROM date_responses WHERE round_id=$1 AND user_id=$2', [row.round_id, userId])).rowCount;
}
async function mayDiscover(db: Db, row: any, userId: string, filter: DiscoveryFilter | null) {
  if (row.round_status !== 'open' || row.owner_id === userId || !await eligible(db, row.owner_id) ||
    !await eligible(db, userId) || !await pairAllowed(db, row.owner_id, userId)) return false;
  if (row.community_id && !await hasCommunityAccess(db, userId, row.community_id)) return false;
  if (filter) {
    if (!filter.locationIds.includes(row.location_id) && !filter.locationIds.includes(row.parent_id)) return false;
    if (filter.languageCodes.length && !filter.languageCodes.includes(row.language_code)) return false;
    const c = filter.communityFilter;
    if (c.mode === 'mine' && !row.community_id) return false;
    if (c.mode === 'community') {
      if (!row.community_id) return false;
      if (!(await db.query('SELECT 1 FROM community_closure WHERE ancestor_id=$1 AND descendant_id=$2', [c.communityId, row.community_id])).rowCount) return false;
    }
  }
  return activeWindow(await windowsFor(db, row.round_id), row.time_zone);
}
async function loadRow(db: Db, dateId: string, roundId?: string) {
  return (await db.query(`${dateProjection(!!roundId)} WHERE d.id=$1 ${roundId ? 'AND r.id=$2' : ''}`, roundId ? [dateId, roundId] : [dateId])).rows[0];
}
async function requireVisible(db: Db, dateId: string, userId: string, roundId?: string) {
  const row = await loadRow(db, dateId, roundId);
  if (!row) throw new AppError(404, 'NOT_FOUND');
  const participant = await isParticipant(db, row, userId);
  if (participant) {
    if (!(await db.query("SELECT 1 FROM users WHERE id=$1 AND status='active'", [userId])).rowCount) throw new AppError(404, 'NOT_FOUND');
  } else {
    const latest = roundId ? await loadRow(db, dateId) : row;
    // Saved Discover filters narrow search results, not access to a card reached
    // through a valid link or an ad-hoc search with different filters.
    if (latest?.round_id !== row.round_id || !await mayDiscover(db, row, userId, null)) throw new AppError(404, 'NOT_FOUND');
  }
  return row;
}
async function card(db: Db, row: any, userId: string): Promise<DateCard> {
  const myResponse = (await db.query('SELECT id,status,message FROM date_responses WHERE round_id=$1 AND user_id=$2', [row.round_id, userId])).rows[0] ?? null;
  const match = (await db.query('SELECT response_id FROM date_matches WHERE round_id=$1', [row.round_id])).rows[0];
  const isMatchedParticipant = match && (row.owner_id === userId || (await db.query('SELECT 1 FROM date_responses WHERE id=$1 AND user_id=$2', [match.response_id, userId])).rowCount);
  const hostPhoto = (await db.query("SELECT 1 FROM date_photos WHERE user_id=$1 AND status='approved'", [row.owner_id])).rowCount;
  return { id: row.id, roundId: row.round_id, title: row.title, description: row.description,
    locationId: row.location_id, locationName: row.location_name, languageCode: row.language_code, communityId: row.community_id,
    timeZone: row.time_zone, costNote: row.cost_note, status: row.round_status, revision: row.revision,
    owner: { id: row.owner_id, displayName: row.display_name, introMarkdown: row.intro_markdown, askMeTopics: row.ask_me_topics },
    windows: await windowsFor(db, row.round_id), myResponse: myResponse ? { id: myResponse.id, status: myResponse.status, message: myResponse.message } : null,
    isOwner: row.owner_id === userId, photoUrl: hostPhoto ? `/api/dates/${row.id}/photo/${row.owner_id}?roundId=${row.round_id}` : null,
    privatePlace: row.owner_id === userId || isMatchedParticipant ? row.private_place : null };
}
async function detail(db: Db, row: any, userId: string): Promise<DateDetail> {
  const base = await card(db, row, userId);
  const owner = row.owner_id === userId;
  const responses = owner ? (await db.query(`SELECT r.id,r.user_id,p.display_name,p.intro_markdown,p.ask_me_topics,r.message,r.status
    FROM date_responses r JOIN profiles p ON p.user_id=r.user_id WHERE r.round_id=$1 AND r.status='pending' ORDER BY r.created_at`, [row.round_id])).rows : [];
  const match = (await db.query(`SELECT m.*,r.user_id AS partner_id,p.display_name AS partner_name
    FROM date_matches m JOIN date_responses r ON r.id=m.response_id JOIN profiles p ON p.user_id=r.user_id
    WHERE m.round_id=$1`, [row.round_id])).rows[0];
  const showMatch = match && (owner || match.partner_id === userId);
  const votes = showMatch ? (await db.query('SELECT user_id,window_id FROM date_time_votes WHERE match_id=$1', [match.id])).rows : [];
  const messages = showMatch ? (await db.query(`SELECT id,sender_id AS "senderId",body,created_at AS "createdAt",
    CASE WHEN photo_file_id IS NOT NULL THEN 'photo' WHEN document_file_id IS NOT NULL THEN 'file' ELSE NULL END AS "attachmentType"
    FROM date_messages WHERE match_id=$1 ORDER BY created_at,id LIMIT 200`, [match.id])).rows : [];
  const topic = showMatch ? (await db.query('SELECT thread_id FROM date_bot_topics WHERE match_id=$1 AND user_id=$2', [match.id, userId])).rows[0] : null;
  return { ...base, responses: responses.map(r => ({ id: r.id, userId: r.user_id, displayName: r.display_name, introMarkdown: r.intro_markdown,
    askMeTopics: r.ask_me_topics, message: r.message, status: r.status, photoUrl: `/api/dates/${row.id}/photo/${r.user_id}?roundId=${row.round_id}` })),
    match: showMatch ? { id: match.id, partnerId: match.partner_id, partnerName: match.partner_name,
      partnerPhotoUrl: `/api/dates/${row.id}/photo/${match.partner_id}?roundId=${row.round_id}`,
      votes: Object.fromEntries([row.owner_id, match.partner_id].map(id => [id, votes.filter(v => v.user_id === id).map(v => v.window_id)])),
      proposedWindowId: match.proposed_window_id, proposedBy: match.proposed_by,
      proposedStart: match.proposed_start?.toISOString() ?? null, durationMinutes: match.duration_minutes,
      confirmedAt: match.confirmed_at?.toISOString() ?? null,
      botUrl: topic ? `https://t.me/questr_game/${topic.thread_id}` : 'https://t.me/questr_game', botReady: !!topic } : null,
    messages: messages.map(m => ({ ...m, createdAt: m.createdAt.toISOString() })) };
}
async function notify(db: PoolClient, config: Config, dateId: string, roundId: string, userId: string, action: string, otherId: string) {
  const locale = (await db.query('SELECT locale FROM users WHERE id=$1', [userId])).rows[0]?.locale;
  const copy: Record<string, [string, string]> = {
    response: ['Someone replied to your date. Open QUESTR to review.', 'На твой дейт откликнулись. Открой QUESTR.'],
    matched: ['You matched on a date. Choose a time in QUESTR.', 'У тебя матч по дейту. Выберите время в QUESTR.'],
    closed: ['A date you replied to is closed.', 'Дейт, на который ты откликнулся, закрыт.'],
    proposed: ['A time was proposed for your date. Open QUESTR to confirm.', 'Для дейта предложили время. Открой QUESTR, чтобы подтвердить.'],
    confirmed: ['Your date time is confirmed. Open QUESTR for details.', 'Время дейта подтверждено. Детали — в QUESTR.'],
    cancelled: ['Your date was cancelled.', 'Дейт отменён.'],
    expired: ['The date ended before a time was agreed.', 'Дейт закончился до согласования времени.'],
    message: ['You have a new date message. Open QUESTR.', 'У тебя новое сообщение в дейте. Открой QUESTR.'],
  };
  let keyboard;
  if (config.publicAppUrl.startsWith('https://')) {
    const url = new URL(config.publicAppUrl); url.searchParams.set('route', `dates/${dateId}`);
    keyboard = { inline_keyboard: [[{ text: locale === 'ru' ? 'Открыть дейт' : 'Open date', web_app: { url: url.toString() } }]] };
  }
  await queueBot(db, { key: `date:${roundId}:${action}:${userId}:${randomUUID()}`, userId,
    dateOtherUserId: otherId, body: copy[action][locale === 'ru' ? 1 : 0], keyboard });
}
async function audit(db: PoolClient, roundId: string, userId: string, action: string) {
  await db.query('INSERT INTO date_audit(round_id,actor_id,action) VALUES($1,$2,$3)', [roundId, userId, action]);
}
async function matchAccess(db: Db, dateId: string, userId: string, lock = false) {
  const row = await requireVisible(db, dateId, userId);
  const match = (await db.query(`SELECT m.*,r.user_id AS partner_id FROM date_matches m JOIN date_responses r ON r.id=m.response_id
    WHERE m.round_id=$1 ${lock ? 'FOR UPDATE OF m' : ''}`, [row.round_id])).rows[0];
  if (!match || (row.owner_id !== userId && match.partner_id !== userId)) throw new AppError(404, 'NOT_FOUND');
  return { row, match, other: row.owner_id === userId ? match.partner_id : row.owner_id };
}

export async function dateChatAllowed(db: Db, matchId: string, userId: string) {
  const row = (await db.query(`SELECT d.owner_id,r.user_id AS partner_id,dr.status FROM date_matches m
    JOIN date_rounds dr ON dr.id=m.round_id JOIN dates d ON d.id=dr.date_id JOIN date_responses r ON r.id=m.response_id
    WHERE m.id=$1`, [matchId])).rows[0];
  if (!row || ![row.owner_id, row.partner_id].includes(userId) || !['matched', 'scheduled'].includes(row.status)) return null;
  if ((await db.query("SELECT count(*)::int AS n FROM users WHERE id=ANY($1::uuid[]) AND status='active'", [[row.owner_id, row.partner_id]])).rows[0].n !== 2) return null;
  if ((await db.query(`SELECT 1 FROM dm_conversations WHERE first_user_id=LEAST($1::uuid,$2::uuid)
    AND second_user_id=GREATEST($1::uuid,$2::uuid) AND status='blocked'`, [row.owner_id, row.partner_id])).rowCount) return null;
  if ((await db.query('SELECT 1 FROM date_blocks WHERE blocker_id IN ($1::uuid,$2::uuid) AND blocked_id IN ($1::uuid,$2::uuid)', [row.owner_id, row.partner_id])).rowCount) return null;
  return { other: row.owner_id === userId ? row.partner_id as string : row.owner_id as string };
}

export async function expireDateRounds(pool: Pool, config: Config) {
  const rows = (await pool.query(`${dateProjection(true)} WHERE r.status IN ('open','matched') ORDER BY r.opened_at LIMIT 200`)).rows;
  for (const row of rows) {
    if (activeWindow(await windowsFor(pool, row.round_id), row.time_zone)) continue;
    await transaction(pool, async db => {
      const locked = (await db.query('SELECT status FROM date_rounds WHERE id=$1 FOR UPDATE', [row.round_id])).rows[0];
      if (!locked || !['open', 'matched'].includes(locked.status) || activeWindow(await windowsFor(db, row.round_id), row.time_zone)) return;
      await db.query("UPDATE date_rounds SET status='expired',updated_at=now() WHERE id=$1", [row.round_id]);
      const pending = (await db.query("UPDATE date_responses SET status='closed_unmatched',updated_at=now() WHERE round_id=$1 AND status='pending' RETURNING user_id", [row.round_id])).rows;
      for (const response of pending) await notify(db, config, row.id, row.round_id, response.user_id, 'closed', row.owner_id);
      const match = (await db.query('SELECT r.user_id FROM date_matches m JOIN date_responses r ON r.id=m.response_id WHERE m.round_id=$1', [row.round_id])).rows[0];
      if (match) for (const id of [row.owner_id, match.user_id]) await notify(db, config, row.id, row.round_id, id, 'expired', id === row.owner_id ? match.user_id : row.owner_id);
      await audit(db, row.round_id, row.owner_id, 'expired');
    });
  }
}
async function removePhoto(db: PoolClient, userId: string) {
  const old = (await db.query('DELETE FROM date_photos WHERE user_id=$1 RETURNING object_key,thumbnail_key', [userId])).rows[0];
  if (old) await db.query('INSERT INTO date_photo_deletions(object_key) VALUES($1),($2) ON CONFLICT DO NOTHING', [old.object_key, old.thumbnail_key]);
}

export function dateRoutes(pool: Pool, config: Config, reviewer: ContentReviewer, storage: DatePhotoStorage | null) {
  const router = Router();
  const current = (res: any) => res.locals.user.id as string;
  router.get('/me/settings', async (_req, res) => {
    const id = current(res);
    const row = (await pool.query('SELECT enabled,paused,revision FROM date_settings WHERE user_id=$1', [id])).rows[0];
    const photo = (await pool.query('SELECT status FROM date_photos WHERE user_id=$1', [id])).rows[0];
    res.json({ settings: { enabled: row?.enabled ?? false, paused: row?.paused ?? false, revision: row?.revision ?? 0,
      photoStatus: photo?.status ?? null, storageAvailable: !!storage, romanceReady: !!(await pool.query('SELECT 1 FROM romance_preferences WHERE user_id=$1 AND consent_version=$2', [id, romanceConsentVersion])).rowCount } });
  });
  router.put('/me/settings', async (req, res) => {
    const input = z.object({ enabled: z.boolean(), paused: z.boolean(), revision: z.number().int().nonnegative(), consent: z.literal(true) }).strict().parse(req.body);
    const id = current(res);
    await transaction(pool, async db => {
      if (!(await db.query("SELECT 1 FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id=$1 AND u.status='active'", [id])).rowCount ||
        !(await db.query("SELECT 1 FROM user_consents WHERE user_id=$1 AND kind='adult'", [id])).rowCount) throw new AppError(403, 'PROFILE_REQUIRED');
      if (input.enabled && !(await db.query('SELECT 1 FROM romance_preferences WHERE user_id=$1 AND consent_version=$2', [id, romanceConsentVersion])).rowCount) throw new AppError(403, 'ROMANCE_SETUP_REQUIRED');
      await db.query('INSERT INTO date_settings(user_id) VALUES($1) ON CONFLICT DO NOTHING', [id]);
      const result = await db.query('UPDATE date_settings SET enabled=$3,paused=$4,consent_version=$5,revision=revision+1,updated_at=now() WHERE user_id=$1 AND revision=$2 RETURNING revision',
        [id, input.revision, input.enabled, input.paused, input.enabled ? dateConsentVersion : null]);
      if (!result.rowCount) throw new AppError(409, 'DATE_SETTINGS_CONFLICT');
    });
    const row = (await pool.query('SELECT enabled,paused,revision FROM date_settings WHERE user_id=$1', [id])).rows[0];
    res.json({ settings: row });
  });
  router.get('/me/photo', async (_req, res) => {
    const photo = (await pool.query('SELECT object_key FROM date_photos WHERE user_id=$1', [current(res)])).rows[0];
    if (!photo || !storage) throw new AppError(404, 'NOT_FOUND');
    res.set('Cache-Control', 'private, no-store').type('image/jpeg').send(await storage.get(photo.object_key));
  });
  router.put('/me/photo', async (req, res) => {
    if (!storage) throw new AppError(503, 'PHOTO_STORAGE_UNAVAILABLE');
    const { base64 } = z.object({ base64: z.string().max(5_600_000) }).strict().parse(req.body);
    const userId = current(res);
    if (!(await pool.query("SELECT 1 FROM users u JOIN profiles p ON p.user_id=u.id WHERE u.id=$1 AND u.status='active'", [userId])).rowCount) throw new AppError(403, 'PROFILE_REQUIRED');
    const image = await prepareDatePhoto(base64);
    const prefix = `date-photos/${userId}/${image.id}`;
    const fullKey = `${prefix}/full.jpg`, thumbKey = `${prefix}/thumb.jpg`;
    try { await storage.put(fullKey, image.full); await storage.put(thumbKey, image.thumbnail); }
    catch (error) { await Promise.allSettled([storage.delete(fullKey), storage.delete(thumbKey)]); throw error; }
    try {
      await transaction(pool, async db => {
        await db.query('SELECT user_id FROM profiles WHERE user_id=$1 FOR UPDATE', [userId]);
        const old = (await db.query('SELECT object_key,thumbnail_key FROM date_photos WHERE user_id=$1', [userId])).rows[0];
        if (old) await db.query('INSERT INTO date_photo_deletions(object_key) VALUES($1),($2) ON CONFLICT DO NOTHING', [old.object_key, old.thumbnail_key]);
        await db.query(`INSERT INTO date_photos(user_id,id,object_key,thumbnail_key,status) VALUES($1,$2,$3,$4,'pending')
          ON CONFLICT(user_id) DO UPDATE SET id=EXCLUDED.id,object_key=EXCLUDED.object_key,thumbnail_key=EXCLUDED.thumbnail_key,
            status='pending',reviewed_by=NULL,reviewed_at=NULL,created_at=now()`, [userId, image.id, fullKey, thumbKey]);
      });
    } catch (error) { await Promise.allSettled([storage.delete(fullKey), storage.delete(thumbKey)]); throw error; }
    void cleanupDatePhotoDeletions(pool, storage).catch(() => {});
    res.json({ photoStatus: 'pending' });
  });
  router.delete('/me/photo', async (_req, res) => {
    const userId = current(res);
    await transaction(pool, db => removePhoto(db, userId));
    void cleanupDatePhotoDeletions(pool, storage).catch(() => {});
    res.json({ photoStatus: null });
  });
  router.get('/admin/photos', async (_req, res) => {
    if (!await can(pool, current(res), 'admin', { type: 'global' })) throw new AppError(403, 'PERMISSION_DENIED');
    const rows = (await pool.query(`SELECT ph.user_id AS "userId",ph.id,p.display_name AS "displayName",ph.created_at AS "createdAt"
      FROM date_photos ph JOIN profiles p ON p.user_id=ph.user_id WHERE ph.status='pending' ORDER BY ph.created_at LIMIT 50`)).rows;
    res.json({ photos: rows.map(row => ({ ...row, url: `/api/dates/admin/photos/${row.userId}/image` })) });
  });
  router.get('/admin/photos/:userId/image', async (req, res) => {
    if (!await can(pool, current(res), 'admin', { type: 'global' })) throw new AppError(403, 'PERMISSION_DENIED');
    const row = (await pool.query('SELECT object_key FROM date_photos WHERE user_id=$1', [uuid(req.params.userId)])).rows[0];
    if (!row || !storage) throw new AppError(404, 'NOT_FOUND');
    res.set('Cache-Control', 'private, no-store').type('image/jpeg').send(await storage.get(row.object_key));
  });
  router.post('/admin/photos/:userId/review', async (req, res) => {
    if (!await can(pool, current(res), 'admin', { type: 'global' })) throw new AppError(403, 'PERMISSION_DENIED');
    const { photoId, decision } = z.object({ photoId: z.uuid(), decision: z.enum(['approved', 'rejected']) }).strict().parse(req.body);
    const result = await pool.query(`UPDATE date_photos SET status=$3,reviewed_by=$4,reviewed_at=now() WHERE user_id=$1 AND id=$2 AND status='pending' RETURNING id`,
      [uuid(req.params.userId), photoId, decision, current(res)]);
    if (!result.rowCount) throw new AppError(409, 'PHOTO_REVIEW_CONFLICT');
    res.json({ status: decision });
  });
  router.get('/admin/reports', async (_req, res) => {
    if (!await can(pool, current(res), 'admin', { type: 'global' })) throw new AppError(403, 'PERMISSION_DENIED');
    const rows = (await pool.query(`SELECT r.id,r.target_id AS "targetId",r.reason,r.created_at AS "createdAt",
      p.display_name AS "targetName",d.title AS "dateTitle" FROM date_reports r
      JOIN profiles p ON p.user_id=r.target_id JOIN dates d ON d.id=r.date_id
      WHERE r.status='pending' ORDER BY r.created_at LIMIT 50`)).rows;
    res.json({ reports: rows.map(row => ({ ...row, photoUrl: `/api/dates/admin/photos/${row.targetId}/image` })) });
  });
  router.post('/admin/reports/:reportId', async (req, res) => {
    if (!await can(pool, current(res), 'admin', { type: 'global' })) throw new AppError(403, 'PERMISSION_DENIED');
    const { action } = z.object({ action: z.enum(['dismiss', 'remove_photo']) }).strict().parse(req.body);
    await transaction(pool, async db => {
      const report = (await db.query('SELECT * FROM date_reports WHERE id=$1 FOR UPDATE', [uuid(req.params.reportId)])).rows[0];
      if (!report || report.status !== 'pending') throw new AppError(409, 'DATE_REPORT_CLOSED');
      if (action === 'remove_photo') await removePhoto(db, report.target_id);
      await db.query('UPDATE date_reports SET status=$2,reviewed_by=$3,reviewed_at=now() WHERE id=$1',
        [report.id, action === 'remove_photo' ? 'photo_removed' : 'dismissed', current(res)]);
    });
    void cleanupDatePhotoDeletions(pool, storage).catch(() => {});
    res.json({ ok: true });
  });
  router.get('/', async (req, res) => {
    const query = z.object({ view: z.enum(['discover', 'mine']).default('discover'), offset: z.coerce.number().int().min(0).max(100000).default(0), filters: z.string().max(6000).optional() }).strict().parse(req.query);
    const userId = current(res);
    if (query.view === 'discover') await requireEligible(pool, userId);
    let filter: DiscoveryFilter | null = null;
    if (query.view === 'discover') {
      try { filter = query.filters ? discoveryFilterSchema.parse(JSON.parse(query.filters)) : await getDiscovery(pool, userId); }
      catch (error) { if (error instanceof SyntaxError) throw new AppError(400, 'INVALID_INPUT'); throw error; }
      await validateDiscoveryFilter(pool, filter);
    }
    const rows = (await pool.query(`${dateProjection(query.view === 'mine')} WHERE ${query.view === 'mine'
      ? `d.owner_id=$1 OR EXISTS(SELECT 1 FROM date_responses x WHERE x.round_id=r.id AND x.user_id=$1)`
      : "r.status='open' AND d.owner_id<>$1"}
      ORDER BY d.created_at DESC,d.id DESC LIMIT 100 OFFSET $2`, [userId, query.offset])).rows;
    const visible: DateCard[] = [];
    let scanned = 0;
    for (const row of rows) {
      scanned++;
      if (query.view === 'mine' || await mayDiscover(pool, row, userId, filter)) visible.push(await card(pool, row, userId));
      if (visible.length === 20) break;
    }
    res.json({ dates: visible, nextOffset: scanned < rows.length || rows.length === 100 ? query.offset + scanned : null });
  });
  router.post('/', async (req, res) => {
    const input = dateCreateSchema.parse(req.body), userId = current(res);
    await requireEligible(pool, userId);
    validateWindows(input.windows, input.timeZone);
    if ([input.title, input.description, input.costNote].some(hasPublicLink)) throw new AppError(400, 'DATE_PUBLIC_LINK');
    const review = await reviewContent(pool, reviewer, [input.title, input.description, input.costNote, input.privatePlace].join('\n'));
    if (review.status === 'blocked') throw new AppError(422, 'DATE_CONTENT_REQUIRES_CHANGES');
    const dateId = await transaction(pool, async db => {
      await requireEligible(db, userId);
      const fingerprint = hash(JSON.stringify(input));
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,92))', [`${userId}:${input.requestId}`]);
      const replay = (await db.query('SELECT id,request_hash FROM dates WHERE owner_id=$1 AND request_id=$2', [userId, input.requestId])).rows[0];
      if (replay) { if (replay.request_hash !== fingerprint) throw new AppError(409, 'REQUEST_CONFLICT'); return replay.id as string; }
      const location = (await db.query("SELECT kind FROM locations WHERE id=$1 AND kind IN ('city','online')", [input.locationId])).rows[0];
      if (!location || !(await db.query('SELECT 1 FROM languages WHERE code=$1', [input.languageCode])).rowCount) throw new AppError(400, 'DATE_LOCATION_INVALID');
      if (input.communityId && !await hasCommunityAccess(db, userId, input.communityId)) throw new AppError(403, 'COMMUNITY_ACCESS_REQUIRED');
      const date = (await db.query(`INSERT INTO dates(owner_id,title,description,location_id,language_code,community_id,time_zone,cost_note,private_place,request_id,request_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [userId, input.title, input.description, input.locationId, input.languageCode, input.communityId, input.timeZone, input.costNote, input.privatePlace, input.requestId, fingerprint])).rows[0];
      const round = (await db.query('INSERT INTO date_rounds(date_id,number,request_id,request_hash) VALUES($1,1,$2,$3) RETURNING id', [date.id, input.requestId, hash(JSON.stringify(input.windows))])).rows[0];
      for (const w of input.windows) await db.query('INSERT INTO date_windows(round_id,local_day,period) VALUES($1,$2,$3)', [round.id, w.day, w.period]);
      await audit(db, round.id, userId, 'opened');
      return date.id as string;
    });
    res.status(201).json({ date: await detail(pool, await requireVisible(pool, dateId, userId), userId) });
  });
  router.get('/:id', async (req, res) => {
    const userId = current(res), row = await requireVisible(pool, uuid(req.params.id), userId);
    res.json({ date: await detail(pool, row, userId) });
  });
  router.get('/:id/rounds/:roundId', async (req, res) => {
    const userId = current(res), row = await requireVisible(pool, uuid(req.params.id), userId, uuid(req.params.roundId));
    res.json({ date: await detail(pool, row, userId) });
  });
  router.get('/:id/photo/:userId', async (req, res) => {
    const round = z.object({ roundId: z.uuid().optional() }).strict().parse(req.query);
    const userId = current(res), ownerId = uuid(req.params.userId), row = await requireVisible(pool, uuid(req.params.id), userId, round.roundId);
    let allowed = false;
    if (ownerId === row.owner_id) allowed = row.owner_id === userId || await mayDiscover(pool, row, userId, null) ||
      !!(await pool.query(`SELECT 1 FROM date_matches m JOIN date_responses r ON r.id=m.response_id
        WHERE m.round_id=$1 AND r.user_id=$2`, [row.round_id, userId])).rowCount;
    else if (row.owner_id === userId || ownerId === userId) {
      allowed = !!(await pool.query(`SELECT 1 FROM date_responses r WHERE r.round_id=$1 AND r.user_id=$2
        AND (r.status='pending' OR EXISTS(SELECT 1 FROM date_matches m WHERE m.response_id=r.id))`, [row.round_id, ownerId])).rowCount;
    }
    if (!allowed || !storage) throw new AppError(404, 'NOT_FOUND');
    if (ownerId !== userId && (await pool.query('SELECT 1 FROM date_blocks WHERE blocker_id IN ($1::uuid,$2::uuid) AND blocked_id IN ($1::uuid,$2::uuid)', [ownerId, userId])).rowCount) throw new AppError(404, 'NOT_FOUND');
    const photo = (await pool.query("SELECT thumbnail_key FROM date_photos WHERE user_id=$1 AND status='approved'", [ownerId])).rows[0];
    if (!photo) throw new AppError(404, 'NOT_FOUND');
    res.set('Cache-Control', 'private, no-store').type('image/jpeg').send(await storage.get(photo.thumbnail_key));
  });
  router.post('/:id/responses', async (req, res) => {
    const input = dateResponseSchema.parse(req.body), userId = current(res), dateId = uuid(req.params.id);
    if (contactPattern.test(input.message) || hasPublicLink(input.message)) throw new AppError(400, 'DATE_CONTACT_IN_OPENER');
    const replay = (await pool.query(`SELECT r.round_id,r.message,dr.date_id FROM date_responses r
      JOIN date_rounds dr ON dr.id=r.round_id WHERE r.user_id=$1 AND r.request_id=$2`, [userId, input.requestId])).rows[0];
    if (replay) {
      if (replay.date_id !== dateId || replay.message !== input.message) throw new AppError(409, 'REQUEST_CONFLICT');
      return res.json({ date: await detail(pool, await requireVisible(pool, dateId, userId, replay.round_id), userId) });
    }
    await requireEligible(pool, userId);
    const row = await requireVisible(pool, dateId, userId);
    if (row.owner_id === userId || row.round_status !== 'open' || !await mayDiscover(pool, row, userId, null)) throw new AppError(404, 'NOT_FOUND');
    const review = await reviewContent(pool, reviewer, input.message);
    if (review.status === 'blocked') throw new AppError(422, 'DATE_CONTENT_REQUIRES_CHANGES');
    await transaction(pool, async db => {
      await db.query('SELECT id FROM date_rounds WHERE id=$1 FOR UPDATE', [row.round_id]);
      const currentRow = await loadRow(db, dateId);
      if (!currentRow || currentRow.round_id !== row.round_id || !await mayDiscover(db, currentRow, userId, null)) throw new AppError(409, 'DATE_CLOSED');
      const old = (await db.query('SELECT id,message,round_id FROM date_responses WHERE user_id=$1 AND request_id=$2', [userId, input.requestId])).rows[0];
      if (old) { if (old.message !== input.message || old.round_id !== row.round_id) throw new AppError(409, 'REQUEST_CONFLICT'); return; }
      if ((await db.query('SELECT 1 FROM date_responses WHERE round_id=$1 AND user_id=$2', [row.round_id, userId])).rowCount ||
        (await db.query(`SELECT 1 FROM date_responses r JOIN date_rounds rr ON rr.id=r.round_id WHERE rr.date_id=$1 AND r.user_id=$2 AND r.status='declined'`, [dateId, userId])).rowCount) throw new AppError(409, 'DATE_ALREADY_RESPONDED');
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,91))', [userId]);
      const counts = (await db.query(`SELECT count(*) FILTER (WHERE created_at>now()-interval '24 hours')::int AS day,
        count(*) FILTER (WHERE created_at>now()-interval '7 days')::int AS week FROM date_responses WHERE user_id=$1`, [userId])).rows[0];
      if (counts.day >= 5 || counts.week >= 15) throw new AppError(429, 'DATE_RESPONSE_LIMIT');
      await db.query('INSERT INTO date_responses(round_id,user_id,message,request_id,request_hash) VALUES($1,$2,$3,$4,$5)', [row.round_id, userId, input.message, input.requestId, hash(input.message)]);
      await audit(db, row.round_id, userId, 'responded');
      await notify(db, config, dateId, row.round_id, row.owner_id, 'response', userId);
    });
    res.json({ date: await detail(pool, await requireVisible(pool, dateId, userId), userId) });
  });
  router.post('/:id/report', async (req, res) => {
    const { targetId, reason } = z.object({ targetId: z.uuid(), reason: z.enum(['photo', 'harassment', 'safety', 'other']) }).strict().parse(req.body);
    const userId = current(res), row = await requireVisible(pool, uuid(req.params.id), userId);
    if (targetId === userId) throw new AppError(400, 'INVALID_INPUT');
    if (targetId !== row.owner_id) {
      if (row.owner_id !== userId || !(await pool.query('SELECT 1 FROM date_responses WHERE round_id=$1 AND user_id=$2', [row.round_id, targetId])).rowCount) throw new AppError(404, 'NOT_FOUND');
    }
    await transaction(pool, async db => {
      await db.query(`INSERT INTO date_reports(date_id,round_id,reporter_id,target_id,reason) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(round_id,reporter_id,target_id,reason) DO NOTHING`, [row.id, row.round_id, userId, targetId, reason]);
      await db.query('INSERT INTO date_blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [userId, targetId]);
      await audit(db, row.round_id, userId, 'reported');
    });
    res.json({ ok: true });
  });
  router.post('/:id/responses/:responseId', async (req, res) => {
    const { action } = z.object({ action: z.enum(['withdraw', 'decline', 'accept']) }).strict().parse(req.body);
    const userId = current(res), dateId = uuid(req.params.id), responseId = uuid(req.params.responseId);
    await transaction(pool, async db => {
      const row = await requireVisible(db, dateId, userId);
      await db.query('SELECT id FROM date_rounds WHERE id=$1 FOR UPDATE', [row.round_id]);
      const response = (await db.query('SELECT * FROM date_responses WHERE id=$1 AND round_id=$2 FOR UPDATE', [responseId, row.round_id])).rows[0];
      if (!response || response.status !== 'pending' || row.round_status !== 'open') throw new AppError(409, 'DATE_RESPONSE_CLOSED');
      if (action === 'withdraw') {
        if (response.user_id !== userId) throw new AppError(403, 'PERMISSION_DENIED');
        await db.query("UPDATE date_responses SET status='withdrawn',updated_at=now() WHERE id=$1", [responseId]);
      } else {
        if (row.owner_id !== userId) throw new AppError(403, 'PERMISSION_DENIED');
        if (action === 'accept' && (!await eligible(db, userId) || !await eligible(db, response.user_id) || !await pairAllowed(db, userId, response.user_id))) throw new AppError(409, 'DATE_MATCH_UNAVAILABLE');
        if (action === 'decline') await db.query("UPDATE date_responses SET status='declined',updated_at=now() WHERE id=$1", [responseId]);
        else {
          await db.query("UPDATE date_responses SET status='matched',updated_at=now() WHERE id=$1", [responseId]);
          await db.query("UPDATE date_responses SET status='closed_unmatched',updated_at=now() WHERE round_id=$1 AND status='pending'", [row.round_id]);
          const match = (await db.query('INSERT INTO date_matches(round_id,response_id) VALUES($1,$2) RETURNING id', [row.round_id, responseId])).rows[0];
          await db.query("UPDATE date_rounds SET status='matched',updated_at=now() WHERE id=$1", [row.round_id]);
          for (const id of [userId, response.user_id]) await queueBot(db, { key: `date:${match.id}:topic:${id}`, userId: id,
            dateMatchId: match.id, kind: 'date_topic', inTopic: true,
            body: (await db.query('SELECT locale FROM users WHERE id=$1', [id])).rows[0]?.locale === 'ru'
              ? 'Это отдельный чат дейта. Согласуйте время и место в QUESTR.' : 'This is your private date chat. Agree on time and place in QUESTR.' });
          await notify(db, config, dateId, row.round_id, response.user_id, 'matched', userId);
          const closed = (await db.query("SELECT user_id FROM date_responses WHERE round_id=$1 AND status='closed_unmatched'", [row.round_id])).rows;
          for (const r of closed) await notify(db, config, dateId, row.round_id, r.user_id, 'closed', userId);
        }
      }
      await audit(db, row.round_id, userId, action);
    });
    res.json({ date: await detail(pool, await requireVisible(pool, dateId, userId), userId) });
  });
  router.put('/:id/votes', async (req, res) => {
    const { windowIds } = z.object({ windowIds: z.array(z.uuid()).max(42) }).strict().parse(req.body);
    const userId = current(res), dateId = uuid(req.params.id);
    await transaction(pool, async db => {
      const { row, match } = await matchAccess(db, dateId, userId, true);
      if (row.round_status !== 'matched') throw new AppError(409, 'DATE_CLOSED');
      if (!await dateChatAllowed(db, match.id, userId)) throw new AppError(409, 'DATE_CHAT_CLOSED');
      const allowed = new Set((await windowsFor(db, row.round_id)).map(w => w.id));
      if (new Set(windowIds).size !== windowIds.length || windowIds.some(id => !allowed.has(id))) throw new AppError(400, 'DATE_WINDOW_INVALID');
      await db.query('DELETE FROM date_time_votes WHERE match_id=$1 AND user_id=$2', [match.id, userId]);
      for (const windowId of windowIds) await db.query('INSERT INTO date_time_votes(match_id,user_id,window_id) VALUES($1,$2,$3)', [match.id, userId, windowId]);
      await db.query('UPDATE date_matches SET proposed_window_id=NULL,proposed_by=NULL,proposed_start=NULL,duration_minutes=NULL WHERE id=$1', [match.id]);
      await audit(db, row.round_id, userId, 'voted');
    });
    res.json({ date: await detail(pool, await requireVisible(pool, dateId, userId), userId) });
  });
  router.post('/:id/time', async (req, res) => {
    const { windowId, localStart, durationMinutes } = z.object({ windowId: z.uuid(), localStart: z.string(), durationMinutes: z.number().int().min(30).max(480) }).strict().parse(req.body);
    const userId = current(res), dateId = uuid(req.params.id);
    await transaction(pool, async db => {
      const { row, match, other } = await matchAccess(db, dateId, userId, true);
      if (row.round_status !== 'matched') throw new AppError(409, 'DATE_CLOSED');
      if (!await dateChatAllowed(db, match.id, userId)) throw new AppError(409, 'DATE_CHAT_CLOSED');
      const votes = (await db.query('SELECT user_id FROM date_time_votes WHERE match_id=$1 AND window_id=$2', [match.id, windowId])).rows;
      if (!votes.some(v => v.user_id === userId) || !votes.some(v => v.user_id === other)) throw new AppError(409, 'DATE_WINDOW_NOT_MUTUAL');
      const w = (await db.query('SELECT local_day::text AS day,period FROM date_windows WHERE id=$1 AND round_id=$2', [windowId, row.round_id])).rows[0];
      if (!w || !localStart.startsWith(`${w.day}T`)) throw new AppError(400, 'DATE_TIME_INVALID');
      let start: number;
      try { start = Date.parse(wallTimeToInstant(localStart, row.time_zone)); } catch { throw new AppError(400, 'DATE_TIME_INVALID'); }
      const [begin, end] = windowBounds(w.day, w.period, row.time_zone);
      if (start < begin || start + durationMinutes * 60000 > end || start < Date.now() + 2 * 3600000) throw new AppError(400, 'DATE_TIME_INVALID');
      await db.query('UPDATE date_matches SET proposed_window_id=$2,proposed_by=$3,proposed_start=$4,duration_minutes=$5 WHERE id=$1',
        [match.id, windowId, userId, new Date(start), durationMinutes]);
      await notify(db, config, dateId, row.round_id, other, 'proposed', userId);
      await audit(db, row.round_id, userId, 'time_proposed');
    });
    res.json({ date: await detail(pool, await requireVisible(pool, dateId, userId), userId) });
  });
  router.post('/:id/time/confirm', async (req, res) => {
    z.object({}).strict().parse(req.body);
    const userId = current(res), dateId = uuid(req.params.id);
    await transaction(pool, async db => {
      const { row, match, other } = await matchAccess(db, dateId, userId, true);
      if (row.round_status !== 'matched' || !match.proposed_start || match.proposed_by === userId || match.proposed_start.getTime() <= Date.now()) throw new AppError(409, 'DATE_TIME_UNAVAILABLE');
      if (!await dateChatAllowed(db, match.id, userId)) throw new AppError(409, 'DATE_CHAT_CLOSED');
      await db.query('UPDATE date_matches SET confirmed_at=now() WHERE id=$1', [match.id]);
      await db.query("UPDATE date_rounds SET status='scheduled',updated_at=now() WHERE id=$1", [row.round_id]);
      await notify(db, config, dateId, row.round_id, other, 'confirmed', userId);
      await audit(db, row.round_id, userId, 'time_confirmed');
    });
    res.json({ date: await detail(pool, await requireVisible(pool, dateId, userId), userId) });
  });
  router.post('/:id/messages', async (req, res) => {
    const { requestId, body } = z.object({ requestId: z.uuid(), body: z.string().trim().min(1).max(2000) }).strict().parse(req.body);
    const userId = current(res), dateId = uuid(req.params.id);
    const checked = await reviewContent(pool, reviewer, body);
    if (checked.status === 'blocked') throw new AppError(422, 'DATE_CONTENT_REQUIRES_CHANGES');
    await transaction(pool, async db => {
      const { row, match, other } = await matchAccess(db, dateId, userId, true);
      if (!['matched', 'scheduled'].includes(row.round_status) || !await pairAllowed(db, userId, other) ||
        !(await db.query("SELECT 1 FROM users WHERE id=$1 AND status='active'", [other])).rowCount) throw new AppError(409, 'DATE_CHAT_CLOSED');
      const old = (await db.query('SELECT id,body FROM date_messages WHERE sender_id=$1 AND request_id=$2', [userId, requestId])).rows[0];
      if (old) { if (old.body !== body) throw new AppError(409, 'REQUEST_CONFLICT'); return; }
      const inserted = (await db.query('INSERT INTO date_messages(match_id,sender_id,body,request_id) VALUES($1,$2,$3,$4) RETURNING id', [match.id, userId, body, requestId])).rows[0];
      const name = (await db.query('SELECT display_name FROM profiles WHERE user_id=$1', [userId])).rows[0].display_name;
      await queueBot(db, { key: `date:message:${inserted.id}`, userId: other, dateMatchId: match.id, dateMessageId: inserted.id,
        kind: 'date_relay', inTopic: true, body: `${name}:\n${body}` });
      await audit(db, row.round_id, userId, `message:${inserted.id}`);
    });
    res.json({ date: await detail(pool, await requireVisible(pool, dateId, userId), userId) });
  });
  router.post('/:id/cancel', async (req, res) => {
    const { reason } = z.object({ reason: z.enum(['plans_changed', 'unavailable', 'other']) }).strict().parse(req.body);
    const userId = current(res), dateId = uuid(req.params.id);
    await transaction(pool, async db => {
      const row = await requireVisible(db, dateId, userId);
      const match = row.round_status === 'open' ? null : await matchAccess(db, dateId, userId, true);
      if (row.owner_id !== userId && !match || !['open', 'matched', 'scheduled'].includes(row.round_status)) throw new AppError(403, 'PERMISSION_DENIED');
      await db.query('SELECT id FROM date_rounds WHERE id=$1 FOR UPDATE', [row.round_id]);
      await db.query("UPDATE date_rounds SET status='cancelled',updated_at=now() WHERE id=$1", [row.round_id]);
      if (match) {
        await db.query('UPDATE date_matches SET cancelled_by=$2,cancellation_reason=$3 WHERE id=$1', [match.match.id, userId, reason]);
        await notify(db, config, dateId, row.round_id, match.other, 'cancelled', userId);
      }
      const pending = (await db.query("UPDATE date_responses SET status='closed_unmatched' WHERE round_id=$1 AND status='pending' RETURNING user_id", [row.round_id])).rows;
      for (const response of pending) await notify(db, config, dateId, row.round_id, response.user_id, 'closed', row.owner_id);
      await audit(db, row.round_id, userId, 'cancelled');
    });
    res.json({ date: await detail(pool, await requireVisible(pool, dateId, userId), userId) });
  });
  router.post('/:id/complete', async (req, res) => {
    z.object({}).strict().parse(req.body);
    const userId = current(res), dateId = uuid(req.params.id);
    await transaction(pool, async db => {
      const { row, match } = await matchAccess(db, dateId, userId, true);
      if (row.round_status !== 'scheduled' || !match.proposed_start || match.proposed_start.getTime() + match.duration_minutes * 60000 > Date.now()) throw new AppError(409, 'DATE_NOT_FINISHED');
      await db.query("UPDATE date_rounds SET status='completed',updated_at=now() WHERE id=$1", [row.round_id]);
      await audit(db, row.round_id, userId, 'completed');
    });
    res.json({ date: await detail(pool, await requireVisible(pool, dateId, userId), userId) });
  });
  router.post('/:id/reopen', async (req, res) => {
    const input = dateReopenSchema.parse(req.body), userId = current(res), dateId = uuid(req.params.id);
    await transaction(pool, async db => {
      const row = await requireVisible(db, dateId, userId);
      if (row.owner_id !== userId) throw new AppError(403, 'PERMISSION_DENIED');
      await requireEligible(db, userId);
      validateWindows(input.windows, row.time_zone);
      await db.query('SELECT id FROM dates WHERE id=$1 FOR UPDATE', [dateId]);
      const latest = await loadRow(db, dateId);
      if (latest.round_request_id === input.requestId) {
        if (latest.round_request_hash !== hash(JSON.stringify(input.windows))) throw new AppError(409, 'REQUEST_CONFLICT');
        return;
      }
      if (latest.round_id !== row.round_id) {
        throw new AppError(409, 'DATE_CHANGED');
      }
      if (latest.round_status === 'open' && !activeWindow(await windowsFor(db, row.round_id), row.time_zone)) await db.query("UPDATE date_rounds SET status='expired' WHERE id=$1", [row.round_id]);
      else if (!['cancelled', 'expired'].includes(latest.round_status)) throw new AppError(409, 'DATE_CANNOT_REOPEN');
      const newRound = (await db.query('INSERT INTO date_rounds(date_id,number,request_id,request_hash) VALUES($1,$2,$3,$4) RETURNING id', [dateId, row.round_number + 1, input.requestId, hash(JSON.stringify(input.windows))])).rows[0];
      for (const w of input.windows) await db.query('INSERT INTO date_windows(round_id,local_day,period) VALUES($1,$2,$3)', [newRound.id, w.day, w.period]);
      await audit(db, newRound.id, userId, 'reopened');
    });
    res.json({ date: await detail(pool, await requireVisible(pool, dateId, userId), userId) });
  });
  return router;
}
