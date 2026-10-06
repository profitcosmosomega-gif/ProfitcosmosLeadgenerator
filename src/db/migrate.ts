import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { installQueueSchema } from '../lib/queue';

export const MIGRATIONS_FOLDER = path.resolve(import.meta.dirname, 'migrations');

/** Apply Drizzle migrations and install the job-queue schema. Idempotent. */
export async function runMigrations(connectionString: string): Promise<void> {
  const pool = new Pool({ connectionString, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
  await installQueueSchema(connectionString);
}
