import { createPool, transaction } from '../server/db.ts';
import { loadConfig } from '../server/config.ts';
import { migrate } from '../server/migrate.ts';

const [kind, value] = process.argv.slice(2);
if (!['--name', '--user-id'].includes(kind ?? '') || !value || process.argv.length !== 4) {
  console.error('Usage: npm run admin:grant -- --name <exact display name> | --user-id <uuid>');
  process.exit(2);
}
const config = loadConfig();
const pool = createPool(config.databaseUrl);
try {
  await migrate(pool, config.locationCatalogPath, config.communityCatalogPath);
  const users = kind === '--name'
    ? (await pool.query(`SELECT u.id FROM users u JOIN profiles p ON p.user_id=u.id
        WHERE u.status='active' AND lower(p.display_name)=lower($1)`, [value])).rows
    : (await pool.query("SELECT id FROM users WHERE id=$1 AND status='active'", [value])).rows;
  if (users.length !== 1) throw new Error(`Expected one active character; found ${users.length}. Use --user-id if the name is ambiguous.`);
  const userId = users[0].id as string;
  await transaction(pool, async db => {
    const exists = await db.query("SELECT 1 FROM role_assignments WHERE user_id=$1 AND role_code='admin' AND revoked_at IS NULL AND valid_from<=now() AND (valid_until IS NULL OR valid_until>now())", [userId]);
    if (exists.rowCount) return;
    await db.query("INSERT INTO role_assignments(user_id,role_code,reason) VALUES($1,'admin','Local operator bootstrap')", [userId]);
    await db.query("INSERT INTO permission_audit(user_id,action,details,reason) VALUES($1,'role.granted','{\"role\":\"admin\"}','Local operator bootstrap')", [userId]);
  });
  console.log('Admin access granted.');
} finally { await pool.end(); }
