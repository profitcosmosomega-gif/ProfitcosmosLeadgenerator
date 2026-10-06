import { Client } from 'pg';
import { runMigrations } from '../src/db/migrate';
import { QUEUE_SCHEMA } from '../src/lib/queue';
import { TEST_ENV } from './test-env';

/** Recreate the test database schema from migrations once per test run. */
export default async function setup(): Promise<void> {
  const url = TEST_ENV.DATABASE_URL;
  if (!/test/.test(new URL(url).pathname)) {
    throw new Error(`Refusing to reset non-test database: ${new URL(url).pathname}`);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`
      drop schema if exists public cascade;
      drop schema if exists drizzle cascade;
      drop schema if exists ${QUEUE_SCHEMA} cascade;
      create schema public;
    `);
  } finally {
    await client.end();
  }
  await runMigrations(url);
}
