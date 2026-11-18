import { loadConfig } from './config.ts';
import { createPool } from './db.ts';
import { migrate } from './migrate.ts';
import { createApp } from './app.ts';
import { EventBot } from './event-bot.ts';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool, config.locationCatalogPath);
const server = createApp(pool, config).listen(config.port, '0.0.0.0', () => {
  console.log(`QUESTR API: http://localhost:${config.port} (auth: ${config.authMode}, assistant: ${config.aiMode})`);
});
server.on('error', error => { console.error('QUESTR could not start:', error.message); void pool.end().then(() => process.exit(1)); });
const stopBot = config.authMode === 'telegram' && config.webhookSecret ? new EventBot(pool, config).start() : async () => {};
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => { void stopBot().then(() => pool.end()).then(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 30000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
