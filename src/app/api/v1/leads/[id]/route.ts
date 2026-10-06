import { getDb } from '@/db/client';
import { authedApiHandler, json, parseJson, routeId, userActor } from '@/lib/api';
import { updateLeadInput } from '@/modules/leads/schemas';
import { eraseLead, getLeadDetail, updateLead } from '@/modules/leads/service';

export const dynamic = 'force-dynamic';

/** Lead detail: contact, qualification, consents, attribution, notes, allowed next stages. */
export const GET = authedApiHandler('viewer', async (_req, { user }, route) =>
  json(await getLeadDetail(getDb(), user.organizationId, await routeId(route))),
);

/** Edit contact details, owner and qualification. Stage changes use /transition. */
export const PATCH = authedApiHandler('sales', async (req, ctx, route) => {
  const id = await routeId(route);
  const input = await parseJson(req, updateLeadInput);
  return json(await updateLead(getDb(), ctx.user.organizationId, id, input, userActor(ctx)));
});

/** Erase the lead's personal data (data-subject erasure request). Owner only. */
export const DELETE = authedApiHandler('owner', async (_req, ctx, route) => {
  await eraseLead(getDb(), ctx.user.organizationId, await routeId(route), userActor(ctx));
  return json({ erased: true });
});
