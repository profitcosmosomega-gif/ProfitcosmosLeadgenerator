import { z } from 'zod';
import { defineJob } from './types';

/** Proves the worker is alive and processing; scheduled every 5 minutes. */
export const heartbeatJob = defineJob({
  name: 'system.heartbeat',
  schema: z.object({ note: z.string().max(200).optional() }),
  cron: '*/5 * * * *',
  retryLimit: 0,
  handler: async (data, { log }) => {
    log.info({ note: data.note }, 'heartbeat');
  },
});
