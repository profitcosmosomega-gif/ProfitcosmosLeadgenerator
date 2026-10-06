import { getDb } from '@/db/client';
import { apiHandler, json } from '@/lib/api';
import { getHealth } from '@/modules/health/service';

export const dynamic = 'force-dynamic';

export const GET = apiHandler(async () => {
  const report = await getHealth(getDb());
  return json(report, { status: report.status === 'ok' ? 200 : 503 });
});
