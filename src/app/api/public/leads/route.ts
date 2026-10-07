import { CURRENT_CONSENT_WORDING } from '@config/consent';
import { getDb } from '@/db/client';
import { apiHandler, json } from '@/lib/api';
import { Errors } from '@/lib/errors';
import { assertAllowedOrigin, clientIp, preflight, readJsonBody, withCors } from '@/lib/public-api';
import { publicFormLimiter } from '@/lib/rate-limit';
import type { Consent } from '@/db/schema';
import { captureLead } from '@/modules/leads/capture';
import { publicLeadInput } from '@/modules/leads/public-schema';
import { getDefaultOrganization } from '@/modules/organizations/service';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16_384;

const handle = apiHandler(async (req, { requestId }) => {
  assertAllowedOrigin(req);
  if (!publicFormLimiter().take(`public-leads:${clientIp(req)}`)) {
    throw Errors.rateLimited();
  }
  const input = publicLeadInput.parse(await readJsonBody(req, MAX_BODY_BYTES));
  // Same response either way, so the endpoint never reveals whether an email is known.
  const accepted = () => json({ status: 'received' }, { status: 202 });
  if (input.website) return accepted(); // honeypot tripped

  const consents: { channel: Consent['channel']; purpose: Consent['purpose'] }[] = [];
  if (input.consent.marketingEmail) consents.push({ channel: 'email', purpose: 'marketing' });
  if (input.consent.marketingSms) consents.push({ channel: 'sms', purpose: 'marketing' });
  if (input.consent.marketingWhatsapp) {
    consents.push({ channel: 'whatsapp', purpose: 'marketing' });
  }

  const db = getDb();
  const organization = await getDefaultOrganization(db);
  await db.transaction((tx) =>
    captureLead(tx, {
      organizationId: organization.id,
      channel: 'form',
      contact: {
        fullName: input.fullName,
        email: input.email,
        phone: input.phone,
        country: input.country,
        ageConfirmed18plus: true,
      },
      qualification: {
        ...(input.experienceLevel ? { experienceLevel: input.experienceLevel } : {}),
        ...(input.marketsOfInterest ? { marketsOfInterest: input.marketsOfInterest } : {}),
      },
      attribution: input.attribution,
      consents,
      consentEvidence: {
        method: 'web_form',
        wordingVersion: CURRENT_CONSENT_WORDING.version,
        wordingApproved: CURRENT_CONSENT_WORDING.approved,
        page: input.attribution?.landingPage ? new URL(input.attribution.landingPage).origin : null,
      },
      actor: { type: 'lead', requestId },
    }),
  );
  return accepted();
});

export async function POST(req: Request, route: { params: Promise<Record<string, string>> }) {
  return withCors(req, await handle(req, route));
}

export async function OPTIONS(req: Request) {
  return preflight(req, 'POST, OPTIONS', 'content-type');
}
