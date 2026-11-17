import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createPool, transaction, type Pool } from './db.ts';
import { loadConfig } from './config.ts';
import { avatars, tags } from '../shared/catalog.ts';
import languageData from '../shared/languages.json';
import locationData from './data/locations.json';
import { normalizeSearch } from '../shared/discovery.ts';
import { communities, communityAncestors } from '../shared/communities.ts';

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
    await client.query(`INSERT INTO languages(code,label) SELECT code,label FROM jsonb_to_recordset($1) AS x(code text,label text)
      ON CONFLICT(code) DO UPDATE SET label=EXCLUDED.label`, [JSON.stringify(languageData)]);
    const existingCommunities = (await client.query('SELECT id,parent_id FROM communities')).rows;
    for (const existing of existingCommunities) {
      const configured = communities.find(community => community.id === existing.id);
      if (!configured || configured.parentId !== existing.parent_id) throw new Error(`Community ${existing.id} needs an explicit migration before removal or reparenting`);
    }
    for (const community of communities) await client.query(`INSERT INTO communities(id,parent_id,name_en,name_ru) VALUES($1,$2,$3,$4)
      ON CONFLICT(id) DO UPDATE SET name_en=EXCLUDED.name_en,name_ru=EXCLUDED.name_ru`,
    [community.id, community.parentId, community.name.en, community.name.ru]);
    await client.query('DELETE FROM community_closure');
    for (const community of communities) for (const [depth, ancestor] of communityAncestors(community.id).entries()) {
      await client.query('INSERT INTO community_closure(ancestor_id,descendant_id,depth) VALUES($1,$2,$3)', [ancestor, community.id, depth]);
    }
    // Countries first so every city's parent already exists. Batched, offline seed.
    for (const cities of [false, true]) {
      const rows = locationData.filter(location => (location.kind === 'city') === cities).map(location => {
        let aliases = '';
        if (location.kind === 'country') for (const locale of ['en', 'ru', 'he', 'ar']) {
          aliases += new Intl.DisplayNames([locale], { type: 'region' }).of(location.id.slice(8)) ?? '';
        }
        return { ...location, search: location.search + normalizeSearch(aliases) };
      });
      await client.query(`INSERT INTO locations(id,name,kind,parent_id,population,search_text)
        SELECT id,name,kind,"parentId",population,search FROM jsonb_to_recordset($1) AS x(id text,name text,kind text,"parentId" text,population bigint,search text)
        ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,population=EXCLUDED.population,search_text=EXCLUDED.search_text`, [JSON.stringify(rows)]);
    }
    for (const [i, avatar] of avatars.entries()) {
      await client.query('INSERT INTO avatar_presets(id,label_key,asset_key,sort_order) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING', [avatar.id, `avatars.${avatar.id}`, avatar.asset, i]);
    }
    const catalog = JSON.stringify(tags.map((tag, sortOrder) => ({ code: tag.code, emoji: tag.emoji, sortOrder, label: tag.label })));
    await client.query(`INSERT INTO tags(code,emoji,sort_order)
      SELECT code,emoji,"sortOrder" FROM jsonb_to_recordset($1::jsonb) AS x(code text,emoji text,"sortOrder" integer,label text)
      ON CONFLICT(code) DO UPDATE SET emoji=EXCLUDED.emoji,sort_order=EXCLUDED.sort_order`, [catalog]);
    await client.query(`INSERT INTO tag_translations(tag_id,locale,label)
      SELECT code,'en',label FROM jsonb_to_recordset($1::jsonb) AS x(code text,emoji text,"sortOrder" integer,label text)
      ON CONFLICT(tag_id,locale) DO UPDATE SET label=EXCLUDED.label`, [catalog]);
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const pool = createPool(loadConfig().databaseUrl);
  try { await migrate(pool); console.log('QUESTR database is up to date.'); }
  finally { await pool.end(); }
}
