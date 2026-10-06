import { runMigrations } from '../src/db/migrate';
import { getEnv } from '../src/lib/env';
import { logger } from '../src/lib/logger';

try {
  await runMigrations(getEnv().DATABASE_URL);
  logger.info('migrations applied');
} catch (err) {
  logger.fatal({ err }, 'migration failed');
  process.exitCode = 1;
}
