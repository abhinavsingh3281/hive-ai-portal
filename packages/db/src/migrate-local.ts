import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = join(__dirname, '../drizzle');

export async function runMigrations(opts?: { databaseUrl?: string; pgliteDir?: string }): Promise<void> {
  const databaseUrl = opts?.databaseUrl ?? process.env['DATABASE_URL'];
  const pgliteDir = opts?.pgliteDir ?? process.env['PGLITE_DIR'] ?? '.aisc/db';

  if (databaseUrl) {
    const { drizzle } = await import('drizzle-orm/postgres-js');
    const { migrate } = await import('drizzle-orm/postgres-js/migrator');
    const postgres = (await import('postgres')).default;

    const client = postgres(databaseUrl, { max: 1 });
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await client.end();
    console.log('[DB] Migrations applied (postgres)');
  } else {
    const { drizzle } = await import('drizzle-orm/pglite');
    const { migrate } = await import('drizzle-orm/pglite/migrator');
    const { PGlite } = await import('@electric-sql/pglite');

    mkdirSync(pgliteDir, { recursive: true });
    const pg = new PGlite(pgliteDir);
    const db = drizzle(pg);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    console.log('[DB] Migrations applied (pglite)');
  }
}
