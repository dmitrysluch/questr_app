import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createPool } from '../../server/db.ts';
import { EventBot } from '../../server/event-bot.ts';
import { loadConfig } from '../../server/config.ts';

const connection = process.env.TEST_DATABASE_URL;
test('existing adventure-scoped DMs merge without losing messages or Telegram topic history', { skip: !connection }, async () => {
  const database = `questr_dm_migration_${randomUUID().replaceAll('-', '')}`;
  const admin = createPool(connection!);
  let pool: ReturnType<typeof createPool> | undefined;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    const url = new URL(connection!); url.pathname = `/${database}`;
    pool = createPool(url.toString());
    const dir = fileURLToPath(new URL('../../db/migrations/', import.meta.url));
    for (const name of (await readdir(dir)).filter(name => name.endsWith('.sql') && name < '022_person_direct_messages.sql').sort()) {
      await pool.query(await readFile(resolve(dir, name), 'utf8'));
    }
    const [host, guest] = [randomUUID(), randomUUID()].sort();
    await pool.query("INSERT INTO avatar_presets(id,label_key,asset_key,sort_order) VALUES('moss','moss','moss',0)");
    await pool.query("INSERT INTO languages(code,label) VALUES('en','English')");
    await pool.query("INSERT INTO locations(id,name,kind,search_text) VALUES('online','Online','online','online')");
    await pool.query("INSERT INTO users(id,status) VALUES($1,'active'),($2,'active')", [host, guest]);
    await pool.query("INSERT INTO profiles(user_id,display_name,avatar_preset_id) VALUES($1,'Host','moss'),($2,'Guest','moss')", [host, guest]);
    await pool.query('INSERT INTO telegram_accounts(user_id,telegram_user_id,bot_started_at) VALUES($1,99101,now())', [guest]);
    const events = (await pool.query(`INSERT INTO events(created_by,title,location_id,language_code,starts_at,ends_at,status)
      VALUES($1,'First','online','en',now()+interval '1 day',now()+interval '2 days','published'),
        ($1,'Second','online','en',now()+interval '3 days',now()+interval '4 days','published') RETURNING id`, [host])).rows;
    const first = (await pool.query(`INSERT INTO dm_conversations(event_id,first_user_id,second_user_id,requested_by,status)
      VALUES($1,$2,$3,$3,'accepted') RETURNING id`, [events[0].id, host, guest])).rows[0].id;
    const duplicate = (await pool.query(`INSERT INTO dm_conversations(event_id,first_user_id,second_user_id,requested_by,status)
      VALUES($1,$2,$3,$3,'blocked') RETURNING id`, [events[1].id, host, guest])).rows[0].id;
    await pool.query(`INSERT INTO dm_bot_topics(conversation_id,user_id,thread_id)
      VALUES($1,$3,4001),($2,$3,4002),($1,$4,5001),($2,$4,5002)`, [first, duplicate, guest, host]);
    await pool.query('INSERT INTO bot_updates(update_id) VALUES(99101),(99102)');
    const messages = (await pool.query(`INSERT INTO dm_messages(conversation_id,sender_id,telegram_update_id,body)
      VALUES($1,$3,99101,'First hello'),($2,$3,99102,'Second hello') RETURNING id`, [first, duplicate, guest])).rows;
    await pool.query(`INSERT INTO bot_outbox(dedupe_key,user_id,dm_id,dm_message_id,body,kind,state)
      VALUES('old-relay',$1,$2,$3,'Second hello','dm_relay','sent')`, [host, duplicate, messages[1].id]);
    await pool.query(`INSERT INTO bot_outbox(dedupe_key,user_id,dm_id,body,kind)
      VALUES('old-request',$1,$2,'Request from second adventure','dm_request')`, [host, duplicate]);

    await pool.query(await readFile(resolve(dir, '022_person_direct_messages.sql'), 'utf8'));
    assert.deepEqual((await pool.query('SELECT id,status FROM dm_conversations')).rows, [{ id: first, status: 'blocked' }]);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM dm_messages WHERE conversation_id=$1', [first])).rows[0].n, 2);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM dm_conversation_events WHERE conversation_id=$1', [first])).rows[0].n, 2);
    assert.equal((await pool.query('SELECT conversation_id FROM dm_conversation_aliases WHERE legacy_id=$1', [duplicate])).rows[0].conversation_id, first);
    assert.equal((await pool.query('SELECT thread_id FROM dm_bot_topics WHERE conversation_id=$1 AND user_id=$2', [first, guest])).rows[0].thread_id, '4001');
    assert.equal((await pool.query('SELECT conversation_id FROM dm_topic_redirects WHERE user_id=$1 AND thread_id=4002', [guest])).rows[0].conversation_id, first);
    assert.equal((await pool.query("SELECT dm_id FROM bot_outbox WHERE dedupe_key='old-relay'")).rows[0].dm_id, first);
    assert.equal((await pool.query("SELECT state FROM bot_outbox WHERE dedupe_key='old-request'")).rows[0].state, 'discarded');
    await pool.query('DELETE FROM events WHERE id=$1', [events[0].id]);
    assert.equal((await pool.query('SELECT event_id FROM dm_conversations WHERE id=$1', [first])).rows[0].event_id, null);

    await pool.query('INSERT INTO bot_updates(update_id) VALUES(99103)');
    await pool.query("INSERT INTO bot_inbox(update_id,user_id,text,thread_id) VALUES(99103,$1,'Old topic message',4002)", [guest]);
    const sent: any[] = [];
    const bot = new EventBot(pool, { ...loadConfig(), botToken: 'fake-token', aiMode: 'demo' }, (async (_url: string | URL | Request, options?: RequestInit) => {
      sent.push(JSON.parse(String(options?.body)));
      return Response.json({ ok: true, result: { message_id: 1 } });
    }) as typeof fetch);
    assert.equal(await bot.inbox(), true);
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM dm_messages WHERE telegram_update_id=99103")).rows[0].n, 0);
    assert.equal(await bot.outbox(), true);
    assert.equal(sent[0].message_thread_id, 4002);
    assert.match(sent[0].text, /questr_game\/4001/);
  } finally {
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.end();
  }
});
