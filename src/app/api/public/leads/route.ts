import { CURRENT_CONSENT_WORDING } from '@config/consent';
import { getDb } from '@/db/client';
import { apiHandler, json, parseJson } from '@/lib/api';
import { getEnv } from '@/lib/env';
import { Errors } from '@/lib/errors';
import { publicFormLimiter } from '@/lib/rate-limit';
import type { Consent } from '@/db/schema';
import { captureLead } from '@/modules/leads/capture';
import { publicLeadInput } from '@/modules/leads/public-schema';
import { getDefaultOrganization } from '@/modules/organizations/service';

export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 16_384;

function allowedOrigins(): Set<string> {
  const env = getEnv();
  return new Set([env.APP_URL, ...env.PUBLIC_FORM_ORIGINS].map((url) => new URL(url).origin));
}

function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function withCors(req: Request, res: Response): Response {
  const origin = req.headers.get('origin');
  if (origin && allowedOrigins().has(origin)) {
    res.headers.set('access-control-allow-origin', origin);
    res.headers.set('vary', 'Origin');
  }
  return res;
}

const handle = apiHandler(async (req, { requestId }) => {
  const origin = req.headers.get('origin');
  if (origin && !allowedOrigins().has(origin)) {
    throw Errors.forbidden('Origin not allowed');
  }
  if (!publicFormLimiter().take(`public-leads:${clientIp(req)}`)) {
    throw Errors.rateLimited();
  }
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    throw Errors.validation('Request body too large');
  }

  const input = await parseJson(req, publicLeadInput);
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
  const res = new Response(null, { status: 204 });
  const origin = req.headers.get('origin');
  if (origin && allowedOrigins().has(origin)) {
    res.headers.set('access-control-allow-origin', origin);
    res.headers.set('access-control-allow-methods', 'POST, OPTIONS');
    res.headers.set('access-control-allow-headers', 'content-type');
    res.headers.set('access-control-max-age', '600');
    res.headers.set('vary', 'Origin');
  }
  return res;
}
