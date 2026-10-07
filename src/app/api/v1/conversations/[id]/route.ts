import { getDb } from '@/db/client';
import { authedApiHandler, json, routeId } from '@/lib/api';
import { getConversationDetail } from '@/modules/conversations/service';

export const dynamic = 'force-dynamic';

export const GET = authedApiHandler('viewer', async (_req, ctx, route) => {
  const conversationId = await routeId(route);
  return json(await getConversationDetail(getDb(), ctx.user.organizationId, conversationId));
});
