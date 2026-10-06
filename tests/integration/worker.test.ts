import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createBoss } from '@/lib/queue';
import { defineJob } from '@/worker/jobs/types';
import { enqueue, registerJobs } from '@/worker/runtime';
import { TEST_ENV } from '../test-env';

let boss: PgBoss;

beforeAll(async () => {
  boss = createBoss(TEST_ENV.DATABASE_URL);
  await boss.start();
});
afterAll(async () => {
  await boss.stop({ graceful: false });
});

describe('worker runtime', () => {
  it('processes an enqueued job with a validated payload', async () => {
    const seen: string[] = [];
    const job = defineJob({
      name: 'test.echo',
      schema: z.object({ message: z.string() }),
      retryLimit: 0,
      handler: async (data) => {
        seen.push(data.message);
      },
    });

    await registerJobs(boss, [job]);
    const id = await enqueue(boss, job, { message: 'hello' });
    expect(id).toBeTruthy();

    await vi.waitFor(() => expect(seen).toEqual(['hello']), { timeout: 15_000, interval: 200 });
  });

  it('rejects invalid payloads at enqueue time', async () => {
    const job = defineJob({
      name: 'test.strict',
      schema: z.object({ count: z.number() }),
      handler: async () => {},
    });
    await expect(enqueue(boss, job, { count: 'x' } as never)).rejects.toThrow();
  });
});
