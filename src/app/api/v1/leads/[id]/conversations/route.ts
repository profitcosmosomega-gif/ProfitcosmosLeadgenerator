import { getDb } from '@/db/client';
import { authedApiHandler, json, routeId } from '@/lib/api';
import { listLeadConversations } from '@/modules/conversations/service';

export const dynamic = 'force-dynamic';

export const GET = authedApiHandler('viewer', async (_req, ctx, route) => {
  const leadId = await routeId(route);
  return json(await listLeadConversations(getDb(), ctx.user.organizationId, leadId));
});
