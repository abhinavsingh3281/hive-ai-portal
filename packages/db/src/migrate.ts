import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { createDb } from './client';

const url = process.env['DATABASE_URL'];
if (!url) {
  console.error('DATABASE_URL must be set to run migrations');
  process.exit(1);
}

const db = createDb(url);
await migrate(db, { migrationsFolder: './drizzle' });
console.log('Migrations applied');
process.exit(0);
