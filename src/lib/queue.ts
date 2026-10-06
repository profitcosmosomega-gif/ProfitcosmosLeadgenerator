import { PgBoss } from 'pg-boss';
import { logger } from './logger';

/** Postgres schema that holds pg-boss tables. */
export const QUEUE_SCHEMA = 'pgboss';

export function createBoss(connectionString: string): PgBoss {
  const boss = new PgBoss({ connectionString, schema: QUEUE_SCHEMA });
  boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));
  return boss;
}

/** Install or upgrade the pg-boss schema, then disconnect. Run as part of `db:migrate`. */
export async function installQueueSchema(connectionString: string): Promise<void> {
  const boss = createBoss(connectionString);
  await boss.start();
  await boss.stop({ graceful: false });
}
