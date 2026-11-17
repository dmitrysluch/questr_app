import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createPool } from '../../server/db.ts';

const connection = process.env.TEST_DATABASE_URL;
test('old romance opt-ins are disabled without guessing categories or granting new consent', { skip: !connection }, async () => {
  const database = `questr_romance_migration_${randomUUID().replaceAll('-', '')}`;
  const admin = createPool(connection!);
  let pool: ReturnType<typeof createPool> | undefined;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    const url = new URL(connection!); url.pathname = `/${database}`;
    pool = createPool(url.toString());
    const dir = fileURLToPath(new URL('../../db/migrations/', import.meta.url));
    for (const name of (await readdir(dir)).filter(name => name.endsWith('.sql') && name < '023_romance_preferences.sql').sort()) {
      await pool.query(await readFile(resolve(dir, name), 'utf8'));
    }
    const userId = randomUUID();
    await pool.query("INSERT INTO avatar_presets(id,label_key,asset_key,sort_order) VALUES('moss','moss','moss',0)");
    await pool.query("INSERT INTO users(id,status) VALUES($1,'active')", [userId]);
    await pool.query("INSERT INTO profiles(user_id,display_name,avatar_preset_id,open_to_romance) VALUES($1,'Moss','moss',true)", [userId]);
    await pool.query("INSERT INTO profile_drafts(user_id,display_name,avatar_preset_id,open_to_romance) VALUES($1,'Moss','moss',true)", [userId]);
    await pool.query(await readFile(resolve(dir, '023_romance_preferences.sql'), 'utf8'));
    assert.deepEqual((await pool.query('SELECT open_to_romance FROM profiles WHERE user_id=$1', [userId])).rows, [{ open_to_romance: false }]);
    assert.deepEqual((await pool.query('SELECT open_to_romance FROM profile_drafts WHERE user_id=$1', [userId])).rows, [{ open_to_romance: false }]);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM romance_preferences')).rows[0].n, 0);
  } finally {
    await pool?.end();
    await admin.query(`DROP DATABASE IF EXISTS "${database}"`);
    await admin.end();
  }
});
