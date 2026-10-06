import { sql } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { QUEUE_SCHEMA } from '@/lib/queue';

export type ComponentStatus = { status: 'ok' } | { status: 'error'; message: string };

export interface HealthReport {
  status: 'ok' | 'degraded';
  checks: { database: ComponentStatus; queue: ComponentStatus };
  version: string;
  time: string;
}

async function checkDatabase(db: Database): Promise<ComponentStatus> {
  try {
    await db.execute(sql`select 1`);
    return { status: 'ok' };
  } catch {
    return { status: 'error', message: 'database unreachable' };
  }
}

async function checkQueue(db: Database): Promise<ComponentStatus> {
  try {
    const result = await db.execute<{ installed: string | null }>(
      sql`select to_regclass(${`${QUEUE_SCHEMA}.version`}) as installed`,
    );
    return result.rows[0]?.installed
      ? { status: 'ok' }
      : { status: 'error', message: 'queue schema not installed (run pnpm db:migrate)' };
  } catch {
    return { status: 'error', message: 'queue check failed' };
  }
}

export async function getHealth(db: Database): Promise<HealthReport> {
  const [database, queue] = await Promise.all([checkDatabase(db), checkQueue(db)]);
  return {
    status: database.status === 'ok' && queue.status === 'ok' ? 'ok' : 'degraded',
    checks: { database, queue },
    version: process.env.APP_VERSION ?? 'dev',
    time: new Date().toISOString(),
  };
}
