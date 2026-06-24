import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema/index';

export type Db = ReturnType<typeof createDb>;

export function createDb(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 10 });
  return drizzle(client, { schema });
}

// Lazy singleton used by the server process
let _db: Db | undefined;

export async function getDb(databaseUrl?: string): Promise<Db> {
  if (_db) return _db;

  const url = databaseUrl ?? process.env['DATABASE_URL'];

  if (!url) {
    // Zero-config local dev: embedded PGlite (no separate Postgres process needed)
    const { drizzle: drizzlePg } = await import('drizzle-orm/pglite');
    const { PGlite } = await import('@electric-sql/pglite');
    const { mkdirSync } = await import('node:fs');

    const dataDir = process.env['PGLITE_DIR'] ?? '.aisc/db';
    mkdirSync(dataDir, { recursive: true });
    const pg = new PGlite(dataDir);
    _db = drizzlePg(pg, { schema }) as unknown as Db;
  } else {
    _db = createDb(url);
  }

  return _db;
}
