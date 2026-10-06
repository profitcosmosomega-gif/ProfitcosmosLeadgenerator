import { getDb } from '@/db/client';
import { authedApiHandler, json, routeId, userActor } from '@/lib/api';
import { recordAudit } from '@/modules/audit/service';
import { exportLead } from '@/modules/leads/service';

export const dynamic = 'force-dynamic';

/** Data-subject access request: everything stored about one lead, as JSON. Admin and owner. */
export const GET = authedApiHandler('admin', async (_req, ctx, route) => {
  const leadId = await routeId(route);
  const db = getDb();
  const data = await exportLead(db, ctx.user.organizationId, leadId);
  await recordAudit(db, {
    organizationId: ctx.user.organizationId,
    actorType: 'user',
    actorUserId: userActor(ctx).userId,
    action: 'lead.exported',
    entityType: 'lead',
    entityId: leadId,
    requestId: ctx.requestId,
  });
  const res = json(data);
  res.headers.set('content-disposition', `attachment; filename="lead-${leadId}.json"`);
  res.headers.set('cache-control', 'no-store');
  return res;
});
