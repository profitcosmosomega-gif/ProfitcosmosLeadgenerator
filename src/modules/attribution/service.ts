import { eq } from 'drizzle-orm';
import type { DbExecutor } from '@/db/client';
import { leads, touchpoints, type Lead, type Touchpoint } from '@/db/schema';
import type { AttributionInput } from '@/modules/leads/schemas';

/**
 * Keep only origin + path of a URL. Query strings and fragments can carry personal data
 * (emails, tokens); UTM values are captured separately.
 */
export function stripUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

/**
 * Record a touchpoint for a lead and maintain first/last-touch attribution on the lead.
 * The lead's `source` is set from the first touchpoint that has one.
 */
export async function recordTouchpoint(
  tx: DbExecutor,
  lead: Pick<Lead, 'id' | 'organizationId' | 'firstTouchId' | 'source'>,
  channel: Touchpoint['channel'],
  input: AttributionInput = {},
): Promise<Touchpoint> {
  const [touchpoint] = await tx
    .insert(touchpoints)
    .values({
      organizationId: lead.organizationId,
      leadId: lead.id,
      channel,
      source: input.source ?? null,
      medium: input.medium ?? null,
      campaign: input.campaign ?? null,
      content: input.content ?? null,
      term: input.term ?? null,
      landingPage: stripUrl(input.landingPage),
      referrer: stripUrl(input.referrer),
      clickIds: input.clickIds ?? {},
    })
    .returning();
  if (!touchpoint) throw new Error('Failed to record touchpoint');

  await tx
    .update(leads)
    .set({
      lastTouchId: touchpoint.id,
      lastActivityAt: new Date(),
      ...(lead.firstTouchId ? {} : { firstTouchId: touchpoint.id }),
      ...(!lead.source && touchpoint.source ? { source: touchpoint.source } : {}),
    })
    .where(eq(leads.id, lead.id));
  return touchpoint;
}
