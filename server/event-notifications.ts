import type { PoolClient } from 'pg';
export async function queueBot(db: PoolClient, input: { key: string; userId: string; eventId?: string; messageId?: string; body: string; kind?: 'notification' | 'reply' | 'relay'; inTopic?: boolean }) {
  await db.query(`INSERT INTO bot_outbox(dedupe_key,user_id,event_id,message_id,body,kind,in_topic)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(dedupe_key) DO NOTHING`,
  [input.key, input.userId, input.eventId ?? null, input.messageId ?? null, input.body, input.kind ?? 'notification', input.inTopic ?? false]);
}
export async function notifyMembers(db: PoolClient, eventId: string, key: string, body: string, except?: string) {
  const { rows } = await db.query("SELECT user_id FROM event_memberships WHERE event_id=$1 AND status IN ('accepted','pending') AND ($2::uuid IS NULL OR user_id<>$2)", [eventId, except ?? null]);
  for (const row of rows) await queueBot(db, { key: `${key}:${row.user_id}`, userId: row.user_id, eventId, body });
}
