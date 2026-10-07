import type { DbExecutor } from '@/db/client';
import type { Consent } from '@/db/schema';
import { recordTouchpoint } from '@/modules/attribution/service';
import { isSuppressed, recordConsent } from '@/modules/consents/service';
import type { Actor } from './history';
import { findMutableLead } from './repository';
import type { AttributionInput, QualificationInput } from './schemas';
import {
  applyLeadChanges,
  findActiveLeadByContact,
  insertLead,
  type ContactInput,
} from './service';

export type CaptureOutcome = 'created' | 'updated' | 'suppressed';

export interface CaptureInput {
  organizationId: string;
  channel: 'form' | 'import' | 'chat';
  contact: ContactInput & { email?: string | null; phone?: string | null };
  qualification?: QualificationInput;
  attribution?: AttributionInput;
  /** Consents the prospect granted (form checkbox or import column). */
  consents?: { channel: Consent['channel']; purpose: Consent['purpose'] }[];
  consentEvidence?: Record<string, unknown>;
  actor: Actor;
}

/**
 * Create or update a lead from an inbound capture (web form or CSV import).
 *
 * - Contacts on the do-not-contact list are dropped (`suppressed`), nothing is stored.
 * - An existing active lead with the same email (or phone) is updated: only empty fields are
 *   filled, so staff edits are never overwritten; a touchpoint and any consents are added.
 * - Otherwise a new lead is created at the initial pipeline stage.
 *
 * Runs in the caller's transaction.
 */
export async function captureLead(
  tx: DbExecutor,
  input: CaptureInput,
): Promise<{ outcome: CaptureOutcome; leadId?: string }> {
  if (await isSuppressed(tx, input.organizationId, input.contact)) {
    return { outcome: 'suppressed' };
  }

  const existing = await findActiveLeadByContact(tx, input.organizationId, input.contact);
  let leadId: string;
  let outcome: CaptureOutcome;

  if (existing) {
    const lead = await findMutableLead(tx, input.organizationId, existing.id);
    await applyLeadChanges(tx, lead, {
      contact: input.contact,
      qualification: input.qualification,
      fillOnly: true,
      source: input.channel,
      actor: input.actor,
      eventType: 'lead.recaptured',
      eventPayload: { channel: input.channel },
    });
    await recordTouchpoint(tx, lead, input.channel, input.attribution);
    leadId = lead.id;
    outcome = 'updated';
  } else {
    const lead = await insertLead(tx, {
      organizationId: input.organizationId,
      contact: input.contact,
      qualification: input.qualification,
      channel: input.channel,
      attribution: input.attribution,
      actor: input.actor,
    });
    leadId = lead.id;
    outcome = 'created';
  }

  for (const consent of input.consents ?? []) {
    await recordConsent(tx, {
      organizationId: input.organizationId,
      leadId,
      channel: consent.channel,
      purpose: consent.purpose,
      status: 'granted',
      source: input.channel,
      evidence: input.consentEvidence ?? {},
      actor: input.actor,
    });
  }

  return { outcome, leadId };
}
