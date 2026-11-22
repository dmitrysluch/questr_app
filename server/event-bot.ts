import type { Pool, PoolClient } from 'pg';
import type { Config } from './config.ts';
import { transaction } from './db.ts';
import { Adventures } from './events.ts';
import { ContentReviewer } from './moderation.ts';
import { AppError } from './errors.ts';
import { can, consumeCapability } from './permissions.ts';
import { hasCommunityAccess } from './communities.ts';
import { queueBot, queuePartyTopic, type BotButton, type BotKeyboard } from './event-notifications.ts';
import { botText } from './bot-copy.ts';
import { relayMarkdown } from './telegram-markdown.ts';
import { hasPublicLink } from '../shared/events.ts';
import { dmTopicUrl } from './telegram-links.ts';
import { dateChatAllowed } from './dates.ts';
import { randomUUID } from 'node:crypto';
import { ZodError } from 'zod';
import type { OperationalMetrics } from './metrics.ts';

class TelegramError extends Error {
  constructor(public retryAfter: number | null, description = 'TELEGRAM_DELIVERY_FAILED') { super(description); }
}
const hex = (id: string) => id.replaceAll('-', '');
const uuid = (id: string) => /^[a-f0-9]{32}$/i.test(id) ? `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`.toLowerCase() : null;
const buttonLabel = (value: string) => value.length > 56 ? `${value.slice(0, 53)}…` : value;
const hasAttachment = (row: { photo_file_id?: string | null; document_file_id?: string | null }) => !!(row.photo_file_id || row.document_file_id);
/** Durable, at-most-one active processor per inbox/outbox row. The Bot API has
 * no idempotency keys: ambiguous network failures are kept as failed for review,
 * rather than automatically risking a duplicate delivery. */
export class EventBot {
  private adventures: Adventures;
  constructor(private pool: Pool, private config: Config, private fetcher: typeof fetch = fetch, private metrics?: OperationalMetrics) {
    this.adventures = new Adventures(pool, new ContentReviewer(config, fetch, metrics));
  }
  private appButton(locale: string, route?: string, label: 'openButton' | 'viewCharacterButton' = 'openButton'): BotButton | null {
    if (!this.config.publicAppUrl.startsWith('https://')) return null;
    let url: URL;
    try { url = new URL(this.config.publicAppUrl); } catch { return null; }
    url.hash = '';
    if (route) url.searchParams.set('route', route);
    return { text: botText(locale, label), web_app: { url: route ? url.toString() : this.config.publicAppUrl.split('#')[0] } };
  }
  private appKeyboard(locale: string, eventId?: string): BotKeyboard | undefined {
    const button = this.appButton(locale, eventId ? `adventures/${eventId}` : undefined);
    return button ? { inline_keyboard: [[button]] } : undefined;
  }
  private async call(method: string, body: object): Promise<any> {
    const startedAt = performance.now();
    let response: Response;
    try { response = await this.fetcher(`https://api.telegram.org/bot${this.config.botToken}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) }); }
    catch { this.metrics?.recordDependency('telegram', 'error', startedAt); throw new TelegramError(null); }
    let result: any;
    try { result = await response.json(); } catch { this.metrics?.recordDependency('telegram', 'error', startedAt); throw new TelegramError(null); }
    if (!response.ok || !result.ok) {
      this.metrics?.recordDependency('telegram', 'error', startedAt);
      throw new TelegramError(result.error_code === 429 ? Math.max(1, Math.min(3600, Number(result.parameters?.retry_after) || 30)) : null,
        `${method}: ${result.error_code ?? response.status} ${String(result.description ?? 'Telegram request failed').slice(0, 200)}`);
    }
    this.metrics?.recordDependency('telegram', 'ok', startedAt);
    return result.result;
  }
  private async topic(db: PoolClient, userId: string, eventId: string, chatId: string) {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,81))', [`${userId}:${eventId}`]);
    const old = (await db.query('SELECT thread_id FROM event_bot_topics WHERE user_id=$1 AND event_id=$2', [userId, eventId])).rows[0];
    if (old) return Number(old.thread_id);
    const event = (await db.query('SELECT title FROM events WHERE id=$1', [eventId])).rows[0];
    const topic = await this.call('createForumTopic', { chat_id: chatId, name: event.title.slice(0, 110) });
    if (!Number.isSafeInteger(topic?.message_thread_id)) throw new TelegramError(null);
    await db.query('INSERT INTO event_bot_topics(user_id,event_id,thread_id) VALUES($1,$2,$3)', [userId, eventId, topic.message_thread_id]);
    console.info('QUESTR bot topic created:', JSON.stringify({ kind: 'event', userId, eventId, chatId, threadId: topic.message_thread_id }));
    return topic.message_thread_id as number;
  }
  private async dmTopic(db: PoolClient, userId: string, dmId: string, chatId: string) {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,82))', [`${userId}:${dmId}`]);
    const old = (await db.query('SELECT thread_id,name_synced FROM dm_bot_topics WHERE user_id=$1 AND conversation_id=$2', [userId, dmId])).rows[0];
    if (old?.name_synced) return Number(old.thread_id);
    const other = (await db.query(`SELECT p.display_name FROM dm_conversations c
      JOIN profiles p ON p.user_id=CASE WHEN c.first_user_id=$1 THEN c.second_user_id ELSE c.first_user_id END
      WHERE c.id=$2 AND $1 IN (c.first_user_id,c.second_user_id)`, [userId, dmId])).rows[0];
    if (!other) throw new AppError(403, 'PERMISSION_DENIED');
    if (old) {
      let renamed = false;
      try {
        await this.call('editForumTopic', { chat_id: chatId, message_thread_id: Number(old.thread_id), name: other.display_name.slice(0, 110) });
        renamed = true;
      } catch (error) { console.warn('QUESTR bot topic rename failed:', { userId, conversationId: dmId, error: error instanceof Error ? error.message : String(error) }); }
      if (renamed) await db.query('UPDATE dm_bot_topics SET name_synced=true WHERE user_id=$1 AND conversation_id=$2', [userId, dmId]);
      return Number(old.thread_id);
    }
    const topic = await this.call('createForumTopic', { chat_id: chatId, name: other.display_name.slice(0, 110) });
    if (!Number.isSafeInteger(topic?.message_thread_id)) throw new TelegramError(null);
    await db.query('INSERT INTO dm_bot_topics(user_id,conversation_id,thread_id,name_synced) VALUES($1,$2,$3,true)', [userId, dmId, topic.message_thread_id]);
    console.info('QUESTR bot topic created:', JSON.stringify({ kind: 'dm', userId, conversationId: dmId, chatId, threadId: topic.message_thread_id }));
    return topic.message_thread_id as number;
  }
  private async dateTopic(db: PoolClient, userId: string, matchId: string, chatId: string) {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,84))', [`${userId}:${matchId}`]);
    const old = (await db.query('SELECT thread_id FROM date_bot_topics WHERE user_id=$1 AND match_id=$2', [userId, matchId])).rows[0];
    if (old) return Number(old.thread_id);
    const access = await dateChatAllowed(db, matchId, userId);
    if (!access) throw new AppError(403, 'DATE_CHAT_CLOSED');
    const person = (await db.query('SELECT display_name FROM profiles WHERE user_id=$1', [access.other])).rows[0];
    const topic = await this.call('createForumTopic', { chat_id: chatId, name: `Date · ${person.display_name}`.slice(0, 110) });
    if (!Number.isSafeInteger(topic?.message_thread_id)) throw new TelegramError(null);
    await db.query('INSERT INTO date_bot_topics(match_id,user_id,thread_id) VALUES($1,$2,$3)', [matchId, userId, topic.message_thread_id]);
    console.info('QUESTR bot topic created:', JSON.stringify({ kind: 'date', userId, matchId, chatId, threadId: topic.message_thread_id }));
    return topic.message_thread_id as number;
  }
  private async eventByCode(db: PoolClient, userId: string, code: string) {
    if (!/^[a-f0-9]{8,32}$/i.test(code)) return null;
    const rows = (await db.query(`SELECT e.id,e.title FROM events e JOIN event_memberships m ON m.event_id=e.id
      WHERE m.user_id=$1 AND m.status='accepted' AND replace(e.id::text,'-','') LIKE $2 LIMIT 2`, [userId, `${code.toLowerCase()}%`])).rows;
    return rows.length === 1 && await can(db, userId, 'events.group_chat', { type: 'event', id: rows[0].id }) ? rows[0] as { id: string; title: string } : null;
  }
  private async dmByCode(db: PoolClient, userId: string, code: string) {
    if (!/^[a-f0-9]{8,32}$/i.test(code)) return null;
    const rows = (await db.query(`SELECT DISTINCT c.* FROM dm_conversations c
      LEFT JOIN dm_conversation_aliases a ON a.conversation_id=c.id
      WHERE $1 IN (c.first_user_id,c.second_user_id)
        AND (replace(c.id::text,'-','') LIKE $2 OR replace(a.legacy_id::text,'-','') LIKE $2) LIMIT 2`, [userId, `${code.toLowerCase()}%`])).rows;
    return rows.length === 1 ? rows[0] : null;
  }
  private async sharedPeople(db: PoolClient, userId: string, eventId?: string) {
    const rows = (await db.query(`SELECT p.user_id,p.display_name,e.id AS event_id,e.title,c.status AS dm_status,c.requested_by
      FROM event_memberships mine JOIN events e ON e.id=mine.event_id
      JOIN event_memberships theirs ON theirs.event_id=e.id AND theirs.status='accepted' AND theirs.user_id<>$1
      JOIN profiles p ON p.user_id=theirs.user_id JOIN users u ON u.id=p.user_id AND u.status='active'
      JOIN telegram_accounts t ON t.user_id=p.user_id AND t.bot_started_at IS NOT NULL
      LEFT JOIN dm_conversations c ON c.first_user_id=LEAST($1::uuid,p.user_id) AND c.second_user_id=GREATEST($1::uuid,p.user_id)
      WHERE mine.user_id=$1 AND mine.status='accepted' AND e.status='published' AND ($2::uuid IS NULL OR e.id=$2)
      ORDER BY e.starts_at DESC,e.id DESC,p.display_name LIMIT 300`, [userId, eventId ?? null])).rows;
    const people: typeof rows = [];
    const seen = new Set<string>();
    for (const row of rows) {
      if (seen.has(row.user_id) || people.length >= 20) continue;
      if (!await can(db, userId, 'events.group_chat', { type: 'event', id: row.event_id })
        || !await can(db, row.user_id, 'events.group_chat', { type: 'event', id: row.event_id })) continue;
      const resource = { type: 'profile' as const, id: row.user_id, eventId: row.event_id };
      if (!await can(db, userId, 'dm.send_opener', resource) && !await can(db, userId, 'dm.message', resource)
        && !(row.dm_status === 'pending' && row.requested_by === userId)) continue;
      seen.add(row.user_id); people.push(row);
    }
    if (!eventId && people.length < 20) {
      const accepted = (await db.query(`SELECT p.user_id,p.display_name,c.status AS dm_status,c.requested_by
        FROM dm_conversations c JOIN profiles p ON p.user_id=CASE WHEN c.first_user_id=$1 THEN c.second_user_id ELSE c.first_user_id END
        JOIN users u ON u.id=p.user_id AND u.status='active'
        WHERE $1 IN (c.first_user_id,c.second_user_id) AND c.status='accepted'
        ORDER BY c.updated_at DESC LIMIT 20`, [userId])).rows;
      for (const row of accepted) {
        if (seen.has(row.user_id) || people.length >= 20) continue;
        seen.add(row.user_id); people.push({ ...row, event_id: null, title: '' });
      }
    }
    return people;
  }
  private async menuPeople(db: PoolClient, row: any, locale: string, eventId?: string) {
    const event = eventId ? await this.eventByCode(db, row.user_id, hex(eventId)) : null;
    if (eventId && !event) {
      await queueBot(db, { key: `update:${row.update_id}:reply`, userId: row.user_id, kind: 'reply', body: botText(locale, 'chatNotFound') });
      return;
    }
    const people = await this.sharedPeople(db, row.user_id, event?.id);
    const buttons = people.map(person => [{ text: buttonLabel(event ? person.display_name : person.title ? `${person.display_name.slice(0, 22)} · ${person.title.slice(0, 30)}` : person.display_name),
      callback_data: event ? `menu:member:${hex(event.id).slice(0, 16)}:${hex(person.user_id)}` : `menu:person:${hex(person.user_id)}` }]);
    const back = { text: botText(locale, 'allChatsButton'), callback_data: 'menu:chats' };
    await queueBot(db, { key: `update:${row.update_id}:reply`, userId: row.user_id, kind: 'reply',
      body: people.length ? botText(locale, event ? 'peopleList' : 'peopleGlobalList', { title: event?.title ?? '' }) : botText(locale, 'peopleEmpty'),
      keyboard: { inline_keyboard: [...buttons, [back]] } });
  }
  private async menuChats(db: PoolClient, row: any, locale: string, wake = false, fromTopic = false) {
    const events = (await db.query(`SELECT e.id,e.title FROM event_memberships m JOIN events e ON e.id=m.event_id
      WHERE m.user_id=$1 AND m.status='accepted' AND e.status='published' ORDER BY e.starts_at LIMIT 20`, [row.user_id])).rows;
    const available = [];
    let preparing = false;
    for (const event of events) {
      if (!await can(db, row.user_id, 'events.group_chat', { type: 'event', id: event.id })) continue;
      available.push(event);
      if (!(await db.query('SELECT 1 FROM event_bot_topics WHERE event_id=$1 AND user_id=$2', [event.id, row.user_id])).rowCount) {
        preparing = true;
        await queuePartyTopic(db, event.id, row.user_id, event.title, this.config.aiMode);
      }
    }
    if (wake) await db.query("UPDATE bot_outbox SET available_at=now() WHERE user_id=$1 AND kind IN ('topic_init','date_topic','date_relay') AND state='pending'", [row.user_id]);
    const dates = (await db.query(`SELECT d.title,t.thread_id FROM date_bot_topics t JOIN date_matches m ON m.id=t.match_id
      JOIN date_rounds r ON r.id=m.round_id JOIN dates d ON d.id=r.date_id WHERE t.user_id=$1 AND r.status IN ('matched','scheduled')
      ORDER BY m.created_at DESC LIMIT 10`, [row.user_id])).rows;
    const appButton = wake ? this.appButton(locale) : null;
    const keyboard: BotKeyboard = { inline_keyboard: [
      ...available.map(event => [{ text: buttonLabel(event.title), callback_data: `menu:event:${hex(event.id)}` }]),
      ...dates.map(date => [{ text: buttonLabel(`♥ ${date.title}`), url: `https://t.me/questr_game/${date.thread_id}` }]),
      [{ text: botText(locale, 'allPeopleButton'), callback_data: 'menu:people' }],
      ...(appButton ? [[appButton]] : []),
    ] };
    await queueBot(db, { key: `update:${row.update_id}:reply`, userId: row.user_id, kind: 'reply',
      body: `${fromTopic ? `${botText(locale, 'commandsInAllChats')}\n\n` : ''}${botText(locale, available.length || dates.length ? preparing ? 'chatsPreparing' : 'chatsList' : 'chatsEmpty')}`, keyboard });
  }
  private async menuEvent(db: PoolClient, row: any, locale: string, eventId: string) {
    const event = await this.eventByCode(db, row.user_id, hex(eventId));
    if (!event) {
      await queueBot(db, { key: `update:${row.update_id}:reply`, userId: row.user_id, kind: 'reply', body: botText(locale, 'chatNotFound') });
      return;
    }
    const topic = (await db.query('SELECT thread_id FROM event_bot_topics WHERE event_id=$1 AND user_id=$2', [event.id, row.user_id])).rows[0];
    if (!topic) await queuePartyTopic(db, event.id, row.user_id, event.title, this.config.aiMode);
    const link = topic ? `https://t.me/questr_game/${topic.thread_id}` : '';
    const keyboard: BotKeyboard = { inline_keyboard: [
      ...(link ? [[{ text: botText(locale, 'partyTopicButton'), url: link }]] : []),
      [{ text: botText(locale, 'peopleButton'), callback_data: `menu:people:${hex(event.id)}` }],
      [{ text: botText(locale, 'allChatsButton'), callback_data: 'menu:chats' }],
    ] };
    await queueBot(db, { key: `update:${row.update_id}:reply`, userId: row.user_id, kind: 'reply',
      body: botText(locale, topic ? 'topicReady' : 'topicPreparing', { title: event.title, link }), keyboard });
  }
  private async command(db: PoolClient, row: any, locale: string): Promise<boolean> {
    const parts = row.text.trim().split(/\s+/);
    let command = parts[0].toLowerCase().replace(/@questr_game$/, '');
    const deepLink = command === '/start' && parts.length === 2 ? /^(dm|contact)_([a-f0-9]{8,16})_([a-f0-9]{8,32})$/i.exec(parts[1]) : null;
    if (deepLink) { command = '/dm'; parts.splice(1, 1, deepLink[2], deepLink[3]); }
    const purpose = deepLink?.[1] === 'contact' ? 'contact' : 'chat';
    const reply = (body: string) => queueBot(db, { key: `update:${row.update_id}:reply`, userId: row.user_id, body, kind: 'reply',
      keyboard: /^\/start(?:@questr_game)?(?:\s|$)/i.test(row.text) ? this.appKeyboard(locale) : undefined });
    if (command === '/chats' || command === '/start' && parts.length === 1) {
      await this.menuChats(db, row, locale, command === '/start');
      return true;
    }
    if (command === '/chat' && parts.length === 2) {
      const event = await this.eventByCode(db, row.user_id, parts[1]);
      if (event) await this.menuEvent(db, row, locale, event.id);
      else await reply(botText(locale, 'chatNotFound'));
      return true;
    }
    if (command === '/people' && parts.length === 1) { await this.menuPeople(db, row, locale); return true; }
    if (command === '/people' && parts.length === 2) {
      const event = await this.eventByCode(db, row.user_id, parts[1]);
      if (event) await this.menuPeople(db, row, locale, event.id);
      else await reply(botText(locale, 'chatNotFound'));
      return true;
    }
    if (command === '/dm' && parts.length === 2 && /^[a-f0-9]{8,32}$/i.test(parts[1])) {
      const matches = (await db.query(`SELECT c.id,p.display_name,p.user_id AS other_id FROM dm_conversations c
        JOIN profiles p ON p.user_id=CASE WHEN c.first_user_id=$1 THEN c.second_user_id ELSE c.first_user_id END
        WHERE $1 IN (c.first_user_id,c.second_user_id) AND c.status='accepted'
          AND replace(p.user_id::text,'-','') LIKE $2 LIMIT 2`, [row.user_id, `${parts[1].toLowerCase()}%`])).rows;
      if (matches.length !== 1 || !await can(db, row.user_id, 'dm.message', { type: 'profile', id: matches[0].other_id })) {
        await reply(botText(locale, 'dmUnavailable')); return true;
      }
      const dm = matches[0];
      const topic = (await db.query('SELECT thread_id,name_synced FROM dm_bot_topics WHERE conversation_id=$1 AND user_id=$2', [dm.id, row.user_id])).rows[0];
      if (topic && !topic.name_synced) {
        const chatId = (await db.query('SELECT telegram_user_id FROM telegram_accounts WHERE user_id=$1', [row.user_id])).rows[0]?.telegram_user_id;
        if (chatId) await this.dmTopic(db, row.user_id, dm.id, chatId);
      }
      if (!topic) await queueBot(db, { key: `dm:${dm.id}:resume:${row.update_id}`, userId: row.user_id, dmId: dm.id, kind: 'dm_accept', inTopic: true,
        body: botText(locale, 'dmAccepted', { name: dm.display_name, code: hex(dm.id).slice(0, 8) }) });
      await reply(botText(locale, topic ? 'dmTopicReady' : 'dmTopicPreparing', { name: dm.display_name, link: topic ? await dmTopicUrl(db, row.user_id, dm.id) ?? '' : '' }));
      return true;
    }
    if (command === '/dm' && parts.length === 3) {
      const event = await this.eventByCode(db, row.user_id, parts[1]);
      if (!event || !/^[a-f0-9]{8,32}$/i.test(parts[2])) { await reply(botText(locale, 'dmUnavailable')); return true; }
      const people = (await db.query(`SELECT p.user_id,p.display_name FROM event_memberships m JOIN profiles p ON p.user_id=m.user_id
        JOIN users u ON u.id=m.user_id JOIN telegram_accounts t ON t.user_id=m.user_id AND t.bot_started_at IS NOT NULL
        WHERE m.event_id=$1 AND m.status='accepted' AND m.user_id<>$2 AND u.status='active'
          AND replace(m.user_id::text,'-','') LIKE $3 LIMIT 2`, [event.id, row.user_id, `${parts[2].toLowerCase()}%`])).rows;
      if (people.length !== 1) { await reply(botText(locale, 'dmUnavailable')); return true; }
      const person = people[0];
      const pair = [row.user_id, person.user_id].sort();
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,83))', [pair.join(':')]);
      let dm = (await db.query('SELECT * FROM dm_conversations WHERE first_user_id=$1 AND second_user_id=$2', pair)).rows[0];
      const capability = dm?.status === 'accepted' ? 'dm.message' : 'dm.send_opener';
      if (dm?.status === 'declined' || dm?.status === 'blocked' || dm?.status === 'pending' && dm.requested_by !== row.user_id || dm?.status !== 'pending' && !await can(db, row.user_id, capability, { type: 'profile', id: person.user_id, eventId: event.id })) { await reply(botText(locale, 'dmUnavailable')); return true; }
      if (!dm) dm = (await db.query(`INSERT INTO dm_conversations(event_id,first_user_id,second_user_id,requested_by,purpose)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(first_user_id,second_user_id) DO UPDATE SET updated_at=dm_conversations.updated_at RETURNING *`, [event.id, ...pair, row.user_id, purpose])).rows[0];
      else if (dm.status === 'draft' && (dm.purpose !== purpose || dm.event_id !== event.id)) {
        await db.query('UPDATE dm_conversations SET purpose=$2,event_id=$3 WHERE id=$1', [dm.id, purpose, event.id]);
        dm.purpose = purpose;
        dm.event_id = event.id;
      }
      await db.query('INSERT INTO dm_conversation_events(conversation_id,event_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [dm.id, event.id]);
      const topic = (await db.query('SELECT thread_id,name_synced FROM dm_bot_topics WHERE conversation_id=$1 AND user_id=$2', [dm.id, row.user_id])).rows[0];
      if (topic && !topic.name_synced) {
        const chatId = (await db.query('SELECT telegram_user_id FROM telegram_accounts WHERE user_id=$1', [row.user_id])).rows[0]?.telegram_user_id;
        if (chatId) await this.dmTopic(db, row.user_id, dm.id, chatId);
      }
      if (!topic && ['draft', 'accepted'].includes(dm.status)) await queueBot(db, { key: `dm:${dm.id}:topic:${row.user_id}`, userId: row.user_id, dmId: dm.id, kind: 'reply', inTopic: true,
        body: botText(locale, dm.status === 'accepted' ? 'dmAccepted' : 'dmStart', { name: person.display_name, title: event.title, code: dm.id.replaceAll('-', '').slice(0, 8) }) });
      await reply(botText(locale, dm.status === 'pending' ? 'dmWaiting' : topic ? 'dmTopicReady' : 'dmTopicPreparing', { name: person.display_name, link: topic ? await dmTopicUrl(db, row.user_id, dm.id) ?? '' : '' }));
      return true;
    }
    if (['/accept', '/decline', '/block'].includes(command) && parts.length === 2) {
      const selected = await this.dmByCode(db, row.user_id, parts[1]);
      const dm = selected ? (await db.query('SELECT * FROM dm_conversations WHERE id=$1 FOR UPDATE', [selected.id])).rows[0] : null;
      if (!dm || command !== '/block' && (dm.status !== 'pending' || dm.requested_by === row.user_id) || command === '/block' && dm.status !== 'accepted') { await reply(botText(locale, 'dmNoRequest')); return true; }
      const other = dm.first_user_id === row.user_id ? dm.second_user_id : dm.first_user_id;
      if (command === '/accept') {
        await db.query('SAVEPOINT dm_consent');
        await db.query("UPDATE dm_conversations SET status='accepted',updated_at=now() WHERE id=$1", [dm.id]);
        if (!await can(db, row.user_id, 'dm.message', { type: 'profile', id: other }) || !await can(db, other, 'dm.message', { type: 'profile', id: row.user_id })) { await db.query('ROLLBACK TO SAVEPOINT dm_consent'); await reply(botText(locale, 'dmUnavailable')); return true; }
        const names = (await db.query('SELECT user_id,display_name FROM profiles WHERE user_id=ANY($1::uuid[])', [[row.user_id, other]])).rows;
        for (const id of [row.user_id, other]) await queueBot(db, { key: `dm:${dm.id}:accepted:${id}`, userId: id, dmId: dm.id, kind: 'dm_accept', inTopic: true, body: botText((await db.query('SELECT locale FROM users WHERE id=$1', [id])).rows[0].locale, dm.purpose === 'contact' && id === row.user_id ? 'dmAcceptedContact' : 'dmAccepted', { name: names.find(n => n.user_id !== id)?.display_name ?? '', code: dm.id.replaceAll('-', '').slice(0, 8) }) });
        const opener = (await db.query('SELECT id,body FROM dm_messages WHERE conversation_id=$1 ORDER BY created_at LIMIT 1', [dm.id])).rows[0];
        if (opener) await queueBot(db, { key: `dm:${dm.id}:opener`, userId: row.user_id, dmId: dm.id, dmMessageId: opener.id, kind: 'dm_relay', inTopic: true, body: `${names.find(n => n.user_id === other)?.display_name}:\n${opener.body}` });
      } else {
        await db.query('UPDATE dm_conversations SET status=$2,updated_at=now() WHERE id=$1', [dm.id, command === '/block' ? 'blocked' : 'declined']);
        await reply(botText(locale, command === '/block' ? 'dmBlocked' : 'dmDeclined'));
        await queueBot(db, { key: `dm:${dm.id}:${command}:${other}`, userId: other, dmId: dm.id, kind: 'notification', inTopic: true, body: botText((await db.query('SELECT locale FROM users WHERE id=$1', [other])).rows[0].locale, command === '/block' ? 'dmBlocked' : 'dmDeclined') });
      }
      return true;
    }
    return false;
  }
  private async dmText(db: PoolClient, row: any, locale: string): Promise<boolean> {
    const redirect = (await db.query(`SELECT r.conversation_id FROM dm_topic_redirects r
      WHERE r.user_id=$1 AND r.thread_id=$2`, [row.user_id, row.thread_id])).rows[0];
    if (redirect) {
      const link = await dmTopicUrl(db, row.user_id, redirect.conversation_id);
      await queueBot(db, { key: `update:${row.update_id}:reply`, userId: row.user_id, threadId: Number(row.thread_id),
        kind: 'reply', inTopic: true, body: botText(locale, 'dmMoved', { link: link ?? 'https://t.me/questr_game' }) });
      return true;
    }
    const mapped = (await db.query('SELECT conversation_id FROM dm_bot_topics WHERE user_id=$1 AND thread_id=$2', [row.user_id, row.thread_id])).rows[0];
    if (!mapped) return false;
    const dm = (await db.query('SELECT * FROM dm_conversations WHERE id=$1 FOR UPDATE', [mapped.conversation_id])).rows[0];
    const other = dm.first_user_id === row.user_id ? dm.second_user_id : dm.first_user_id;
    const reply = (body: string) => queueBot(db, { key: `update:${row.update_id}:reply`, userId: row.user_id, dmId: dm.id, body, kind: 'reply', inTopic: true });
    if (row.text.length > 3000) throw new AppError(400, 'MESSAGE_TOO_LONG');
    if (dm.status === 'pending') { await reply(botText(locale, 'dmWaiting')); return true; }
    if (dm.status !== 'draft' && dm.status !== 'accepted') { await reply(botText(locale, 'dmUnavailable')); return true; }
    if (dm.status === 'draft' && (!dm.event_id || dm.requested_by !== row.user_id || !await can(db, row.user_id, 'dm.send_opener', { type: 'profile', id: other, eventId: dm.event_id })) || dm.status === 'accepted' && !await can(db, row.user_id, 'dm.message', { type: 'profile', id: other })) { await reply(botText(locale, 'dmUnavailable')); return true; }
    if (dm.status === 'draft' && hasAttachment(row)) { await reply(botText(locale, 'photoOpenerTextOnly')); return true; }
    if (hasAttachment(row) && row.text.length > 900) throw new AppError(400, 'PHOTO_CAPTION_TOO_LONG');
    if (dm.status === 'draft' && hasPublicLink(row.text)) throw new AppError(400, 'APPLICATION_LINK_NOT_ALLOWED');
    await this.adventures.review(row.text);
    if (dm.status === 'draft') await consumeCapability(db, row.user_id, 'dm.send_opener', { type: 'profile', id: other, eventId: dm.event_id }, dm.id);
    const message = (await db.query('INSERT INTO dm_messages(conversation_id,sender_id,telegram_update_id,body,photo_file_id,document_file_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(telegram_update_id) DO NOTHING RETURNING id', [dm.id, row.user_id, row.update_id, row.text, row.photo_file_id, row.document_file_id])).rows[0];
    if (!message) return true;
    const name = (await db.query('SELECT display_name FROM profiles WHERE user_id=$1', [row.user_id])).rows[0].display_name;
    if (dm.status === 'draft') {
      await db.query("UPDATE dm_conversations SET status='pending',updated_at=now() WHERE id=$1", [dm.id]);
      const title = (await db.query('SELECT title FROM events WHERE id=$1', [dm.event_id])).rows[0].title;
      const targetLocale = (await db.query('SELECT locale FROM users WHERE id=$1', [other])).rows[0].locale;
      await queueBot(db, { key: `dm:${dm.id}:request`, userId: other, dmId: dm.id, kind: 'dm_request', body: botText(targetLocale, dm.purpose === 'contact' ? 'dmRequestedContact' : 'dmRequested', { name, title, message: row.text }) });
      await reply(botText(locale, 'dmWaiting'));
    } else {
      await queueBot(db, { key: `dm:message:${message.id}`, userId: other, dmId: dm.id, dmMessageId: message.id, kind: 'dm_relay', inTopic: true, body: `${name}:\n${row.text}` });
    }
    return true;
  }
  private async dateText(db: PoolClient, row: any, locale: string): Promise<boolean> {
    const mapping = (await db.query('SELECT match_id FROM date_bot_topics WHERE user_id=$1 AND thread_id=$2', [row.user_id, row.thread_id])).rows[0];
    if (!mapping) return false;
    const reply = (body: string) => queueBot(db, { key: `update:${row.update_id}:reply`, userId: row.user_id,
      dateMatchId: mapping.match_id, kind: 'reply', inTopic: true, body });
    const access = await dateChatAllowed(db, mapping.match_id, row.user_id);
    if (!access) { await reply(botText(locale, 'chatClosed')); return true; }
    if (!hasAttachment(row) && !row.text.trim()) { await reply(botText(locale, 'messageLength')); return true; }
    const body = row.text.trim();
    if (body.length > (hasAttachment(row) ? 900 : 2000)) throw new AppError(400, hasAttachment(row) ? 'PHOTO_CAPTION_TOO_LONG' : 'MESSAGE_TOO_LONG');
    await this.adventures.review(body);
    const inserted = (await db.query(`INSERT INTO date_messages(match_id,sender_id,body,request_id,telegram_update_id,photo_file_id,document_file_id)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(telegram_update_id) DO NOTHING RETURNING id`,
      [mapping.match_id, row.user_id, body, randomUUID(), row.update_id, row.photo_file_id, row.document_file_id])).rows[0];
    if (!inserted) return true;
    const name = (await db.query('SELECT display_name FROM profiles WHERE user_id=$1', [row.user_id])).rows[0].display_name;
    await queueBot(db, { key: `date:message:${inserted.id}`, userId: access.other, dateMatchId: mapping.match_id,
      dateMessageId: inserted.id, kind: 'date_relay', inTopic: true, body: `${name}:\n${body}` });
    return true;
  }
  private async menuCallback(db: PoolClient, row: any, locale: string) {
    const data = row.callback_data as string;
    const respond = (body: string) => queueBot(db, { key: `update:${row.update_id}:reply`, userId: row.user_id, body, kind: 'reply' });
    let valid = true;
    if (data === 'menu:chats') await this.menuChats(db, row, locale);
    else if (data === 'menu:people') await this.menuPeople(db, row, locale);
    else if (/^menu:event:[a-f0-9]{32}$/.test(data)) await this.menuEvent(db, row, locale, uuid(data.slice(11))!);
    else if (/^menu:people:[a-f0-9]{32}$/.test(data)) await this.menuPeople(db, row, locale, uuid(data.slice(12))!);
    else if (/^menu:person:[a-f0-9]{32}$/.test(data)) {
      const personId = uuid(data.slice(12))!;
      const person = (await this.sharedPeople(db, row.user_id)).find(p => p.user_id === personId);
      if (person) await this.command(db, { ...row, text: person.event_id ? `/dm ${hex(person.event_id)} ${hex(personId)}` : `/dm ${hex(personId)}` }, locale);
      else { valid = false; await respond(botText(locale, 'dmUnavailable')); }
    } else {
      const member = /^menu:member:([a-f0-9]{16}):([a-f0-9]{32})$/.exec(data);
      const event = member ? await this.eventByCode(db, row.user_id, member[1]) : null;
      const person = event && member ? (await this.sharedPeople(db, row.user_id, event.id)).find(p => hex(p.user_id) === member[2]) : null;
      if (person) await this.command(db, { ...row, text: `/dm ${hex(event!.id)} ${hex(person.user_id)}` }, locale);
      else { valid = false; await respond(botText(locale, 'dmUnavailable')); }
    }
    try { await this.call('answerCallbackQuery', { callback_query_id: row.callback_query_id, ...(valid ? {} : { text: botText(locale, 'dmUnavailable') }) }); } catch { /* The queued menu reply still arrives. */ }
  }
  private async dmDecisionCallback(db: PoolClient, row: any, locale: string) {
    const match = /^dm:(accept|decline):([a-f0-9]{32})$/.exec(row.callback_data ?? '');
    let answer = botText(locale, 'dmNoRequest');
    let clearButtons = false;
    if (match) {
      const dmId = (await db.query('SELECT conversation_id FROM dm_conversation_aliases WHERE legacy_id=$1', [uuid(match[2])])).rows[0]?.conversation_id ?? uuid(match[2])!;
      const request = (await db.query(`SELECT c.status,c.requested_by FROM bot_outbox o JOIN dm_conversations c ON c.id=o.dm_id
        WHERE o.dm_id=$1 AND o.user_id=$2 AND o.kind='dm_request' AND o.telegram_message_id=$3 AND o.state='sent'`, [dmId, row.user_id, row.callback_message_id])).rows[0];
      if (request) {
        if (request.status === 'pending' && request.requested_by !== row.user_id) {
          await this.command(db, { ...row, text: `/${match[1]} ${match[2]}` }, locale);
          const status = (await db.query('SELECT status FROM dm_conversations WHERE id=$1', [dmId])).rows[0]?.status;
          if (status === (match[1] === 'accept' ? 'accepted' : 'declined')) {
            answer = botText(locale, match[1] === 'accept' ? 'applicationAccepted' : 'applicationDeclined');
            clearButtons = true;
          } else answer = botText(locale, 'dmUnavailable');
        } else clearButtons = true;
      }
    }
    try { await this.call('answerCallbackQuery', { callback_query_id: row.callback_query_id, text: answer }); } catch { /* Decision remains durable. */ }
    if (clearButtons) {
      const chatId = (await db.query('SELECT telegram_user_id FROM telegram_accounts WHERE user_id=$1', [row.user_id])).rows[0]?.telegram_user_id;
      if (chatId) try { await this.call('editMessageReplyMarkup', { chat_id: chatId, message_id: row.callback_message_id, reply_markup: { inline_keyboard: [] } }); } catch { /* A later press rechecks status. */ }
    }
  }
  private async applicationCallback(db: PoolClient, row: any, locale: string) {
    const match = /^application:(accept|decline):(\d{1,20})$/.exec(row.callback_data ?? '');
    let answer = botText(locale, 'unavailable');
    let clearButtons = false;
    let eventId: string | null = null;
    if (match) {
      const application = (await db.query(`SELECT o.event_id,o.application_user_id,o.user_id,o.application_attempt_id AS notification_attempt_id,m.application_attempt_id AS member_attempt_id,m.status
        FROM bot_outbox o LEFT JOIN event_memberships m ON m.event_id=o.event_id AND m.user_id=o.application_user_id
        WHERE o.id=$1 AND o.kind='application' AND o.telegram_message_id=$2`, [match[2], row.callback_message_id])).rows[0];
      if (application?.user_id === row.user_id) {
        eventId = application.event_id;
        if (application.status === 'pending' && application.notification_attempt_id === application.member_attempt_id) {
          try {
            await this.adventures.membership(row.user_id, application.event_id, application.application_user_id, match[1] as 'accept' | 'decline', application.notification_attempt_id);
            answer = botText(locale, match[1] === 'accept' ? 'applicationAccepted' : 'applicationDeclined');
            clearButtons = true;
          } catch (error) {
            if (!(error instanceof AppError) || error.status >= 500) throw error;
            answer = botText(locale, ['APPLICATION_CHANGED', 'EVENT_FULL', 'EVENT_CLOSED'].includes(error.code) ? 'applicationChanged' : 'unavailable');
            clearButtons = error.code === 'APPLICATION_CHANGED';
          }
        } else { answer = botText(locale, 'applicationChanged'); clearButtons = true; }
      }
    }
    // Telegram keeps the button spinner open until answerCallbackQuery is called.
    try { await this.call('answerCallbackQuery', { callback_query_id: row.callback_query_id, text: answer }); } catch { /* The decision is durable even if the transient answer fails. */ }
    if (clearButtons && eventId) {
      try { await this.call('editMessageReplyMarkup', { chat_id: (await db.query('SELECT telegram_user_id FROM telegram_accounts WHERE user_id=$1', [row.user_id])).rows[0].telegram_user_id,
        message_id: row.callback_message_id, reply_markup: { inline_keyboard: [] } }); } catch { /* A stale button is harmless: every press rechecks membership. */ }
    }
  }
  async inbox(): Promise<boolean> {
    return transaction(this.pool, async db => {
      const row = (await db.query("SELECT * FROM bot_inbox WHERE state='pending' AND available_at<=now() ORDER BY update_id LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];
      if (!row) return false;
      const reply = (body: string, eventId?: string) => queueBot(db, { key: `update:${row.update_id}:reply`, userId: row.user_id, eventId, body, kind: 'reply', inTopic: !!eventId,
        keyboard: /^\/start(?:@questr_game)?(?:\s|$)/i.test(row.text) ? this.appKeyboard(locale, eventId) : undefined });
      const replyInOrigin = async (body: string) => {
        if (row.thread_id) {
          const date = (await db.query('SELECT match_id FROM date_bot_topics WHERE user_id=$1 AND thread_id=$2', [row.user_id, row.thread_id])).rows[0];
          if (date) return queueBot(db, { key: `update:${row.update_id}:reply`, userId: row.user_id, dateMatchId: date.match_id, body, kind: 'reply', inTopic: true });
          const dm = (await db.query('SELECT conversation_id FROM dm_bot_topics WHERE user_id=$1 AND thread_id=$2', [row.user_id, row.thread_id])).rows[0];
          if (dm) return queueBot(db, { key: `update:${row.update_id}:reply`, userId: row.user_id, dmId: dm.conversation_id, body, kind: 'reply', inTopic: true });
          const event = (await db.query('SELECT event_id FROM event_bot_topics WHERE user_id=$1 AND thread_id=$2', [row.user_id, row.thread_id])).rows[0];
          if (event) return reply(body, event.event_id);
        }
        return reply(body);
      };
      let locale = 'en';
      await db.query('SAVEPOINT process_bot_update');
      try {
        const user = (await db.query("SELECT status,locale FROM users WHERE id=$1", [row.user_id])).rows[0];
        locale = user?.locale ?? 'en';
        if (row.callback_query_id) {
          if (row.callback_data?.startsWith('application:')) await this.applicationCallback(db, row, locale);
          else if (row.callback_data?.startsWith('dm:')) await this.dmDecisionCallback(db, row, locale);
          else if (row.callback_data?.startsWith('menu:')) await this.menuCallback(db, row, locale);
          else try { await this.call('answerCallbackQuery', { callback_query_id: row.callback_query_id, text: botText(locale, 'unavailable') }); } catch { /* Unknown callback. */ }
        }
        else if (user?.status !== 'active') { await reply(botText(locale, 'finishCharacter')); }
        else if (row.thread_id && !hasAttachment(row) && row.text.startsWith('/')) {
          await this.menuChats(db, row, locale, false, true);
        }
        else if (!hasAttachment(row) && /^\/start(?:@questr_game)? quest_[a-f0-9]{32}$/.test(row.text)) {
          const raw = row.text.split('quest_')[1];
          const eventId = `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
          const event = await this.adventures.detail(row.user_id, eventId);
          if (event.canChat) {
            const topic = (await db.query('SELECT thread_id FROM event_bot_topics WHERE event_id=$1 AND user_id=$2', [eventId, row.user_id])).rows[0];
            if (!topic) await queuePartyTopic(db, eventId, row.user_id, event.title, this.config.aiMode);
            await reply(botText(locale, topic ? 'topicReady' : 'topicPreparing', { title: event.title, link: topic ? `https://t.me/questr_game/${topic.thread_id}` : '' }));
          }
          else if (event.myStatus === 'pending') await reply(botText(locale, 'topicPending', { title: event.title }));
          else if (event.canApply) await reply(botText(locale, 'applyInApp', { title: event.title }));
          else await reply(botText(locale, 'notAccepting'));
        } else if (!hasAttachment(row) && await this.command(db, row, locale)) {
          // Command replies are queued by the command handler.
        } else if (row.thread_id && (hasAttachment(row) || !row.text.startsWith('/'))) {
          if (await this.dateText(db, row, locale) || await this.dmText(db, row, locale)) {
            // A private topic has its own consent and delivery rules.
          } else {
          const mapping = (await db.query('SELECT event_id FROM event_bot_topics WHERE user_id=$1 AND thread_id=$2', [row.user_id, row.thread_id])).rows[0];
          if (!mapping) await reply(botText(locale, hasAttachment(row) ? 'chooseTopic' : 'offTopicText'));
          else {
            const event = await this.adventures.detail(row.user_id, mapping.event_id);
            if (event.canChat) {
              if (row.text.length > 3000) throw new AppError(400, 'MESSAGE_TOO_LONG');
              if (hasAttachment(row) && row.text.length > 900) throw new AppError(400, 'PHOTO_CAPTION_TOO_LONG');
              await this.adventures.review(row.text);
              await transaction(this.pool, async sendDb => {
                await sendDb.query('SELECT id FROM events WHERE id=$1 FOR SHARE', [event.id]);
                if (!await can(sendDb, row.user_id, 'events.group_chat', { type: 'event', id: event.id })) throw new AppError(403, 'PERMISSION_DENIED');
                const message = (await sendDb.query('INSERT INTO event_messages(event_id,sender_id,telegram_update_id,body,photo_file_id,document_file_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(telegram_update_id) DO NOTHING RETURNING id', [event.id, row.user_id, row.update_id, row.text, row.photo_file_id, row.document_file_id])).rows[0];
                if (!message) return;
                const name = (await sendDb.query('SELECT display_name FROM profiles WHERE user_id=$1', [row.user_id])).rows[0].display_name;
                const recipients = (await sendDb.query("SELECT user_id FROM event_memberships WHERE event_id=$1 AND status='accepted' AND user_id<>$2", [event.id, row.user_id])).rows;
                for (const recipient of recipients) await queueBot(sendDb, { key: `message:${message.id}:${recipient.user_id}`, userId: recipient.user_id, eventId: event.id, messageId: message.id, kind: 'relay', inTopic: true, body: `${name}:\n${row.text}` });
              });
            } else await reply(botText(locale, event.myStatus === 'pending' ? 'alreadyPending' : 'chatClosed'), event.id);
          }
          }
        } else await reply(botText(locale, hasAttachment(row) ? 'chooseTopic' : 'offTopicText'));
        await db.query("UPDATE bot_inbox SET state='done',attempts=attempts+1 WHERE update_id=$1", [row.update_id]);
      } catch (error) {
        await db.query('ROLLBACK TO SAVEPOINT process_bot_update');
        if (error instanceof ZodError || (error instanceof AppError && error.status < 500)) {
          const message = botText(locale, error instanceof ZodError ? 'applicationLength' : error.code === 'EVENT_CONTENT_REQUIRES_CHANGES' ? 'explicitContent' : error.code === 'APPLICATION_LINK_NOT_ALLOWED' ? 'noLinks' : error.code === 'MESSAGE_TOO_LONG' ? 'messageLength' : error.code === 'PHOTO_CAPTION_TOO_LONG' ? 'photoCaptionLength' : 'unavailable');
          await replyInOrigin(message);
          await db.query("UPDATE bot_inbox SET state='done',attempts=attempts+1 WHERE update_id=$1", [row.update_id]);
        } else {
          const terminal = row.attempts >= 2;
          await db.query("UPDATE bot_inbox SET state=$2,attempts=attempts+1,available_at=now()+interval '30 seconds' WHERE update_id=$1", [row.update_id, terminal ? 'failed' : 'pending']);
          if (terminal) {
            console.error('QUESTR bot inbox failed:', { updateId: row.update_id, error: error instanceof AppError ? error.code : error instanceof Error ? error.name : String(error) });
            await replyInOrigin(botText(locale, 'processingFailed'));
          }
        }
      }
      return true;
    });
  }
  async reminders(): Promise<boolean> {
    return transaction(this.pool, async db => {
      const row = (await db.query(`SELECT r.*,e.title,e.starts_at,e.time_zone,e.status,u.locale FROM event_reminders r JOIN events e ON e.id=r.event_id JOIN users u ON u.id=r.user_id
        WHERE r.queued_at IS NULL AND e.starts_at-make_interval(mins=>r.minutes_before)<=now()
        ORDER BY e.starts_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED`)).rows[0];
      if (!row) return false;
      if (row.status === 'published' && row.starts_at.getTime() > Date.now() && await can(db, row.user_id, 'events.group_chat', { type: 'event', id: row.event_id })) {
        const localStart = new Intl.DateTimeFormat(row.locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: row.time_zone }).format(row.starts_at);
        await queueBot(db, { key: `reminder:${row.schedule_id}`, userId: row.user_id, eventId: row.event_id,
          kind: 'reminder', body: botText(row.locale, 'reminder', { title: row.title, time: localStart, zone: row.time_zone }) });
      }
      await db.query('UPDATE event_reminders SET queued_at=now() WHERE event_id=$1 AND user_id=$2', [row.event_id, row.user_id]);
      return true;
    });
  }
  async outbox(): Promise<boolean> {
    return transaction(this.pool, async db => {
      const row = (await db.query("SELECT * FROM bot_outbox WHERE state='pending' AND available_at<=now() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];
      if (!row) return false;
      const account = (await db.query("SELECT t.telegram_user_id,u.locale FROM telegram_accounts t JOIN users u ON u.id=t.user_id WHERE t.user_id=$1 AND t.bot_started_at IS NOT NULL AND u.status<>'blocked'", [row.user_id])).rows[0];
      let allowed = !!account;
      if (row.event_id) {
        await db.query('SELECT id FROM events WHERE id=$1 FOR SHARE', [row.event_id]);
        const event = (await db.query("SELECT e.community_id FROM events e JOIN users u ON u.id=e.created_by WHERE e.id=$1 AND u.status='active'", [row.event_id])).rows[0];
        allowed = allowed && !!event && (!event.community_id || await hasCommunityAccess(db, row.user_id, event.community_id));
      }
      let relayBody: string | null = null;
      let relayPhotoId: string | null = null;
      let relayDocumentId: string | null = null;
      if (allowed && row.kind === 'relay') {
        const message = (await db.query('SELECT sender_id,body,photo_file_id,document_file_id FROM event_messages WHERE id=$1', [row.message_id])).rows[0];
        allowed = !!message && await can(db, row.user_id, 'events.group_chat', { type: 'event', id: row.event_id }) && await can(db, message.sender_id, 'events.group_chat', { type: 'event', id: row.event_id });
        if (allowed) { relayBody = message.body; relayPhotoId = message.photo_file_id; relayDocumentId = message.document_file_id; }
      }
      if (allowed && row.kind === 'reminder') allowed = await can(db, row.user_id, 'events.group_chat', { type: 'event', id: row.event_id });
      if (row.kind === 'topic_init') {
        allowed = await can(db, row.user_id, 'events.group_chat', { type: 'event', id: row.event_id });
        if (allowed && (await db.query('SELECT 1 FROM event_bot_topics WHERE event_id=$1 AND user_id=$2', [row.event_id, row.user_id])).rowCount) {
          await db.query("UPDATE bot_outbox SET state='discarded' WHERE id=$1", [row.id]);
          return true;
        }
        if (allowed && !account) {
          await db.query("UPDATE bot_outbox SET available_at=now()+interval '1 minute' WHERE id=$1", [row.id]);
          return true;
        }
      }
      if (allowed && row.kind === 'application') {
        const application = (await db.query('SELECT status,application_attempt_id FROM event_memberships WHERE event_id=$1 AND user_id=$2', [row.event_id, row.application_user_id])).rows[0];
        allowed = application?.status === 'pending' && application.application_attempt_id === row.application_attempt_id && await can(db, row.user_id, 'events.accept', { type: 'event', id: row.event_id });
      }
      if (allowed && row.dm_id) {
        const dm = (await db.query('SELECT * FROM dm_conversations WHERE id=$1 FOR SHARE', [row.dm_id])).rows[0];
        allowed = !!dm && [dm.first_user_id, dm.second_user_id].includes(row.user_id);
        if (allowed) {
          const other = dm.first_user_id === row.user_id ? dm.second_user_id : dm.first_user_id;
          if (row.kind === 'dm_request') allowed = dm.status === 'pending' && dm.requested_by !== row.user_id
            && (await db.query("SELECT count(*)::int AS n FROM users WHERE id=ANY($1::uuid[]) AND status='active'", [[dm.requested_by, row.user_id]])).rows[0].n === 2;
          if (row.kind === 'dm_accept') allowed = dm.status === 'accepted'
            && await can(db, row.user_id, 'dm.message', { type: 'profile', id: other })
            && await can(db, other, 'dm.message', { type: 'profile', id: row.user_id });
          if (row.kind === 'dm_relay') {
            const message = (await db.query('SELECT sender_id,body,photo_file_id,document_file_id FROM dm_messages WHERE id=$1 AND conversation_id=$2', [row.dm_message_id, row.dm_id])).rows[0];
            allowed = dm.status === 'accepted' && !!message && message.sender_id === other
              && await can(db, row.user_id, 'dm.message', { type: 'profile', id: other })
              && await can(db, other, 'dm.message', { type: 'profile', id: row.user_id });
            if (allowed) { relayBody = message.body; relayPhotoId = message.photo_file_id; relayDocumentId = message.document_file_id; }
          }
          // A reply may explain why a closed topic no longer accepts messages.
        }
      }
      if (row.date_match_id) {
        const access = await dateChatAllowed(db, row.date_match_id, row.user_id);
        if (row.kind === 'date_topic' || row.kind === 'date_relay') {
          if (!account) {
            await db.query("UPDATE bot_outbox SET available_at=now()+interval '1 minute' WHERE id=$1", [row.id]);
            return true;
          }
          allowed = !!access;
        }
        if (allowed && row.kind === 'date_relay') {
          const message = (await db.query('SELECT sender_id,body,photo_file_id,document_file_id FROM date_messages WHERE id=$1 AND match_id=$2', [row.date_message_id, row.date_match_id])).rows[0];
          allowed = !!message && message.sender_id === access?.other;
          if (allowed) { relayBody = message.body; relayPhotoId = message.photo_file_id; relayDocumentId = message.document_file_id; }
        }
      }
      if (allowed && row.date_other_user_id) {
        allowed = !!(await db.query("SELECT 1 FROM users WHERE id=$1 AND status='active'", [row.date_other_user_id])).rowCount
          && !(await db.query(`SELECT 1 FROM date_blocks WHERE blocker_id IN ($1::uuid,$2::uuid)
            AND blocked_id IN ($1::uuid,$2::uuid)`, [row.user_id, row.date_other_user_id])).rowCount
          && !(await db.query(`SELECT 1 FROM dm_conversations WHERE first_user_id=LEAST($1::uuid,$2::uuid)
            AND second_user_id=GREATEST($1::uuid,$2::uuid) AND status='blocked'`, [row.user_id, row.date_other_user_id])).rowCount;
      }
      if (!allowed) { await db.query("UPDATE bot_outbox SET state='discarded' WHERE id=$1", [row.id]); return true; }
      try {
        const thread = row.target_thread_id ? Number(row.target_thread_id)
          : row.in_topic && row.date_match_id ? await this.dateTopic(db, row.user_id, row.date_match_id, account.telegram_user_id)
          : row.in_topic && row.dm_id ? await this.dmTopic(db, row.user_id, row.dm_id, account.telegram_user_id)
          : row.in_topic && row.event_id ? await this.topic(db, row.user_id, row.event_id, account.telegram_user_id) : undefined;
        const profileButton = row.kind === 'application' && row.event_id && row.application_user_id
          ? this.appButton(account.locale, `adventures/${row.event_id}/character/${row.application_user_id}`, 'viewCharacterButton') : null;
        const keyboard = row.reply_markup ?? (row.kind === 'application' ? { inline_keyboard: [
          [{ text: botText(account.locale, 'acceptButton'), callback_data: `application:accept:${row.id}` }, { text: botText(account.locale, 'declineButton'), callback_data: `application:decline:${row.id}` }],
          ...(profileButton ? [[profileButton]] : []),
        ] } : row.kind === 'dm_request' ? { inline_keyboard: [
          [{ text: botText(account.locale, 'acceptButton'), callback_data: `dm:accept:${hex(row.dm_id)}` }, { text: botText(account.locale, 'declineButton'), callback_data: `dm:decline:${hex(row.dm_id)}` }],
        ] } : undefined);
        const suffix = relayBody === null ? null : `:\n${relayBody}`;
        const author = suffix && row.body.endsWith(suffix) ? row.body.slice(0, -suffix.length) : null;
        const markdown = author && relayBody !== null ? relayMarkdown(author, relayBody) : null;
        const sent = relayPhotoId ? await this.call('sendPhoto', { chat_id: account.telegram_user_id, message_thread_id: thread,
          photo: relayPhotoId, caption: markdown ?? row.body, parse_mode: markdown ? 'MarkdownV2' : undefined, reply_markup: keyboard })
          : relayDocumentId ? await this.call('sendDocument', { chat_id: account.telegram_user_id, message_thread_id: thread,
            document: relayDocumentId, caption: markdown ?? row.body, parse_mode: markdown ? 'MarkdownV2' : undefined, reply_markup: keyboard })
          : await this.call('sendMessage', { chat_id: account.telegram_user_id, message_thread_id: thread,
            text: markdown ?? row.body, parse_mode: markdown ? 'MarkdownV2' : undefined,
            link_preview_options: { is_disabled: true }, reply_markup: keyboard });
        await db.query("UPDATE bot_outbox SET state='sent',attempts=attempts+1,telegram_message_id=$2 WHERE id=$1", [row.id, sent.message_id]);
      } catch (error) {
        const delay = error instanceof TelegramError ? error.retryAfter : null;
        const retry = delay !== null && row.attempts < 5;
        await db.query("UPDATE bot_outbox SET state=$2,attempts=attempts+1,available_at=now()+($3::int*interval '1 second') WHERE id=$1", [row.id, retry ? 'pending' : 'failed', delay ?? 30]);
        if (!retry) console.error('QUESTR bot delivery failed:', { outboxId: row.id, kind: row.kind, error: error instanceof Error ? error.message : String(error) });
      }
      return true;
    });
  }
  start() {
    void this.call('getMe', {}).then(me => {
      if (!me.has_topics_enabled) console.warn('QUESTR bot: enable private-chat topics in BotFather.');
      if (me.allows_users_to_create_topics) console.warn('QUESTR bot: disallow users to create topics in BotFather so commands stay in the main chat.');
    }).catch(() => console.warn('QUESTR bot: could not verify BotFather topic settings.'));
    const scope = { type: 'all_private_chats' };
    void Promise.all([
      this.call('setMyCommands', { scope, commands: [
        { command: 'chats', description: 'Adventures and party topics' },
        { command: 'people', description: 'People you can message' },
        { command: 'help', description: 'How QUESTR chat works' },
      ] }),
      this.call('setMyCommands', { scope, language_code: 'ru', commands: [
        { command: 'chats', description: 'Вылазки и темы групп' },
        { command: 'people', description: 'Люди, которым можно написать' },
        { command: 'help', description: 'Как работает чат QUESTR' },
      ] }),
    ]).catch(() => console.warn('QUESTR bot: could not update command menu.'));
    let running: Promise<void> | undefined;
    let stopping = false;
    const timer = setInterval(() => {
      if (running) return;
      running = (async () => { for (let i = 0; i < 5 && !stopping; i++) { const due = await this.reminders(); const received = await this.inbox(); const sent = await this.outbox(); if (!due && !received && !sent) break; } })()
        .catch(() => console.error('QUESTR bot queue processing failed')).finally(() => { running = undefined; });
    }, 1000);
    timer.unref();
    return async () => { stopping = true; clearInterval(timer); await running; };
  }
}
