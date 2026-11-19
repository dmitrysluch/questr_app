import { loadConfig } from './config.ts';
import { createPool } from './db.ts';
import { migrate } from './migrate.ts';
import { createApp } from './app.ts';
import { EventBot } from './event-bot.ts';
import { OperationalMetrics } from './metrics.ts';
import { cleanupDatePhotoDeletions, s3DatePhotoStorage } from './date-photo-storage.ts';
import { expireDateRounds } from './dates.ts';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
await migrate(pool, config.locationCatalogPath, config.communityCatalogPath);
const metrics = config.metricsPath ? new OperationalMetrics(pool) : undefined;
const datePhotoStorage = s3DatePhotoStorage(config);
const photoCleanup = setInterval(() => { void cleanupDatePhotoDeletions(pool, datePhotoStorage).catch(error => console.error('QUESTR date photo cleanup failed:', error)); }, 600000);
photoCleanup.unref();
void cleanupDatePhotoDeletions(pool, datePhotoStorage).catch(error => console.error('QUESTR date photo cleanup failed:', error));
const dateExpiry = setInterval(() => { void expireDateRounds(pool, config).catch(error => console.error('QUESTR date expiry failed:', error)); }, 600000);
dateExpiry.unref();
void expireDateRounds(pool, config).catch(error => console.error('QUESTR date expiry failed:', error));
const server = createApp(pool, config, undefined, undefined, undefined, metrics, datePhotoStorage).listen(config.port, '0.0.0.0', () => {
  console.log(`QUESTR API: http://localhost:${config.port} (auth: ${config.authMode}, assistant: ${config.aiMode})`);
});
server.on('error', error => { console.error('QUESTR could not start:', error.message); void pool.end().then(() => process.exit(1)); });
const stopBot = config.authMode === 'telegram' && config.webhookSecret ? new EventBot(pool, config, fetch, metrics).start() : async () => {};
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => { void stopBot().then(() => pool.end()).then(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 30000).unref();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
