import type { Pool, PoolClient } from 'pg';
import { createEventSchema, editEventSchema, applicationSchema, eventFieldsSchema, hasPublicLink, type Adventure, type AdventureDetail, type EventFields } from '../shared/events.ts';
import { AppError } from './errors.ts';
import { hash } from './auth.ts';
import { transaction } from './db.ts';
import { can, consumeCapability, requireCapability } from './permissions.ts';
import { ContentReviewer, reviewContent } from './moderation.ts';
import { getProfile } from './store.ts';
import { queueBot, notifyMembers } from './event-notifications.ts';

type Db = Pool | PoolClient;
const eventProjection = `SELECT e.*,l.name AS location_name,l.kind AS location_kind,l.parent_id,p.name AS country_name,
  h.display_name AS host_name,h.avatar_preset_id AS host_avatar,
  (SELECT count(*)::int FROM event_memberships m WHERE m.event_id=e.id AND m.status='accepted') AS participant_count,
  (SELECT status FROM event_memberships WHERE event_id=e.id AND user_id=$1) AS my_status
  FROM events e JOIN locations l ON l.id=e.location_id LEFT JOIN locations p ON p.id=l.parent_id
  JOIN profiles h ON h.user_id=e.created_by JOIN users host_user ON host_user.id=h.user_id`;
function mapEvent(row: any, userId: string): Adventure {
  return { id: row.id, title: row.title, activitySummary: row.activity_summary || row.description_markdown.slice(0, 240), descriptionMarkdown: row.description_markdown,
    district: row.district, costEstimate: row.cost_estimate, experienceNotes: row.experience_notes,
    onlinePlatform: row.online_platform, recruitmentOpen: row.recruitment_open,
    location: { id: row.location_id, name: row.location_name, kind: row.location_kind, parentId: row.parent_id, countryName: row.country_name },
    languageCode: row.language_code, startsAt: row.starts_at.toISOString(), endsAt: row.ends_at.toISOString(), timeZone: row.time_zone,
    capacity: row.capacity, participantCount: row.participant_count, revision: row.revision, status: row.status,
    host: { id: row.created_by, displayName: row.host_name, avatarId: row.host_avatar }, myStatus: row.my_status ?? null, isHost: row.created_by === userId };
}
async function activeUser(db: Db, userId: string) {
  if (!(await db.query("SELECT 1 FROM users WHERE id=$1 AND status='active'", [userId])).rowCount) throw new AppError(403, 'PROFILE_REQUIRED');
}
async function readRow(db: Db, userId: string, eventId: string) {
  await activeUser(db, userId);
  const row = (await db.query(`${eventProjection} WHERE e.id=$2 AND host_user.status='active'`, [userId, eventId])).rows[0];
  if (!row || !await can(db, userId, 'events.view', { type: 'event', id: eventId })) throw new AppError(404, 'NOT_FOUND');
  return row;
}
async function lockEvent(db: PoolClient, userId: string, eventId: string) {
  await activeUser(db, userId);
  const row = (await db.query('SELECT * FROM events WHERE id=$1 FOR UPDATE', [eventId])).rows[0];
  if (!row || !await can(db, userId, 'events.view', { type: 'event', id: eventId })) throw new AppError(404, 'NOT_FOUND');
  if (!(await db.query("SELECT 1 FROM users WHERE id=$1 AND status='active'", [row.created_by])).rowCount) throw new AppError(404, 'NOT_FOUND');
  return row;
}
function recruiting(row: any) {
  if (row.status !== 'published' || row.starts_at.getTime() <= Date.now()) throw new AppError(409, 'EVENT_CLOSED');
}
async function validateFields(db: Db, userId: string, fields: EventFields, requireCreate = true) {
  if (Date.parse(fields.startsAt) <= Date.now()) throw new AppError(400, 'EVENT_TIME_PAST');
  if (Date.parse(fields.endsAt) <= Date.parse(fields.startsAt)) throw new AppError(400, 'EVENT_END_INVALID');
  const location = (await db.query("SELECT kind FROM locations WHERE id=$1 AND kind IN ('city','online')", [fields.locationId])).rows[0];
  if (!location) throw new AppError(400, 'EVENT_LOCATION_INVALID');
  if ([fields.title, fields.activitySummary, fields.descriptionMarkdown, fields.district, fields.costEstimate, fields.experienceNotes, fields.onlinePlatform].some(hasPublicLink)) {
    throw new AppError(400, 'EVENT_PUBLIC_LINK');
  }
  if (location.kind === 'online') {
    if (!fields.onlinePlatform) throw new AppError(400, 'EVENT_PLATFORM_REQUIRED');
    if (fields.meetingMapUrl) throw new AppError(400, 'EVENT_MAP_INVALID');
    try { const url = new URL(fields.meetingDetails); if (url.protocol !== 'https:' || url.username || url.password) throw new Error(); }
    catch { throw new AppError(400, 'EVENT_LINK_INVALID'); }
  }
  if (location.kind === 'city' && !fields.district) throw new AppError(400, 'EVENT_DISTRICT_REQUIRED');
  if (fields.meetingMapUrl) {
    try {
      const url = new URL(fields.meetingMapUrl);
      const maps = ['www.google.com', 'google.com', 'maps.google.com'].includes(url.hostname) && url.pathname.startsWith('/maps/');
      const shared = url.hostname === 'maps.app.goo.gl' && url.pathname.length > 1;
      if (url.protocol !== 'https:' || !(maps || shared) || url.username || url.password) throw new Error();
    } catch { throw new AppError(400, 'EVENT_MAP_INVALID'); }
  }
  if (requireCreate) await requireCapability(db, userId, 'events.create', { type: 'location', id: fields.locationId });
}
async function audit(db: PoolClient, eventId: string, userId: string, action: string) {
  await db.query('INSERT INTO event_activity(event_id,actor_id,action) VALUES($1,$2,$3)', [eventId, userId, action]);
}
async function grantEventRole(db: PoolClient, eventId: string, userId: string, role: 'organizer' | 'participant' | 'applicant', actorId: string) {
  await db.query('INSERT INTO role_assignments(user_id,role_code,event_id,granted_by,reason) VALUES($1,$2,$3,$4,$5)', [userId, role, eventId, actorId, role === 'organizer' ? 'Adventure created' : role === 'applicant' ? 'Application submitted' : 'Application accepted']);
  await db.query("INSERT INTO permission_audit(user_id,actor_id,action,details,reason) VALUES($1,$2,'role.granted',$3,'Adventure membership')", [userId, actorId, JSON.stringify({ role, eventId })]);
}
export class Adventures {
  constructor(public pool: Pool, private reviewer: ContentReviewer) {}
  async review(text: string) {
    const review = await reviewContent(this.pool, this.reviewer, text);
    if (review.status === 'blocked') throw new AppError(422, 'EVENT_CONTENT_REQUIRES_CHANGES', { excerpts: review.spans.map(span => text.slice(span.start, span.end)) });
  }
  async list(userId: string, mode: 'discover' | 'mine', offset: number) {
    await activeUser(this.pool, userId);
    const filter = mode === 'mine'
      ? `EXISTS(SELECT 1 FROM event_memberships WHERE event_id=e.id AND user_id=$1)`
      : `e.status='published' AND e.starts_at>now()
        AND (NOT EXISTS(SELECT 1 FROM discovery_languages WHERE user_id=$1)
          OR EXISTS(SELECT 1 FROM discovery_languages WHERE user_id=$1 AND language_code=e.language_code))
        AND EXISTS(SELECT 1 FROM discovery_locations WHERE user_id=$1 AND (location_id=e.location_id OR location_id=l.parent_id))`;
    const { rows } = await this.pool.query(`${eventProjection} WHERE host_user.status='active' AND ${filter}
      ORDER BY e.starts_at ${mode === 'mine' ? 'DESC' : 'ASC'},e.id LIMIT 21 OFFSET $2`, [userId, offset]);
    const events: Adventure[] = [];
    for (const row of rows.slice(0, 20)) if (await can(this.pool, userId, 'events.view', { type: 'event', id: row.id })) events.push(mapEvent(row, userId));
    return { events, nextOffset: rows.length > 20 ? offset + 20 : null };
  }
  async detail(userId: string, eventId: string): Promise<AdventureDetail> {
    // One read transaction/row lock makes removal and private-detail projection
    // agree; no stale membership check can expose a newer meeting link.
    return transaction(this.pool, async db => {
      await db.query('SELECT id FROM events WHERE id=$1 FOR SHARE', [eventId]);
      const row = await readRow(db, userId, eventId);
      const event = mapEvent(row, userId);
      const editable = await can(db, userId, 'events.edit', { type: 'event', id: eventId });
      const manage = row.status === 'published' && await can(db, userId, 'events.accept', { type: 'event', id: eventId });
      const chat = await can(db, userId, 'events.group_chat', { type: 'event', id: eventId });
      const members = (chat || editable) ? (await db.query(`SELECT m.user_id AS id,p.display_name AS "displayName",p.avatar_preset_id AS "avatarId",m.role,m.status,(u.status<>'active') AS unavailable,
        CASE WHEN $2 THEN m.application_text ELSE NULL END AS "applicationText"
        FROM event_memberships m JOIN profiles p ON p.user_id=m.user_id JOIN users u ON u.id=m.user_id
        WHERE m.event_id=$1 AND (u.status='active' OR $2) AND (m.status='accepted' OR ($2 AND m.status='pending')) ORDER BY m.created_at,m.user_id`, [eventId, manage])).rows : [];
      return { ...event,
        ...await (async () => {
          if (!chat && !editable) return { meetingDetails: null, meetingMapUrl: null };
          const privateRow = (await db.query('SELECT meeting_details,meeting_map_url FROM event_private_details WHERE event_id=$1', [eventId])).rows[0];
          return { meetingDetails: privateRow?.meeting_details ?? null, meetingMapUrl: privateRow?.meeting_map_url || null };
        })(),
        reminderMinutes: (await db.query('SELECT minutes_before FROM event_reminders WHERE event_id=$1 AND user_id=$2', [eventId, userId])).rows[0]?.minutes_before ?? null,
        participants: members.filter(member => member.status === 'accepted'), applications: manage ? members.filter(member => member.status === 'pending') : [],
        canApply: !event.myStatus && !event.isHost && row.status === 'published' && row.recruitment_open && row.starts_at.getTime() > Date.now() && event.participantCount < event.capacity,
        canEdit: editable && row.status === 'published' && row.starts_at.getTime() > Date.now(), canManage: manage, canChat: chat,
        botUrl: `https://t.me/questr_game?start=quest_${eventId.replaceAll('-', '')}` };
    });
  }
  async create(userId: string, body: unknown) {
    const input = createEventSchema.parse(body);
    await activeUser(this.pool, userId);
    const fields = eventFieldsSchema.parse(Object.fromEntries(Object.entries(input).filter(([key]) => key !== 'requestId')));
    await requireCapability(this.pool, userId, 'events.create', { type: 'location', id: fields.locationId });
    await this.review([fields.title, fields.activitySummary, fields.descriptionMarkdown, fields.district, fields.costEstimate, fields.experienceNotes, fields.onlinePlatform].join('\n\n'));
    const fingerprint = hash(JSON.stringify(fields));
    const eventId = await transaction(this.pool, async db => {
      await activeUser(db, userId);
      const use = await consumeCapability(db, userId, 'events.create', { type: 'location', id: fields.locationId }, input.requestId);
      if (use === 'replay') {
        const old = (await db.query('SELECT id,request_hash FROM events WHERE created_by=$1 AND request_id=$2', [userId, input.requestId])).rows[0];
        if (!old || old.request_hash !== fingerprint) throw new AppError(409, 'REQUEST_CONFLICT');
        return old.id;
      }
      await validateFields(db, userId, fields);
      const row = (await db.query(`INSERT INTO events(created_by,title,activity_summary,description_markdown,district,cost_estimate,experience_notes,online_platform,location_id,language_code,starts_at,ends_at,time_zone,capacity,status,request_id,request_hash)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'published',$15,$16) RETURNING id`, [userId, fields.title, fields.activitySummary, fields.descriptionMarkdown, fields.district, fields.costEstimate, fields.experienceNotes, fields.onlinePlatform, fields.locationId, fields.languageCode, fields.startsAt, fields.endsAt, fields.timeZone, fields.capacity, input.requestId, fingerprint])).rows[0];
      await db.query('INSERT INTO event_private_details(event_id,meeting_details,meeting_map_url) VALUES($1,$2,$3)', [row.id, fields.meetingDetails, fields.meetingMapUrl]);
      await db.query("INSERT INTO event_memberships(event_id,user_id,role,status) VALUES($1,$2,'host','accepted')", [row.id, userId]);
      await grantEventRole(db, row.id, userId, 'organizer', userId);
      await audit(db, row.id, userId, 'created');
      return row.id;
    });
    return this.detail(userId, eventId);
  }
  async edit(userId: string, eventId: string, body: unknown) {
    const input = editEventSchema.parse(body);
    await requireCapability(this.pool, userId, 'events.edit', { type: 'event', id: eventId });
    await this.review([input.title, input.activitySummary, input.descriptionMarkdown, input.district, input.costEstimate, input.experienceNotes, input.onlinePlatform].join('\n\n'));
    await transaction(this.pool, async db => {
      const row = await lockEvent(db, userId, eventId);
      await requireCapability(db, userId, 'events.edit', { type: 'event', id: eventId });
      recruiting(row);
      if (row.revision !== input.revision) throw new AppError(409, 'EVENT_CONFLICT');
      await validateFields(db, userId, input, row.location_id !== input.locationId);
      const count = (await db.query("SELECT count(*)::int AS count FROM event_memberships WHERE event_id=$1 AND status='accepted'", [eventId])).rows[0].count;
      if (count > input.capacity) throw new AppError(409, 'EVENT_CAPACITY_TOO_SMALL');
      await db.query(`UPDATE events SET title=$2,activity_summary=$3,description_markdown=$4,district=$5,cost_estimate=$6,experience_notes=$7,online_platform=$8,location_id=$9,language_code=$10,starts_at=$11,ends_at=$12,time_zone=$13,capacity=$14,revision=revision+1,updated_at=now() WHERE id=$1`,
        [eventId, input.title, input.activitySummary, input.descriptionMarkdown, input.district, input.costEstimate, input.experienceNotes, input.onlinePlatform, input.locationId, input.languageCode, input.startsAt, input.endsAt, input.timeZone, input.capacity]);
      await db.query('INSERT INTO event_private_details(event_id,meeting_details,meeting_map_url) VALUES($1,$2,$3) ON CONFLICT(event_id) DO UPDATE SET meeting_details=EXCLUDED.meeting_details,meeting_map_url=EXCLUDED.meeting_map_url', [eventId, input.meetingDetails, input.meetingMapUrl]);
      if (row.starts_at.getTime() !== Date.parse(input.startsAt)) {
        await db.query("DELETE FROM bot_outbox WHERE event_id=$1 AND kind='reminder' AND state='pending'", [eventId]);
        await db.query('UPDATE event_reminders SET queued_at=NULL,schedule_id=gen_random_uuid() WHERE event_id=$1', [eventId]);
      }
      await audit(db, eventId, userId, 'updated');
      await notifyMembers(db, eventId, `event:${eventId}:edit:${row.revision + 1}`, `Adventure updated: ${input.title}. Open QUESTR to check the latest time and meeting details.`, userId);
    });
    return this.detail(userId, eventId);
  }
  async apply(userId: string, eventId: string, body: unknown) {
    const input = applicationSchema.parse(body);
    if (hasPublicLink(input.message)) throw new AppError(400, 'APPLICATION_LINK_NOT_ALLOWED');
    await readRow(this.pool, userId, eventId);
    await this.review(input.message);
    await transaction(this.pool, async db => {
      const row = await lockEvent(db, userId, eventId);
      const old = (await db.query('SELECT * FROM event_memberships WHERE event_id=$1 AND user_id=$2', [eventId, userId])).rows[0];
      if (old) {
        if (['pending', 'accepted'].includes(old.status) && old.role !== 'host' && old.application_text === input.message) return;
        throw new AppError(409, 'APPLICATION_EXISTS');
      }
      recruiting(row);
      if (!row.recruitment_open) throw new AppError(409, 'EVENT_RECRUITMENT_CLOSED');
      const count = (await db.query("SELECT count(*)::int AS count FROM event_memberships WHERE event_id=$1 AND status='accepted'", [eventId])).rows[0].count;
      if (count >= row.capacity) throw new AppError(409, 'EVENT_FULL');
      // A separate first-contact allowance, serialized across all adventures.
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`applications:${userId}`]);
      const recent = (await db.query("SELECT count(*)::int AS count FROM event_memberships WHERE user_id=$1 AND role='participant' AND created_at>now()-interval '1 day'", [userId])).rows[0].count;
      if (recent >= 10) throw new AppError(429, 'BUDGET_EXHAUSTED');
      await db.query("INSERT INTO event_memberships(event_id,user_id,status,application_text) VALUES($1,$2,'pending',$3)", [eventId, userId, input.message]);
      await grantEventRole(db, eventId, userId, 'applicant', userId);
      await audit(db, eventId, userId, 'applied');
      await queueBot(db, { key: `event:${eventId}:apply:${userId}`, userId: row.created_by, eventId, body: `New application for ${row.title}. Open QUESTR to read it and choose your party.` });
    });
    return this.detail(userId, eventId);
  }
  async membership(userId: string, eventId: string, targetId: string, action: 'accept' | 'decline' | 'remove' | 'leave') {
    await transaction(this.pool, async db => {
      const row = await lockEvent(db, userId, eventId);
      if (action === 'leave') { if (userId !== targetId) throw new AppError(403, 'PERMISSION_DENIED'); }
      else await requireCapability(db, userId, action === 'remove' ? 'events.group_chat_moderator' : 'events.accept', { type: 'event', id: eventId });
      const member = (await db.query('SELECT * FROM event_memberships WHERE event_id=$1 AND user_id=$2', [eventId, targetId])).rows[0];
      if (!member || member.role === 'host') throw new AppError(400, 'INVALID_INPUT');
      const status = action === 'accept' ? 'accepted' : action === 'decline' ? 'declined' : action === 'remove' ? 'removed' : 'withdrawn';
      if (member.status === status) return;
      if (action === 'accept' || action === 'decline') { if (action === 'accept') recruiting(row); else if (row.status !== 'published') throw new AppError(409, 'EVENT_CLOSED'); if (member.status !== 'pending') throw new AppError(409, 'APPLICATION_CHANGED'); }
      else if (!['pending', 'accepted'].includes(member.status)) throw new AppError(409, 'APPLICATION_CHANGED');
      if (action === 'accept') {
        await activeUser(db, targetId);
        const count = (await db.query("SELECT count(*)::int AS count FROM event_memberships WHERE event_id=$1 AND status='accepted'", [eventId])).rows[0].count;
        if (count >= row.capacity) throw new AppError(409, 'EVENT_FULL');
        await grantEventRole(db, eventId, targetId, 'participant', userId);
      } else {
        await db.query("UPDATE role_assignments SET revoked_at=now() WHERE event_id=$1 AND user_id=$2 AND role_code IN ('participant','event_moderator') AND revoked_at IS NULL", [eventId, targetId]);
        await db.query("INSERT INTO permission_audit(user_id,actor_id,action,details,reason) VALUES($1,$2,'role.revoked',$3,$4)", [targetId, userId, JSON.stringify({ eventId }), `Membership ${status}`]);
      }
      await db.query('UPDATE event_memberships SET status=$3,updated_at=now() WHERE event_id=$1 AND user_id=$2', [eventId, targetId, status]);
      await audit(db, eventId, userId, status);
      await queueBot(db, { key: `event:${eventId}:${status}:${targetId}`, userId: targetId, eventId, body: `${row.title}: ${status === 'accepted' ? 'you are in the party. Open QUESTR for meeting details and the party chat' : status === 'declined' ? 'your application was declined' : 'you are no longer in this party'}.` });
      if (action === 'leave') await queueBot(db, { key: `event:${eventId}:left:${targetId}`, userId: row.created_by, eventId, body: `A questr left ${row.title}. Open QUESTR for the current party.` });
    });
    return action === 'leave' ? null : this.detail(userId, eventId);
  }
  async transition(userId: string, eventId: string, revision: number, status: 'cancelled' | 'completed') {
    await transaction(this.pool, async db => {
      const row = await lockEvent(db, userId, eventId);
      await requireCapability(db, userId, 'events.edit', { type: 'event', id: eventId });
      if (row.status === status) return;
      if (row.status !== 'published') throw new AppError(409, 'EVENT_CLOSED');
      if (row.revision !== revision) throw new AppError(409, 'EVENT_CONFLICT');
      if (status === 'completed' && row.starts_at.getTime() > Date.now()) throw new AppError(409, 'EVENT_NOT_STARTED');
      await db.query('UPDATE events SET status=$2,revision=revision+1,updated_at=now() WHERE id=$1', [eventId, status]);
      await db.query("DELETE FROM bot_outbox WHERE event_id=$1 AND kind='reminder' AND state='pending'", [eventId]);
      await audit(db, eventId, userId, status);
      await notifyMembers(db, eventId, `event:${eventId}:${status}`, `${row.title} was ${status}. The party chat is now closed; previous messages remain in your bot topic.`);
    });
    return this.detail(userId, eventId);
  }
  async setRecruitment(userId: string, eventId: string, revision: number, open: boolean) {
    await transaction(this.pool, async db => {
      const row = await lockEvent(db, userId, eventId);
      await requireCapability(db, userId, 'events.edit', { type: 'event', id: eventId });
      recruiting(row);
      if (row.revision !== revision) throw new AppError(409, 'EVENT_CONFLICT');
      if (row.recruitment_open === open) return;
      await db.query('UPDATE events SET recruitment_open=$2,revision=revision+1,updated_at=now() WHERE id=$1', [eventId, open]);
      await audit(db, eventId, userId, open ? 'recruitment_opened' : 'recruitment_closed');
    });
    return this.detail(userId, eventId);
  }
  async profile(userId: string, eventId: string, targetId: string) {
    const detail = await this.detail(userId, eventId);
    if (targetId !== detail.host.id && !detail.participants.some(p => p.id === targetId) && !detail.applications.some(p => p.id === targetId)) throw new AppError(404, 'NOT_FOUND');
    if (!(await this.pool.query("SELECT 1 FROM users WHERE id=$1 AND status='active'", [targetId])).rowCount) throw new AppError(404, 'NOT_FOUND');
    const profile = await getProfile(this.pool, targetId);
    if (!profile) throw new AppError(404, 'NOT_FOUND');
    return profile;
  }
  async setReminder(userId: string, eventId: string, minutesBefore: 15 | 60 | 1440 | null) {
    await transaction(this.pool, async db => {
      const event = await lockEvent(db, userId, eventId);
      if (!await can(db, userId, 'events.group_chat', { type: 'event', id: eventId })) throw new AppError(403, 'PERMISSION_DENIED');
      if (event.status !== 'published' || event.starts_at.getTime() <= Date.now()) throw new AppError(409, 'EVENT_CLOSED');
      if (minutesBefore !== null && event.starts_at.getTime() - minutesBefore * 60000 <= Date.now()) throw new AppError(400, 'REMINDER_TOO_LATE');
      await db.query("DELETE FROM bot_outbox WHERE event_id=$1 AND user_id=$2 AND kind='reminder' AND state='pending'", [eventId, userId]);
      if (minutesBefore === null) await db.query('DELETE FROM event_reminders WHERE event_id=$1 AND user_id=$2', [eventId, userId]);
      else await db.query(`INSERT INTO event_reminders(event_id,user_id,minutes_before) VALUES($1,$2,$3)
        ON CONFLICT(event_id,user_id) DO UPDATE SET minutes_before=EXCLUDED.minutes_before,queued_at=NULL,schedule_id=gen_random_uuid()`, [eventId, userId, minutesBefore]);
    });
    return this.detail(userId, eventId);
  }
}
