import { getDb } from '@/db/client';
import { authedApiHandler, json, parseJson, routeId, userActor } from '@/lib/api';
import { transitionLead } from '@/modules/crm/service';
import { transitionInput } from '@/modules/leads/schemas';

export const dynamic = 'force-dynamic';

/** Move a lead to another pipeline stage (validated against config/pipeline.ts). */
export const POST = authedApiHandler('sales', async (req, ctx, route) => {
  const leadId = await routeId(route);
  const input = await parseJson(req, transitionInput);
  const lead = await transitionLead(getDb(), {
    organizationId: ctx.user.organizationId,
    leadId,
    to: input.to,
    reason: input.reason,
    actor: userActor(ctx),
  });
  return json(lead);
});
