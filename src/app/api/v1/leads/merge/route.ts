import { getDb } from '@/db/client';
import { authedApiHandler, json, parseJson, userActor } from '@/lib/api';
import { mergeInput } from '@/modules/leads/schemas';
import { mergeLeads } from '@/modules/leads/service';

export const dynamic = 'force-dynamic';

/** Merge a duplicate lead (source) into another (target). Admin and owner. */
export const POST = authedApiHandler('admin', async (req, ctx) => {
  const input = await parseJson(req, mergeInput);
  return json(await mergeLeads(getDb(), ctx.user.organizationId, input, userActor(ctx)));
});
