import type { Pool, PoolClient } from 'pg';
import type { Config } from './config.ts';
import { transaction } from './db.ts';
import { Adventures } from './events.ts';
import { ContentReviewer } from './moderation.ts';
import { AppError } from './errors.ts';
import { can } from './permissions.ts';
import { queueBot } from './event-notifications.ts';
import { ZodError } from 'zod';

class TelegramError extends Error {
  constructor(public retryAfter: number | null) { super('TELEGRAM_DELIVERY_FAILED'); }
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
    if (!response.ok || !result.ok) throw new TelegramError(result.error_code === 429 ? Math.max(1, Math.min(3600, Number(result.parameters?.retry_after) || 30)) : null);
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
  async inbox(): Promise<boolean> {
    return transaction(this.pool, async db => {
      const row = (await db.query("SELECT * FROM bot_inbox WHERE state='pending' AND available_at<=now() ORDER BY update_id LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];
      if (!row) return false;
      const reply = (body: string, eventId?: string) => queueBot(db, { key: `update:${row.update_id}:reply`, userId: row.user_id, eventId, body, kind: 'reply', inTopic: !!eventId });
      try {
        const user = (await db.query("SELECT status FROM users WHERE id=$1", [row.user_id])).rows[0];
        if (user?.status !== 'active') { await reply('Open QUESTR and finish your character before joining an adventure.'); }
        else if (/^\/start(?:@questr_game)? quest_[a-f0-9]{32}$/.test(row.text)) {
          const raw = row.text.split('quest_')[1];
          const eventId = `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
          const event = await this.adventures.detail(row.user_id, eventId);
          if (event.canChat) await reply(`${event.title}\n\nMessages in this topic go to the accepted party under your QUESTR name. ${this.config.aiMode === 'openrouter' ? 'Your messages are sent through OpenRouter to check for explicit sexual content before delivery. ' : 'This local demo uses a limited content check. '}Open QUESTR for meeting details.`, eventId);
          else if (event.myStatus === 'pending') await reply(`${event.title}\n\nYour application is waiting for the host.`, eventId);
          else if (event.canApply) await reply(`${event.title}\n\nWrite a short message to the host in this topic to apply (3–2000 characters). ${this.config.aiMode === 'openrouter' ? 'Your application is sent through OpenRouter to check for explicit sexual content before the host can read it.' : 'This local demo uses a limited content check without an AI provider.'}`, eventId);
          else await reply('This adventure is not accepting applications.');
        } else if (row.thread_id && !row.text.startsWith('/')) {
          const mapping = (await db.query('SELECT event_id FROM event_bot_topics WHERE user_id=$1 AND thread_id=$2', [row.user_id, row.thread_id])).rows[0];
          if (!mapping) await reply('Open an adventure in QUESTR and use its bot button to choose a topic.');
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
            } else if (event.canApply) {
              await this.adventures.apply(row.user_id, event.id, { message: row.text });
              await reply('Application sent. The host will review your character and message.', event.id);
            } else await reply(event.myStatus === 'pending' ? 'Your application is already waiting for the host.' : 'This party chat is closed to you.', event.id);
          }
        } else await reply('Open an adventure in QUESTR, then use “Apply in bot” or “Open party chat”. Each adventure has its own private topic here.');
        await db.query("UPDATE bot_inbox SET state='done',attempts=attempts+1 WHERE update_id=$1", [row.update_id]);
      } catch (error) {
        if (error instanceof ZodError || (error instanceof AppError && error.status < 500)) {
          const message = error instanceof ZodError ? 'Please write an application of 3–2000 characters.' : error.code === 'EVENT_CONTENT_REQUIRES_CHANGES' ? 'Please keep explicit sexual content out of QUESTR messages. Try a message about the adventure instead.' : error.code === 'MESSAGE_TOO_LONG' ? 'Please keep each message under 3000 characters.' : 'This action is unavailable. Open QUESTR to check the adventure and your application.';
          await reply(message);
          await db.query("UPDATE bot_inbox SET state='done',attempts=attempts+1 WHERE update_id=$1", [row.update_id]);
        } else {
          const terminal = row.attempts >= 2;
          await db.query("UPDATE bot_inbox SET state=$2,attempts=attempts+1,available_at=now()+interval '30 seconds' WHERE update_id=$1", [row.update_id, terminal ? 'failed' : 'pending']);
          if (terminal) await reply('Your message could not be processed. Please try again in a moment.');
        }
      }
      return true;
    });
  }
  async reminders(): Promise<boolean> {
    return transaction(this.pool, async db => {
      const row = (await db.query(`SELECT r.*,e.title,e.starts_at,e.time_zone,e.status FROM event_reminders r JOIN events e ON e.id=r.event_id
        WHERE r.queued_at IS NULL AND e.starts_at-make_interval(mins=>r.minutes_before)<=now()
        ORDER BY e.starts_at LIMIT 1 FOR UPDATE OF r SKIP LOCKED`)).rows[0];
      if (!row) return false;
      if (row.status === 'published' && row.starts_at.getTime() > Date.now() && await can(db, row.user_id, 'events.group_chat', { type: 'event', id: row.event_id })) {
        const localStart = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: row.time_zone }).format(row.starts_at);
        await queueBot(db, { key: `reminder:${row.schedule_id}`, userId: row.user_id, eventId: row.event_id,
          kind: 'reminder', body: `Reminder: ${row.title} starts ${localStart} (${row.time_zone}). Open QUESTR for the latest meeting details.` });
      }
      await db.query('UPDATE event_reminders SET queued_at=now() WHERE event_id=$1 AND user_id=$2', [row.event_id, row.user_id]);
      return true;
    });
  }
  async outbox(): Promise<boolean> {
    return transaction(this.pool, async db => {
      const row = (await db.query("SELECT * FROM bot_outbox WHERE state='pending' AND available_at<=now() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED")).rows[0];
      if (!row) return false;
      const account = (await db.query("SELECT t.telegram_user_id FROM telegram_accounts t JOIN users u ON u.id=t.user_id WHERE t.user_id=$1 AND t.bot_started_at IS NOT NULL AND u.status<>'blocked'", [row.user_id])).rows[0];
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
      if (!allowed) { await db.query("UPDATE bot_outbox SET state='discarded' WHERE id=$1", [row.id]); return true; }
      try {
        const thread = row.in_topic && row.event_id ? await this.topic(db, row.user_id, row.event_id, account.telegram_user_id) : undefined;
        const url = this.config.publicAppUrl;
        const keyboard = url && url.startsWith('https://') ? { inline_keyboard: [[{ text: 'Open QUESTR', web_app: { url: `${url.split('#')[0]}${row.event_id ? `#adventures/${row.event_id}` : ''}` } }]] } : undefined;
        const sent = await this.call('sendMessage', { chat_id: account.telegram_user_id, message_thread_id: thread, text: row.body, link_preview_options: { is_disabled: true }, reply_markup: keyboard });
        await db.query("UPDATE bot_outbox SET state='sent',attempts=attempts+1,telegram_message_id=$2 WHERE id=$1", [row.id, sent.message_id]);
      } catch (error) {
        const delay = error instanceof TelegramError ? error.retryAfter : null;
        await db.query("UPDATE bot_outbox SET state=$2,attempts=attempts+1,available_at=now()+($3::int*interval '1 second') WHERE id=$1", [row.id, delay !== null && row.attempts < 5 ? 'pending' : 'failed', delay ?? 30]);
      }
      return true;
    });
  }
  start() {
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
