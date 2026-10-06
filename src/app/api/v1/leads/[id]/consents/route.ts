import { getDb } from '@/db/client';
import { authedApiHandler, json, parseJson, routeId, userActor } from '@/lib/api';
import { currentConsents, recordConsent } from '@/modules/consents/service';
import { findMutableLead } from '@/modules/leads/repository';
import { consentInput } from '@/modules/leads/schemas';

export const dynamic = 'force-dynamic';

/** Record consent given or withdrawn outside the web form (e.g. by phone). */
export const POST = authedApiHandler('sales', async (req, ctx, route) => {
  const leadId = await routeId(route);
  const input = await parseJson(req, consentInput);
  const organizationId = ctx.user.organizationId;
  const consents = await getDb().transaction(async (tx) => {
    const lead = await findMutableLead(tx, organizationId, leadId);
    await recordConsent(tx, {
      organizationId,
      leadId: lead.id,
      channel: input.channel,
      purpose: input.purpose,
      status: input.status,
      source: 'staff',
      evidence: { method: 'staff', recordedByUserId: ctx.user.id, note: input.note ?? null },
      actor: userActor(ctx),
    });
    return currentConsents(tx, organizationId, [lead.id]);
  });
  return json(consents, { status: 201 });
});
