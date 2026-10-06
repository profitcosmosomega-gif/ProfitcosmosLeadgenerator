import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getEnv } from '../lib/env';
import { logger } from '../lib/logger';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof schema>;

interface DbState {
  pool: Pool;
  db: Database;
}

// Reuse the pool across Next.js hot reloads in development.
const globalForDb = globalThis as unknown as { __pcDb?: DbState };

function create(): DbState {
  const env = getEnv();
  const pool = new Pool({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX });
  pool.on('error', (err) => logger.error({ err }, 'postgres pool error'));
  return { pool, db: drizzle({ client: pool, schema, casing: 'snake_case' }) };
}

export function getDb(): Database {
  globalForDb.__pcDb ??= create();
  return globalForDb.__pcDb.db;
}

export function getPool(): Pool {
  globalForDb.__pcDb ??= create();
  return globalForDb.__pcDb.pool;
}

export async function closeDb(): Promise<void> {
  const state = globalForDb.__pcDb;
  globalForDb.__pcDb = undefined;
  await state?.pool.end();
}

export { schema };
