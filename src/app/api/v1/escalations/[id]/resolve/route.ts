import { getDb } from '@/db/client';
import { authedApiHandler, json, routeId, userActor } from '@/lib/api';
import { resolveEscalation } from '@/modules/conversations/service';

export const dynamic = 'force-dynamic';

export const POST = authedApiHandler('sales', async (_req, ctx, route) => {
  const escalationId = await routeId(route);
  const escalation = await resolveEscalation(
    getDb(),
    ctx.user.organizationId,
    escalationId,
    userActor(ctx),
  );
  return json({ id: escalation.id, status: escalation.status });
});
