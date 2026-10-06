import type { z } from 'zod';
import type { Logger } from '@/lib/logger';

export interface JobContext {
  jobId: string;
  log: Logger;
}

/**
 * A background job. Payloads are validated with `schema` both when enqueued and when processed,
 * because queued data may predate a code change.
 */
export interface JobDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  schema: S;
  handler: (data: z.infer<S>, ctx: JobContext) => Promise<void>;
  /** Optional cron schedule (UTC) for recurring jobs. */
  cron?: string;
  retryLimit?: number;
}

export function defineJob<S extends z.ZodType>(job: JobDefinition<S>): JobDefinition<S> {
  return job;
}
