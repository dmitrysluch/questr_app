import type { Pool, PoolClient } from 'pg';

// A link to the topic's creation service message can leave some Telegram clients
// in All Messages. A real message inside the topic gives them a concrete target.
export async function dmTopicUrl(db: Pool | PoolClient, userId: string, conversationId: string): Promise<string | null> {
  const { rows } = await db.query(`SELECT t.thread_id,
    (SELECT o.telegram_message_id FROM bot_outbox o
      WHERE o.user_id=t.user_id AND o.dm_id=t.conversation_id AND o.in_topic
        AND o.state='sent' AND o.telegram_message_id IS NOT NULL
        AND (o.target_thread_id IS NULL OR o.target_thread_id=t.thread_id)
        AND (NOT EXISTS(SELECT 1 FROM dm_conversation_aliases a WHERE a.conversation_id=t.conversation_id)
          OR o.created_at >= (SELECT applied_at FROM schema_migrations WHERE name='022_person_direct_messages.sql'))
      ORDER BY o.id DESC LIMIT 1) AS message_id
    FROM dm_bot_topics t WHERE t.user_id=$1 AND t.conversation_id=$2`, [userId, conversationId]);
  const topic = rows[0];
  return topic ? `https://t.me/questr_game/${topic.thread_id}${topic.message_id ? `/${topic.message_id}` : ''}` : null;
}
