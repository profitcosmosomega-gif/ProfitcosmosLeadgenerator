import { and, eq, isNull } from 'drizzle-orm';
import type { DbExecutor } from '@/db/client';
import { channelIdentities, leads, type ChannelIdentity } from '@/db/schema';
import { Errors } from '@/lib/errors';
import { recordLeadHistory, type Actor } from '@/modules/leads/history';
import { findMutableLead } from '@/modules/leads/repository';
import type { ChannelKind } from './types';

/**
 * Link a platform identity (e.g. a WhatsApp number or Instagram user id) to a lead.
 * Foundation for the channel adapters of later phases; no channel uses it yet.
 * One identity belongs to at most one lead per organization.
 */
export async function linkChannelIdentity(
  tx: DbExecutor,
  input: {
    organizationId: string;
    leadId: string;
    channel: ChannelKind;
    externalId: string;
    actor: Actor;
  },
): Promise<ChannelIdentity> {
  const lead = await findMutableLead(tx, input.organizationId, input.leadId);
  const existing = await findLeadByChannelIdentity(
    tx,
    input.organizationId,
    input.channel,
    input.externalId,
  );
  if (existing) {
    if (existing.leadId === lead.id) return existing;
    throw Errors.conflict('This channel identity belongs to another lead');
  }
  const [identity] = await tx
    .insert(channelIdentities)
    .values({
      organizationId: input.organizationId,
      leadId: lead.id,
      channel: input.channel,
      externalId: input.externalId,
    })
    .returning();
  await recordLeadHistory(tx, {
    organizationId: input.organizationId,
    leadId: lead.id,
    type: 'channel_identity.linked',
    actor: input.actor,
    payload: { identityId: identity?.id, channel: input.channel },
  });
  return identity!;
}

/** Resolve a platform identity to its lead within the organization. */
export async function findLeadByChannelIdentity(
  db: DbExecutor,
  organizationId: string,
  channel: ChannelKind,
  externalId: string,
): Promise<ChannelIdentity | undefined> {
  const [row] = await db
    .select({ identity: channelIdentities })
    .from(channelIdentities)
    .innerJoin(leads, eq(leads.id, channelIdentities.leadId))
    .where(
      and(
        eq(channelIdentities.organizationId, organizationId),
        eq(channelIdentities.channel, channel),
        eq(channelIdentities.externalId, externalId),
        isNull(leads.erasedAt),
      ),
    );
  return row?.identity;
}
