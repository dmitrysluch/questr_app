import type { Pool, PoolClient } from 'pg';
import type { Config } from './config.ts';
import { transaction } from './db.ts';
import { Adventures } from './events.ts';
import { ContentReviewer } from './moderation.ts';
import { AppError } from './errors.ts';
import { can, consumeCapability } from './permissions.ts';
import { queueBot, queuePartyTopic } from './event-notifications.ts';
import { botText } from './bot-copy.ts';
import { ZodError } from 'zod';

class TelegramError extends Error {
  constructor(public retryAfter: number | null, description = 'TELEGRAM_DELIVERY_FAILED') { super(description); }
}
/** Durable, at-most-one active processor per inbox/outbox row. The Bot API has
 * no idempotency keys: ambiguous network failures are kept as failed for review,
 * rather than automatically risking a duplicate delivery. */
export class EventBot {
  private adventures: Adventures;
  constructor(private pool: Pool, private config: Config, private fetcher: typeof fetch = fetch) {
    this.adventures = new Adventures(pool, new ContentReviewer(config));
  }
  private async call(method: string, body: object): Promise<any> {
    let response: Response;
    try { response = await this.fetcher(`https://api.telegram.org/bot${this.config.botToken}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000) }); }
    catch { throw new TelegramError(null); }
    let result: any;
    try { result = await response.json(); } catch { throw new TelegramError(null); }
    if (!response.ok || !result.ok) throw new TelegramError(result.error_code === 429 ? Math.max(1, Math.min(3600, Number(result.parameters?.retry_after) || 30)) : null,
      `${method}: ${result.error_code ?? response.status} ${String(result.description ?? 'Telegram request failed').slice(0, 200)}`);
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
    return topic.message_thread_id as number;
  }
  private async dmTopic(db: PoolClient, userId: string, dmId: string, chatId: string) {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,82))', [`${userId}:${dmId}`]);
    const old = (await db.query('SELECT thread_id FROM dm_bot_topics WHERE user_id=$1 AND conversation_id=$2', [userId, dmId])).rows[0];
    if (old) return Number(old.thread_id);
    const other = (await db.query(`SELECT p.display_name,e.title FROM dm_conversations c
      JOIN profiles p ON p.user_id=CASE WHEN c.first_user_id=$1 THEN c.second_user_id ELSE c.first_user_id END
      JOIN events e ON e.id=c.event_id WHERE c.id=$2 AND $1 IN (c.first_user_id,c.second_user_id)`, [userId, dmId])).rows[0];
    if (!other) throw new AppError(403, 'PERMISSION_DENIED');
    const topic = await this.call('createForumTopic', { chat_id: chatId, name: `${other.display_name} · ${other.title}`.slice(0, 110) });
    if (!Number.isSafeInteger(topic?.message_thread_id)) throw new TelegramError(null);
    await db.query('INSERT INTO dm_bot_topics(user_id,conversation_id,thread_id) VALUES($1,$2,$3)', [userId, dmId, topic.message_thread_id]);
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
    const rows = (await db.query(`SELECT * FROM dm_conversations WHERE $1 IN (first_user_id,second_user_id)
      AND replace(id::text,'-','') LIKE $2 LIMIT 2`, [userId, `${code.toLowerCase()}%`])).rows;
    return rows.length === 1 ? rows[0] : null;
  }
  private async command(db: PoolClient, row: any, locale: string): Promise<boolean> {
    const parts = row.text.trim().split(/\s+/);
    let command = parts[0].toLowerCase().replace(/@questr_game$/, '');
    const deepLink = command === '/start' && parts.length === 2 ? /^dm_([a-f0-9]{8})_([a-f0-9]{8})$/i.exec(parts[1]) : null;
    if (deepLink) { command = '/dm'; parts.splice(1, 1, deepLink[1], deepLink[2]); }
    const reply = (body: string) => queueBot(db, { key: `update:${row.update_id}:reply`, userId: row.user_id, body, kind: 'reply' });
    if (command === '/chats' || command === '/start' && parts.length === 1) {
      const events = (await db.query(`SELECT e.id,e.title FROM event_memberships m JOIN events e ON e.id=m.event_id
        WHERE m.user_id=$1 AND m.status='accepted' AND e.status='published' ORDER BY e.starts_at LIMIT 15`, [row.user_id])).rows;
      const available = [];
      for (const event of events) if (await can(db, row.user_id, 'events.group_chat', { type: 'event', id: event.id })) available.push(event);
      if (command === '/start') {
        for (const event of available) {
          if (!(await db.query('SELECT 1 FROM event_bot_topics WHERE event_id=$1 AND user_id=$2', [event.id, row.user_id])).rowCount)
            await queuePartyTopic(db, event.id, row.user_id, event.title, this.config.aiMode);
        }
        await db.query("UPDATE bot_outbox SET available_at=now() WHERE user_id=$1 AND kind='topic_init' AND state='pending'", [row.user_id]);
      }
      const eventList = available.map(e => `${e.title.slice(0, 80)} — ${e.id.replaceAll('-', '').slice(0, 8)}`).join('\n');
      const dms = (await db.query(`SELECT c.id,c.event_id,p.display_name,p.user_id AS other_id FROM dm_conversations c
        JOIN profiles p ON p.user_id=CASE WHEN c.first_user_id=$1 THEN c.second_user_id ELSE c.first_user_id END
        WHERE $1 IN (c.first_user_id,c.second_user_id) AND c.status='accepted' ORDER BY c.updated_at DESC LIMIT 15`, [row.user_id])).rows;
      const dmList = [];
      for (const dm of dms) if (await can(db, row.user_id, 'dm.message', { type: 'profile', id: dm.other_id, eventId: dm.event_id })) dmList.push(`${dm.display_name} [${dm.id.replaceAll('-', '').slice(0, 8)}] — /dm ${dm.event_id.replaceAll('-', '').slice(0, 8)} ${dm.other_id.replaceAll('-', '').slice(0, 8)}`);
      await reply(`${eventList ? botText(locale, 'chatsList', { items: eventList }) : botText(locale, 'chatsEmpty')}${dmList.length ? `\n\n${botText(locale, 'dmList', { items: dmList.join('\n') })}` : ''}`);
      return true;
    }
    if (command === '/chat' && parts.length === 2) {
      const event = await this.eventByCode(db, row.user_id, parts[1]);
      if (!event) { await reply(botText(locale, 'chatNotFound')); return true; }
      const topic = (await db.query('SELECT thread_id FROM event_bot_topics WHERE event_id=$1 AND user_id=$2', [event.id, row.user_id])).rows[0];
      if (!topic) await queuePartyTopic(db, event.id, row.user_id, event.title, this.config.aiMode);
      await reply(botText(locale, topic ? 'topicReady' : 'topicPreparing', { title: event.title, link: topic ? `https://t.me/questr_game/${topic.thread_id}` : '' }));
      return true;
    }
    if (command === '/people' && parts.length === 2) {
      const event = await this.eventByCode(db, row.user_id, parts[1]);
      if (!event) { await reply(botText(locale, 'chatNotFound')); return true; }
      const people = (await db.query(`SELECT p.user_id,p.display_name FROM event_memberships m JOIN profiles p ON p.user_id=m.user_id
        JOIN users u ON u.id=m.user_id JOIN telegram_accounts t ON t.user_id=m.user_id AND t.bot_started_at IS NOT NULL
        WHERE m.event_id=$1 AND m.status='accepted' AND m.user_id<>$2 AND u.status='active' ORDER BY p.display_name LIMIT 20`, [event.id, row.user_id])).rows;
      const permitted = [];
      for (const person of people) if (await can(db, row.user_id, 'dm.send_opener', { type: 'profile', id: person.user_id, eventId: event.id }) || await can(db, row.user_id, 'dm.message', { type: 'profile', id: person.user_id, eventId: event.id })) permitted.push(`${person.display_name.slice(0, 80)} — ${person.user_id.replaceAll('-', '').slice(0, 8)}`);
      await reply(permitted.length ? botText(locale, 'peopleList', { title: event.title, items: permitted.join('\n') }) : botText(locale, 'peopleEmpty'));
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
      let dm = (await db.query('SELECT * FROM dm_conversations WHERE event_id=$1 AND first_user_id=$2 AND second_user_id=$3', [event.id, ...pair])).rows[0];
      const capability = dm?.status === 'accepted' ? 'dm.message' : 'dm.send_opener';
      if (dm?.status === 'declined' || dm?.status === 'blocked' || dm?.status === 'pending' && dm.requested_by !== row.user_id || dm?.status !== 'pending' && !await can(db, row.user_id, capability, { type: 'profile', id: person.user_id, eventId: event.id })) { await reply(botText(locale, 'dmUnavailable')); return true; }
      if (!dm) dm = (await db.query(`INSERT INTO dm_conversations(event_id,first_user_id,second_user_id,requested_by)
        VALUES($1,$2,$3,$4) ON CONFLICT(event_id,first_user_id,second_user_id) DO UPDATE SET updated_at=dm_conversations.updated_at RETURNING *`, [event.id, ...pair, row.user_id])).rows[0];
      const topic = (await db.query('SELECT thread_id FROM dm_bot_topics WHERE conversation_id=$1 AND user_id=$2', [dm.id, row.user_id])).rows[0];
      if (!topic && ['draft', 'accepted'].includes(dm.status)) await queueBot(db, { key: `dm:${dm.id}:topic:${row.user_id}`, userId: row.user_id, dmId: dm.id, kind: 'reply', inTopic: true,
        body: botText(locale, dm.status === 'accepted' ? 'dmAccepted' : 'dmStart', { name: person.display_name, title: event.title, code: dm.id.replaceAll('-', '').slice(0, 8) }) });
      await reply(botText(locale, dm.status === 'pending' ? 'dmWaiting' : topic ? 'dmTopicReady' : 'dmTopicPreparing', { name: person.display_name, link: topic ? `https://t.me/questr_game/${topic.thread_id}` : '' }));
      return true;
    }
    if (['/accept', '/decline', '/block'].includes(command) && parts.length === 2) {
      const dm = await this.dmByCode(db, row.user_id, parts[1]);
      if (!dm || command !== '/block' && (dm.status !== 'pending' || dm.requested_by === row.user_id) || command === '/block' && dm.status !== 'accepted') { await reply(botText(locale, 'dmNoRequest')); return true; }
      const other = dm.first_user_id === row.user_id ? dm.second_user_id : dm.first_user_id;
      if (command === '/accept') {
        if (!await can(db, row.user_id, 'events.group_chat', { type: 'event', id: dm.event_id }) || !await can(db, other, 'events.group_chat', { type: 'event', id: dm.event_id })) { await reply(botText(locale, 'dmUnavailable')); return true; }
        await db.query('SAVEPOINT dm_consent');
        await db.query("UPDATE dm_conversations SET status='accepted',updated_at=now() WHERE id=$1", [dm.id]);
        if (!await can(db, row.user_id, 'dm.message', { type: 'profile', id: other, eventId: dm.event_id }) || !await can(db, other, 'dm.message', { type: 'profile', id: row.user_id, eventId: dm.event_id })) { await db.query('ROLLBACK TO SAVEPOINT dm_consent'); await reply(botText(locale, 'dmUnavailable')); return true; }
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
    const mapped = (await db.query('SELECT conversation_id FROM dm_bot_topics WHERE user_id=$1 AND thread_id=$2', [row.user_id, row.thread_id])).rows[0];
    if (!mapped) return false;
    const dm = (await db.query('SELECT * FROM dm_conversations WHERE id=$1 FOR UPDATE', [mapped.conversation_id])).rows[0];
    const other = dm.first_user_id === row.user_id ? dm.second_user_id : dm.first_user_id;
    const reply = (body: string) => queueBot(db, { key: `update:${row.update_id}:reply`, userId: row.user_id, dmId: dm.id, body, kind: 'reply', inTopic: true });
    if (row.text.length > 3000) throw new AppError(400, 'MESSAGE_TOO_LONG');
    if (dm.status === 'pending') { await reply(botText(locale, 'dmWaiting')); return true; }
    if (dm.status !== 'draft' && dm.status !== 'accepted') { await reply(botText(locale, 'dmUnavailable')); return true; }
    if (dm.status === 'draft' && (dm.requested_by !== row.user_id || !await can(db, row.user_id, 'dm.send_opener', { type: 'profile', id: other, eventId: dm.event_id })) || dm.status === 'accepted' && !await can(db, row.user_id, 'dm.message', { type: 'profile', id: other, eventId: dm.event_id })) { await reply(botText(locale, 'dmUnavailable')); return true; }
    await this.adventures.review(row.text);
    if (dm.status === 'draft') await consumeCapability(db, row.user_id, 'dm.send_opener', { type: 'profile', id: other, eventId: dm.event_id }, dm.id);
    const message = (await db.query('INSERT INTO dm_messages(conversation_id,sender_id,telegram_update_id,body) VALUES($1,$2,$3,$4) ON CONFLICT(telegram_update_id) DO NOTHING RETURNING id', [dm.id, row.user_id, row.update_id, row.text])).rows[0];
    if (!message) return true;
    const name = (await db.query('SELECT display_name FROM profiles WHERE user_id=$1', [row.user_id])).rows[0].display_name;
    if (dm.status === 'draft') {
      await db.query("UPDATE dm_conversations SET status='pending',updated_at=now() WHERE id=$1", [dm.id]);
      const title = (await db.query('SELECT title FROM events WHERE id=$1', [dm.event_id])).rows[0].title;
      const targetLocale = (await db.query('SELECT locale FROM users WHERE id=$1', [other])).rows[0].locale;
      await queueBot(db, { key: `dm:${dm.id}:request`, userId: other, dmId: dm.id, kind: 'dm_request', body: botText(targetLocale, 'dmRequested', { name, title, message: row.text, code: dm.id.replaceAll('-', '').slice(0, 8) }) });
      await reply(botText(locale, 'dmWaiting'));
    } else {
      await queueBot(db, { key: `dm:message:${message.id}`, userId: other, dmId: dm.id, dmMessageId: message.id, kind: 'dm_relay', inTopic: true, body: `${name}:\n${row.text}` });
    }
    return true;
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
      const url = this.config.publicAppUrl;
      const open = url.startsWith('https://') ? [{ text: botText(locale, 'openButton'), web_app: { url: `${url.split('#')[0]}#adventures/${eventId}` } }] : [];
      try { await this.call('editMessageReplyMarkup', { chat_id: (await db.query('SELECT telegram_user_id FROM telegram_accounts WHERE user_id=$1', [row.user_id])).rows[0].telegram_user_id,
        message_id: row.callback_message_id, reply_markup: { inline_keyboard: open.length ? [open] : [] } }); } catch { /* A stale button is harmless: every press rechecks membership. */ }
    }
  }
  async inbox(): Promise<boolean> {
    return transaction(this.pool, async db => {
      const row = (await db.query("SELECT * FROM bot_inbox WHERE state='pending' AND available_at<=now() ORDER BY update_id LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];
      if (!row) return false;
      const reply = (body: string, eventId?: string) => queueBot(db, { key: `update:${row.update_id}:reply`, userId: row.user_id, eventId, body, kind: 'reply', inTopic: !!eventId });
      const replyInOrigin = async (body: string) => {
        if (row.thread_id) {
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
        if (row.callback_query_id) await this.applicationCallback(db, row, locale);
        else if (user?.status !== 'active') { await reply(botText(locale, 'finishCharacter')); }
        else if (/^\/start(?:@questr_game)? quest_[a-f0-9]{32}$/.test(row.text)) {
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
        } else if (await this.command(db, row, locale)) {
          // Command replies are queued by the command handler.
        } else if (row.thread_id && !row.text.startsWith('/')) {
          if (await this.dmText(db, row, locale)) {
            // A private topic has its own consent and delivery rules.
          } else {
          const mapping = (await db.query('SELECT event_id FROM event_bot_topics WHERE user_id=$1 AND thread_id=$2', [row.user_id, row.thread_id])).rows[0];
          if (!mapping) await reply(botText(locale, 'chooseTopic'));
          else {
            const event = await this.adventures.detail(row.user_id, mapping.event_id);
            if (event.canChat) {
              if (row.text.length > 3000) throw new AppError(400, 'MESSAGE_TOO_LONG');
              await this.adventures.review(row.text);
              await transaction(this.pool, async sendDb => {
                await sendDb.query('SELECT id FROM events WHERE id=$1 FOR SHARE', [event.id]);
                if (!await can(sendDb, row.user_id, 'events.group_chat', { type: 'event', id: event.id })) throw new AppError(403, 'PERMISSION_DENIED');
                const message = (await sendDb.query('INSERT INTO event_messages(event_id,sender_id,telegram_update_id,body) VALUES($1,$2,$3,$4) ON CONFLICT(telegram_update_id) DO NOTHING RETURNING id', [event.id, row.user_id, row.update_id, row.text])).rows[0];
                if (!message) return;
                const name = (await sendDb.query('SELECT display_name FROM profiles WHERE user_id=$1', [row.user_id])).rows[0].display_name;
                const recipients = (await sendDb.query("SELECT user_id FROM event_memberships WHERE event_id=$1 AND status='accepted' AND user_id<>$2", [event.id, row.user_id])).rows;
                for (const recipient of recipients) await queueBot(sendDb, { key: `message:${message.id}:${recipient.user_id}`, userId: recipient.user_id, eventId: event.id, messageId: message.id, kind: 'relay', inTopic: true, body: `${name}:\n${row.text}` });
              });
            } else await reply(botText(locale, event.myStatus === 'pending' ? 'alreadyPending' : 'chatClosed'), event.id);
          }
          }
        } else await reply(botText(locale, 'botHelp'));
        await db.query("UPDATE bot_inbox SET state='done',attempts=attempts+1 WHERE update_id=$1", [row.update_id]);
      } catch (error) {
        await db.query('ROLLBACK TO SAVEPOINT process_bot_update');
        if (error instanceof ZodError || (error instanceof AppError && error.status < 500)) {
          const message = botText(locale, error instanceof ZodError ? 'applicationLength' : error.code === 'EVENT_CONTENT_REQUIRES_CHANGES' ? 'explicitContent' : error.code === 'APPLICATION_LINK_NOT_ALLOWED' ? 'noLinks' : error.code === 'MESSAGE_TOO_LONG' ? 'messageLength' : 'unavailable');
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
        const owner = (await db.query("SELECT 1 FROM events e JOIN users u ON u.id=e.created_by WHERE e.id=$1 AND u.status='active'", [row.event_id])).rowCount;
        allowed = allowed && !!owner;
      }
      if (allowed && row.kind === 'relay') {
        const message = (await db.query('SELECT sender_id FROM event_messages WHERE id=$1', [row.message_id])).rows[0];
        allowed = !!message && await can(db, row.user_id, 'events.group_chat', { type: 'event', id: row.event_id }) && await can(db, message.sender_id, 'events.group_chat', { type: 'event', id: row.event_id });
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
      let dmEventId: string | null = null;
      if (allowed && row.dm_id) {
        const dm = (await db.query('SELECT * FROM dm_conversations WHERE id=$1', [row.dm_id])).rows[0];
        allowed = !!dm && [dm.first_user_id, dm.second_user_id].includes(row.user_id);
        if (allowed) {
          await db.query('SELECT id FROM events WHERE id=$1 FOR SHARE', [dm.event_id]);
          dmEventId = dm.event_id;
          const other = dm.first_user_id === row.user_id ? dm.second_user_id : dm.first_user_id;
          if (row.kind === 'dm_request') allowed = dm.status === 'pending' && dm.requested_by !== row.user_id
            && await can(db, dm.requested_by, 'events.group_chat', { type: 'event', id: dm.event_id })
            && await can(db, row.user_id, 'events.group_chat', { type: 'event', id: dm.event_id });
          if (row.kind === 'dm_accept') allowed = dm.status === 'accepted'
            && await can(db, row.user_id, 'dm.message', { type: 'profile', id: other, eventId: dm.event_id })
            && await can(db, other, 'dm.message', { type: 'profile', id: row.user_id, eventId: dm.event_id });
          if (row.kind === 'dm_relay') {
            const message = (await db.query('SELECT sender_id FROM dm_messages WHERE id=$1 AND conversation_id=$2', [row.dm_message_id, row.dm_id])).rows[0];
            allowed = dm.status === 'accepted' && !!message && message.sender_id === other
              && await can(db, row.user_id, 'dm.message', { type: 'profile', id: other, eventId: dm.event_id })
              && await can(db, other, 'dm.message', { type: 'profile', id: row.user_id, eventId: dm.event_id });
          }
          // A reply may explain why a closed topic no longer accepts messages.
        }
      }
      if (!allowed) { await db.query("UPDATE bot_outbox SET state='discarded' WHERE id=$1", [row.id]); return true; }
      try {
        const thread = row.in_topic && row.dm_id ? await this.dmTopic(db, row.user_id, row.dm_id, account.telegram_user_id)
          : row.in_topic && row.event_id ? await this.topic(db, row.user_id, row.event_id, account.telegram_user_id) : undefined;
        const url = this.config.publicAppUrl;
        const openButton = url && url.startsWith('https://') ? { text: botText(account.locale, 'openButton'), web_app: { url: `${url.split('#')[0]}${row.event_id || dmEventId ? `#adventures/${row.event_id || dmEventId}` : ''}` } } : null;
        const keyboard = row.kind === 'application' ? { inline_keyboard: [
          [{ text: botText(account.locale, 'acceptButton'), callback_data: `application:accept:${row.id}` }, { text: botText(account.locale, 'declineButton'), callback_data: `application:decline:${row.id}` }],
          ...(openButton ? [[openButton]] : []),
        ] } : openButton ? { inline_keyboard: [[openButton]] } : undefined;
        const sent = await this.call('sendMessage', { chat_id: account.telegram_user_id, message_thread_id: thread, text: row.body, link_preview_options: { is_disabled: true }, reply_markup: keyboard });
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
