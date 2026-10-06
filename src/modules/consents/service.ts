import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { DbExecutor } from '@/db/client';
import { consents, suppressionList, type Consent } from '@/db/schema';
import { recordLeadHistory, type Actor } from '@/modules/leads/history';
import { hashContact } from '@/modules/leads/normalize';

export type ConsentChannel = Consent['channel'];
export type ConsentPurpose = Consent['purpose'];

/** Append a consent record. The latest record per (channel, purpose) is the current state. */
export async function recordConsent(
  tx: DbExecutor,
  input: {
    organizationId: string;
    leadId: string;
    channel: ConsentChannel;
    purpose: ConsentPurpose;
    status: Consent['status'];
    source: Consent['source'];
    evidence: Record<string, unknown>;
    actor: Actor;
  },
): Promise<void> {
  const [row] = await tx
    .insert(consents)
    .values({
      organizationId: input.organizationId,
      leadId: input.leadId,
      channel: input.channel,
      purpose: input.purpose,
      status: input.status,
      source: input.source,
      evidence: input.evidence,
    })
    .returning({ id: consents.id });
  await recordLeadHistory(tx, {
    organizationId: input.organizationId,
    leadId: input.leadId,
    type: 'consent.recorded',
    actor: input.actor,
    payload: {
      consentId: row?.id,
      channel: input.channel,
      purpose: input.purpose,
      status: input.status,
    },
  });
}

/** Current consent per channel and purpose (latest record wins). */
export async function currentConsents(
  db: DbExecutor,
  organizationId: string,
  leadIds: string[],
): Promise<Consent[]> {
  if (leadIds.length === 0) return [];
  const rows = await db
    .select()
    .from(consents)
    .where(and(eq(consents.organizationId, organizationId), inArray(consents.leadId, leadIds)))
    .orderBy(desc(consents.createdAt), desc(consents.id));
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.leadId}:${row.channel}:${row.purpose}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function addToSuppressionList(
  tx: DbExecutor,
  organizationId: string,
  contact: { email?: string | null; phone?: string | null },
  reason: string,
): Promise<void> {
  const rows = [
    contact.email ? { kind: 'email' as const, valueHash: hashContact(contact.email) } : null,
    contact.phone ? { kind: 'phone' as const, valueHash: hashContact(contact.phone) } : null,
  ].filter((row) => row !== null);
  if (rows.length === 0) return;
  await tx
    .insert(suppressionList)
    .values(rows.map((row) => ({ ...row, organizationId, reason })))
    .onConflictDoNothing();
}

/** True if the (normalised) email or phone is on the do-not-contact list. */
export async function isSuppressed(
  db: DbExecutor,
  organizationId: string,
  contact: { email?: string | null; phone?: string | null },
): Promise<boolean> {
  const conditions = [
    contact.email
      ? and(
          eq(suppressionList.kind, 'email'),
          eq(suppressionList.valueHash, hashContact(contact.email)),
        )
      : undefined,
    contact.phone
      ? and(
          eq(suppressionList.kind, 'phone'),
          eq(suppressionList.valueHash, hashContact(contact.phone)),
        )
      : undefined,
  ].filter((c) => c !== undefined);
  if (conditions.length === 0) return false;
  const [row] = await db
    .select({ id: suppressionList.id })
    .from(suppressionList)
    .where(and(eq(suppressionList.organizationId, organizationId), or(...conditions)))
    .limit(1);
  return Boolean(row);
}
