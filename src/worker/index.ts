import { getEnv } from '@/lib/env';
import { logger } from '@/lib/logger';
import { createBoss } from '@/lib/queue';
import { jobs } from './jobs';
import { registerJobs } from './runtime';

const env = getEnv();
const boss = createBoss(env.DATABASE_URL);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'worker shutting down');
  try {
    await boss.stop({ graceful: true, timeout: 30_000 });
    logger.info('worker stopped');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'worker shutdown failed');
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

try {
  await boss.start();
  await registerJobs(boss, jobs);
  logger.info({ jobs: jobs.map((j) => j.name) }, 'worker started');
} catch (err) {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
}
