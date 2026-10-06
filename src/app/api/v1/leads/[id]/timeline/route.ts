import { getDb } from '@/db/client';
import { authedApiHandler, json, routeId } from '@/lib/api';
import { getTimeline } from '@/modules/leads/service';

export const dynamic = 'force-dynamic';

export const GET = authedApiHandler('viewer', async (_req, { user }, route) =>
  json(await getTimeline(getDb(), user.organizationId, await routeId(route))),
);
