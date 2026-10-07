import { CURRENT_CONSENT_WORDING } from '@config/consent';
import { getDb } from '@/db/client';
import { apiHandler, json } from '@/lib/api';
import { Errors } from '@/lib/errors';
import { assertAllowedOrigin, clientIp, preflight, readJsonBody, withCors } from '@/lib/public-api';
import { publicFormLimiter } from '@/lib/rate-limit';
import { startConversationInput } from '@/modules/conversations/public-schema';
import { startConversation } from '@/modules/conversations/service';
import { captureLead } from '@/modules/leads/capture';
import { getDefaultOrganization } from '@/modules/organizations/service';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16_384;

/**
 * Start a chat from the pre-chat form. Creates or updates the lead like the public form, then
 * opens a conversation and returns its access token once. Suppressed contacts and bots get the
 * same neutral 202 as the lead form, and no conversation.
 */
const handle = apiHandler(async (req, { requestId }) => {
  assertAllowedOrigin(req);
  if (!publicFormLimiter().take(`public-chat-start:${clientIp(req)}`)) {
    throw Errors.rateLimited();
  }
  const input = startConversationInput.parse(await readJsonBody(req, MAX_BODY_BYTES));
  const received = () => json({ status: 'received' }, { status: 202 });
  if (input.website) return received();

  const db = getDb();
  const organization = await getDefaultOrganization(db);
  const started = await db.transaction(async (tx) => {
    const captured = await captureLead(tx, {
      organizationId: organization.id,
      channel: 'chat',
      contact: { fullName: input.fullName, email: input.email, ageConfirmed18plus: true },
      attribution: input.attribution,
      consents: input.consent.marketingEmail ? [{ channel: 'email', purpose: 'marketing' }] : [],
      consentEvidence: {
        method: 'chat_form',
        wordingVersion: CURRENT_CONSENT_WORDING.version,
        wordingApproved: CURRENT_CONSENT_WORDING.approved,
      },
      actor: { type: 'lead', requestId },
    });
    if (captured.outcome === 'suppressed' || !captured.leadId) return null;
    return startConversation(tx, {
      organizationId: organization.id,
      leadId: captured.leadId,
      channel: 'web',
      actor: { type: 'lead', requestId },
    });
  });
  if (!started) return received();
  return json(
    {
      status: 'started',
      conversationId: started.conversation.id,
      accessToken: started.accessToken,
    },
    { status: 201, headers: { 'cache-control': 'no-store' } },
  );
});

export async function POST(req: Request, route: { params: Promise<Record<string, string>> }) {
  return withCors(req, await handle(req, route));
}

export async function OPTIONS(req: Request) {
  return preflight(req, 'POST, OPTIONS', 'content-type');
}
