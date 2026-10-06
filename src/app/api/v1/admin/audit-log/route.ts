import { z } from 'zod';
import { getDb } from '@/db/client';
import { authedApiHandler, json, parseQuery } from '@/lib/api';
import { listRecentAudit } from '@/modules/audit/service';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Recent audit-log entries for the user's organization. Admin and owner only. */
export const GET = authedApiHandler('admin', async (req, { user }) => {
  const { limit } = parseQuery(req, querySchema);
  return json(await listRecentAudit(getDb(), user.organizationId, limit));
});
