import type { DbExecutor } from '@/db/client';
import { leadEvents } from '@/db/schema';
import { recordAudit } from '@/modules/audit/service';

/** Who performed an action. `lead` = the prospect themself (e.g. submitting a form). */
export type Actor =
  | { type: 'user'; userId: string; requestId?: string }
  | { type: 'system'; requestId?: string }
  | { type: 'lead'; requestId?: string };

export const systemActor: Actor = { type: 'system' };

export function actorUserId(actor: Actor): string | null {
  return actor.type === 'user' ? actor.userId : null;
}

/**
 * Record a lead mutation on the lead timeline (`lead_events`) and in the audit log, in the
 * caller's transaction. Payload and metadata must reference ids and field names only — never
 * personal data such as names, emails, phone numbers or free text.
 */
export async function recordLeadHistory(
  tx: DbExecutor,
  input: {
    organizationId: string;
    leadId: string;
    type: string;
    actor: Actor;
    payload?: Record<string, unknown>;
  },
): Promise<void> {
  const payload = input.payload ?? {};
  await tx.insert(leadEvents).values({
    organizationId: input.organizationId,
    leadId: input.leadId,
    type: input.type,
    actorType: input.actor.type,
    actorUserId: actorUserId(input.actor),
    payload,
  });
  await recordAudit(tx, {
    organizationId: input.organizationId,
    actorType: input.actor.type === 'user' ? 'user' : 'system',
    actorUserId: actorUserId(input.actor),
    action: input.type,
    entityType: 'lead',
    entityId: input.leadId,
    metadata: payload,
    requestId: input.actor.requestId ?? null,
  });
}
