import type { PoolClient } from 'pg';
import { preferredLocale, type Locale } from '../shared/locale.ts';
import { botText } from './bot-copy.ts';

export async function recipientLocale(db: PoolClient, userId: string): Promise<Locale> {
  const row = (await db.query('SELECT locale FROM users WHERE id=$1', [userId])).rows[0];
  return preferredLocale(row?.locale);
}
export type BotButton = { text: string; callback_data: string } | { text: string; url: string };
export type BotKeyboard = { inline_keyboard: BotButton[][] };
export async function queueBot(db: PoolClient, input: { key: string; userId: string; eventId?: string; messageId?: string; dmId?: string; dmMessageId?: string; applicationUserId?: string; applicationAttemptId?: string; body: string; kind?: 'notification' | 'reply' | 'relay' | 'reminder' | 'dm_request' | 'dm_relay' | 'dm_accept' | 'application' | 'topic_init'; inTopic?: boolean; keyboard?: BotKeyboard }) {
  await db.query(`INSERT INTO bot_outbox(dedupe_key,user_id,event_id,message_id,dm_id,dm_message_id,application_user_id,application_attempt_id,body,kind,in_topic,reply_markup)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(dedupe_key) DO NOTHING`,
  [input.key, input.userId, input.eventId ?? null, input.messageId ?? null, input.dmId ?? null, input.dmMessageId ?? null, input.applicationUserId ?? null, input.applicationAttemptId ?? null, input.body, input.kind ?? 'notification', input.inTopic ?? false, input.keyboard ? JSON.stringify(input.keyboard) : null]);
}
export async function queuePartyTopic(db: PoolClient, eventId: string, userId: string, title: string, aiMode: 'demo' | 'openrouter') {
  const locale = await recipientLocale(db, userId);
  await queueBot(db, { key: `event:${eventId}:topic:${userId}`, userId, eventId, kind: 'topic_init', inTopic: true,
    body: botText(locale, aiMode === 'openrouter' ? 'topicChatLive' : 'topicChatDemo', { title }) });
}
export async function notifyMembers(db: PoolClient, eventId: string, key: string, body: string | ((locale: Locale) => string), except?: string) {
  const { rows } = await db.query("SELECT m.user_id,u.locale FROM event_memberships m JOIN users u ON u.id=m.user_id WHERE m.event_id=$1 AND m.status IN ('accepted','pending') AND ($2::uuid IS NULL OR m.user_id<>$2)", [eventId, except ?? null]);
  for (const row of rows) await queueBot(db, { key: `${key}:${row.user_id}`, userId: row.user_id, eventId, body: typeof body === 'string' ? body : body(preferredLocale(row.locale)) });
}
