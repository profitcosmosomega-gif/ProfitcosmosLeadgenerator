import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CURRENT_CONSENT_WORDING } from '@config/consent';
import * as publicRoute from '@/app/api/public/leads/route';
import * as leadRoute from '@/app/api/v1/leads/[id]/route';
import { closeDb, getDb } from '@/db/client';
import { consents, leadEvents, leads, touchpoints } from '@/db/schema';
import { publicFormLimiter } from '@/lib/rate-limit';
import { as, call, clearSessions } from '../helpers/http';
import { createOrg, createStaff, resetDb } from '../helpers/db';

let ip = 0;

beforeAll(async () => {
  await resetDb();
  clearSessions();
  const org = await createOrg();
  await createStaff('sales', org.id);
  await createStaff('owner', org.id);
});
beforeEach(() => publicFormLimiter().reset());
afterAll(closeDb);

const form = (overrides: Record<string, unknown> = {}) => ({
  fullName: 'Jane Prospect',
  email: 'jane@example.test',
  country: 'gb',
  experienceLevel: 'beginner',
  marketsOfInterest: ['forex'],
  ageConfirmed18plus: true,
  consent: { wordingVersion: CURRENT_CONSENT_WORDING.version, marketingEmail: true },
  attribution: {
    source: 'instagram',
    medium: 'paid',
    campaign: 'autumn',
    landingPage: 'https://academy.example/start?utm_source=instagram&email=jane@example.test',
    clickIds: { fbclid: 'abc123' },
  },
  ...overrides,
});

function submit(body: unknown, headers: Record<string, string> = {}) {
  return call(publicRoute.POST, '/api/public/leads', {
    method: 'POST',
    headers: { 'x-forwarded-for': `10.0.0.${++ip}`, ...headers },
    body,
  });
}

async function leadByEmail(email: string) {
  const [lead] = await getDb().select().from(leads).where(eq(leads.email, email));
  return lead;
}

describe('public lead form', () => {
  it('creates a lead with consent and attribution, without a session', async () => {
    const res = await submit(form());
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ data: { status: 'received' } });

    const lead = await leadByEmail('jane@example.test');
    expect(lead).toMatchObject({
      stage: 'NEW_LEAD',
      country: 'GB',
      source: 'instagram',
      ageConfirmed18plus: true,
    });

    const [touch] = await getDb()
      .select()
      .from(touchpoints)
      .where(eq(touchpoints.leadId, lead!.id));
    expect(touch).toMatchObject({
      channel: 'form',
      campaign: 'autumn',
      clickIds: { fbclid: 'abc123' },
    });
    // Query strings (which can carry personal data) are stripped.
    expect(touch!.landingPage).toBe('https://academy.example/start');
    expect(lead!.firstTouchId).toBe(touch!.id);

    const [consent] = await getDb().select().from(consents).where(eq(consents.leadId, lead!.id));
    expect(consent).toMatchObject({
      channel: 'email',
      purpose: 'marketing',
      status: 'granted',
      source: 'form',
    });
    expect(consent!.evidence).toMatchObject({
      wordingVersion: CURRENT_CONSENT_WORDING.version,
      wordingApproved: false,
    });
  });

  it('updates the existing lead on resubmission without overwriting staff edits', async () => {
    const lead = await leadByEmail('jane@example.test');
    await call(leadRoute.PATCH, '/', {
      method: 'PATCH',
      headers: await as('sales@example.test'),
      params: { id: lead!.id },
      body: { fullName: 'Jane (edited by staff)' },
    });

    const res = await submit(
      form({
        fullName: 'Jane Again',
        phone: '+44 20 7946 0958',
        attribution: { source: 'youtube' },
      }),
    );
    expect(res.status).toBe(202);

    const all = await getDb()
      .select()
      .from(leads)
      .where(eq(leads.organizationId, lead!.organizationId));
    expect(all.filter((l) => l.email === 'jane@example.test')).toHaveLength(1);
    const updated = await leadByEmail('jane@example.test');
    expect(updated).toMatchObject({
      fullName: 'Jane (edited by staff)',
      phone: '+442079460958',
      source: 'instagram', // first touch keeps the source
    });
    expect(updated!.lastTouchId).not.toBe(updated!.firstTouchId);
    const events = await getDb().select().from(leadEvents).where(eq(leadEvents.leadId, lead!.id));
    expect(events.map((e) => e.type)).toContain('lead.recaptured');
  });

  it('drops honeypot submissions silently', async () => {
    const res = await submit(form({ email: 'bot@example.test', website: 'http://spam' }));
    expect(res.status).toBe(202);
    expect(await leadByEmail('bot@example.test')).toBeUndefined();
  });

  it.each([
    ['under 18', { ageConfirmed18plus: false }],
    ['missing age confirmation', { ageConfirmed18plus: undefined }],
    ['stale consent wording', { consent: { wordingVersion: 'old', marketingEmail: true } }],
    [
      'SMS consent without phone',
      { consent: { wordingVersion: CURRENT_CONSENT_WORDING.version, marketingSms: true } },
    ],
    ['unknown field', { stage: 'ENROLLED' }],
  ])('rejects %s with 400 and stores nothing', async (_name, overrides) => {
    const email = `invalid${ip}@example.test`;
    const res = await submit(form({ email, ...overrides }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(await leadByEmail(email)).toBeUndefined();
  });

  it('rejects oversized and malformed bodies', async () => {
    const big = await submit(form({ email: 'big@example.test', fullName: 'x'.repeat(20_000) }));
    expect(big.status).toBe(400);
    const res = await publicRoute.POST(
      new Request('http://localhost/api/public/leads', {
        method: 'POST',
        headers: { 'x-forwarded-for': '203.0.113.9', 'content-type': 'application/json' },
        body: '{not json',
      }),
      { params: Promise.resolve({}) },
    );
    expect(res.status).toBe(400);
    expect(await leadByEmail('big@example.test')).toBeUndefined();
  });

  it('rate-limits per IP', async () => {
    const headers = { 'x-forwarded-for': '192.0.2.50' };
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await call(publicRoute.POST, '/', {
        method: 'POST',
        headers,
        body: form({ email: `burst${i}@example.test` }),
      });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 202)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('rejects disallowed origins and allows the app origin with CORS headers', async () => {
    const bad = await submit(form({ email: 'cors@example.test' }), {
      origin: 'https://evil.example',
    });
    expect(bad.status).toBe(403);

    const good = await submit(form({ email: 'cors@example.test' }), {
      origin: 'http://localhost:3000',
    });
    expect(good.status).toBe(202);
    expect(good.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });
});
