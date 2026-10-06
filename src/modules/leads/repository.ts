import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '@/db/client';
import { leads, type Lead } from '@/db/schema';
import { Errors } from '@/lib/errors';

/** Load a lead in the organization, or throw 404. Leads in other organizations are invisible. */
export async function findLead(
  db: DbExecutor,
  organizationId: string,
  leadId: string,
  options: { forUpdate?: boolean } = {},
): Promise<Lead> {
  const query = db
    .select()
    .from(leads)
    .where(and(eq(leads.id, leadId), eq(leads.organizationId, organizationId)));
  const [lead] = await (options.forUpdate ? query.for('update') : query);
  if (!lead) throw Errors.notFound('Lead not found');
  return lead;
}

/** Load a lead that can still be changed: not erased and not merged into another lead. */
export async function findMutableLead(
  db: DbExecutor,
  organizationId: string,
  leadId: string,
): Promise<Lead> {
  const lead = await findLead(db, organizationId, leadId, { forUpdate: true });
  if (lead.erasedAt) throw Errors.conflict('This lead has been erased');
  if (lead.mergedIntoLeadId) {
    throw Errors.conflict('This lead was merged into another lead', {
      mergedIntoLeadId: lead.mergedIntoLeadId,
    });
  }
  return lead;
}
