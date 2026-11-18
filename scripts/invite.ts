import { randomBytes } from 'node:crypto';
import { createPool } from '../server/db.ts';
import { loadConfig } from '../server/config.ts';
import { migrate } from '../server/migrate.ts';
import { hash } from '../server/auth.ts';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
try {
  await migrate(pool, config.locationCatalogPath, config.communityCatalogPath);
  const code = `QUEST-${randomBytes(16).toString('base64url')}`;
  await pool.query("INSERT INTO invites(token_hash,expires_at) VALUES($1,now()+interval '7 days')", [hash(code)]);
  console.log(`Single-use invitation (expires in 7 days): ${code}`);
} finally { await pool.end(); }
