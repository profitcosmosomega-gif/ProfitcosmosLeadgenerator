import { getDb } from '@/db/client';
import { authedApiHandler, json, parseJson, parseQuery, userActor } from '@/lib/api';
import { createLeadInput, listLeadsQuery } from '@/modules/leads/schemas';
import { createLead, listLeads } from '@/modules/leads/service';

export const dynamic = 'force-dynamic';

/** List leads in the user's organization. */
export const GET = authedApiHandler('viewer', async (req, { user }) =>
  json(await listLeads(getDb(), user.organizationId, parseQuery(req, listLeadsQuery))),
);

/** Create a lead by hand. */
export const POST = authedApiHandler('sales', async (req, ctx) => {
  const input = await parseJson(req, createLeadInput);
  const lead = await createLead(getDb(), ctx.user.organizationId, input, userActor(ctx));
  return json(lead, { status: 201 });
});
