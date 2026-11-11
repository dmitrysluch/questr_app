import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createPool, transaction, type Pool } from './db.ts';
import { loadConfig } from './config.ts';
import { avatars, tags } from '../shared/catalog.ts';

export async function migrate(pool: Pool) {
  await transaction(pool, async client => {
    await client.query("SELECT pg_advisory_xact_lock(81720311)");
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const dir = fileURLToPath(new URL('../db/migrations/', import.meta.url));
    for (const name of (await readdir(dir)).filter(n => n.endsWith('.sql')).sort()) {
      if ((await client.query('SELECT 1 FROM schema_migrations WHERE name=$1', [name])).rowCount) continue;
      await client.query(await readFile(resolve(dir, name), 'utf8'));
      await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [name]);
    }
    for (const [i, avatar] of avatars.entries()) {
      await client.query('INSERT INTO avatar_presets(id,label_key,asset_key,sort_order) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING', [avatar.id, `avatars.${avatar.id}`, avatar.asset, i]);
    }
    for (const [i, tag] of tags.entries()) {
      await client.query('INSERT INTO tags(code,emoji,sort_order) VALUES($1,$2,$3) ON CONFLICT(code) DO NOTHING', [tag.code, tag.emoji, i]);
      await client.query('INSERT INTO tag_translations(tag_id,locale,label) VALUES($1,$2,$3) ON CONFLICT(tag_id,locale) DO NOTHING', [tag.code, 'en', tag.label]);
    }
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pool = createPool(loadConfig().databaseUrl);
  try { await migrate(pool); console.log('QUESTR database is up to date.'); }
  finally { await pool.end(); }
}
