import { getDb, runMigrations } from '@aisc/db';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { Scheduler } from './scheduler/heartbeat.js';

const config = loadConfig();
await runMigrations({
  ...(config.DATABASE_URL ? { databaseUrl: config.DATABASE_URL } : {}),
  pgliteDir: config.PGLITE_DIR,
});
const db = await getDb(config.DATABASE_URL);
const app = await buildApp(db, config);

// Scheduler uses the same registry as the app so hot-connected adapters work immediately
const scheduler = new Scheduler(db, config, app.registry);
app.decorate('scheduler', scheduler);
scheduler.start();

const address = await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(`AISC server running at ${address}`);
app.log.info(`API docs: ${address}/docs`);

async function shutdown(signal: string) {
  app.log.info(`Received ${signal}, shutting down`);
  scheduler.stop();
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
