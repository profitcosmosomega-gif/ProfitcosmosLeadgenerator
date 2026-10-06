import type { PgBoss } from 'pg-boss';
import { logger } from '@/lib/logger';
import type { JobDefinition } from './jobs/types';

/** Create queues, attach handlers and register cron schedules for the given jobs. */
export async function registerJobs(boss: PgBoss, definitions: JobDefinition[]): Promise<void> {
  for (const job of definitions) {
    await boss.createQueue(job.name, { retryLimit: job.retryLimit ?? 3, retryBackoff: true });

    await boss.work(job.name, async (batch) => {
      for (const item of batch) {
        const log = logger.child({ job: job.name, jobId: item.id });
        const data = job.schema.parse(item.data ?? {});
        const started = performance.now();
        await job.handler(data, { jobId: item.id, log });
        log.debug({ durationMs: Math.round(performance.now() - started) }, 'job completed');
      }
    });

    if (job.cron) {
      await boss.schedule(job.name, job.cron, {});
    }
  }
}

/** Validate a payload against the job's schema and enqueue it. */
export async function enqueue<J extends JobDefinition>(
  boss: PgBoss,
  job: J,
  data: Parameters<J['handler']>[0],
): Promise<string | null> {
  return boss.send(job.name, job.schema.parse(data) as object);
}
