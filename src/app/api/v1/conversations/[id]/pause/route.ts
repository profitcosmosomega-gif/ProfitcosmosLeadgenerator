import { getDb } from '@/db/client';
import { authedApiHandler, json, routeId, userActor } from '@/lib/api';
import { setConversationAiPaused } from '@/modules/conversations/service';

export const dynamic = 'force-dynamic';

export const POST = authedApiHandler('sales', async (_req, ctx, route) => {
  const conversationId = await routeId(route);
  const conversation = await setConversationAiPaused(
    getDb(),
    ctx.user.organizationId,
    conversationId,
    true,
    userActor(ctx),
  );
  return json({ id: conversation.id, aiPaused: conversation.aiPaused });
});
