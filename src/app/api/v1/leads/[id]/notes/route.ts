import { getDb } from '@/db/client';
import { authedApiHandler, json, parseJson, routeId, userActor } from '@/lib/api';
import { noteInput } from '@/modules/leads/schemas';
import { addNote } from '@/modules/leads/service';

export const dynamic = 'force-dynamic';

export const POST = authedApiHandler('sales', async (req, ctx, route) => {
  const leadId = await routeId(route);
  const { body } = await parseJson(req, noteInput);
  const note = await addNote(getDb(), ctx.user.organizationId, leadId, body, userActor(ctx));
  return json(note, { status: 201 });
});
