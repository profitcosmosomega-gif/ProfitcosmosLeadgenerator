import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as leadRoute from '@/app/api/v1/leads/[id]/route';
import * as notesRoute from '@/app/api/v1/leads/[id]/notes/route';
import * as timelineRoute from '@/app/api/v1/leads/[id]/timeline/route';
import * as leadsRoute from '@/app/api/v1/leads/route';
import { closeDb, getDb } from '@/db/client';
import { auditLog, leadEvents, stageTransitions } from '@/db/schema';
import { as, call, clearSessions } from '../helpers/http';
import { createOrg, createStaff, resetDb } from '../helpers/db';

let orgA: string;
let orgB: string;
let salesId: string;

beforeAll(async () => {
  await resetDb();
  clearSessions();
  orgA = (await createOrg()).id;
  orgB = (await createOrg('other-academy')).id;
  for (const role of ['viewer', 'sales', 'admin', 'owner'] as const) {
    const user = await createStaff(role, orgA);
    if (role === 'sales') salesId = user.id;
  }
  await createStaff('owner', orgB, 'b-');
});
afterAll(closeDb);

const newLead = (suffix: string, extra: Record<string, unknown> = {}) => ({
  fullName: `Lead ${suffix}`,
  email: `Lead.${suffix}@Example.test`,
  ...extra,
});

async function createAs(email: string, body: unknown) {
  return call(leadsRoute.POST, '/api/v1/leads', {
    method: 'POST',
    headers: await as(email),
    body,
  });
}

describe('create and read', () => {
  it('creates a lead with normalised contact details at NEW_LEAD', async () => {
    const res = await createAs(
      'sales@example.test',
      newLead('create', {
        phone: '+44 20 7946 0958',
        country: 'gb',
        source: 'instagram',
        qualification: { experienceLevel: 'beginner', marketsOfInterest: ['forex'] },
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      email: 'lead.create@example.test',
      phone: '+442079460958',
      country: 'GB',
      stage: 'NEW_LEAD',
      source: 'instagram',
      organizationId: orgA,
    });

    const detail = await call(leadRoute.GET, '/api/v1/leads/x', {
      headers: await as('viewer@example.test'),
      params: { id: res.body.data.id },
    });
    expect(detail.status).toBe(200);
    expect(detail.body.data.qualification).toMatchObject({
      experienceLevel: 'beginner',
      marketsOfInterest: ['forex'],
    });
    expect(detail.body.data.qualification.evidence.experienceLevel.source).toBe('staff');
    expect(detail.body.data.allowedNextStages).toEqual([
      'ENGAGED',
      'QUALIFYING',
      'NURTURE',
      'LOST',
    ]);
    expect(detail.body.data.touchpoints).toHaveLength(1);
  });

  it('records creation in transitions, timeline and audit without personal data', async () => {
    const res = await createAs('sales@example.test', newLead('history', { phone: '+14155552671' }));
    const id = res.body.data.id;
    const db = getDb();

    const transitions = await db
      .select()
      .from(stageTransitions)
      .where(eq(stageTransitions.leadId, id));
    expect(transitions).toEqual([
      expect.objectContaining({ fromStage: null, toStage: 'NEW_LEAD', actorUserId: salesId }),
    ]);

    const events = await db.select().from(leadEvents).where(eq(leadEvents.leadId, id));
    expect(events.map((e) => e.type)).toEqual(['lead.created']);

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'lead.created')));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorUserId).toBe(salesId);

    const serialized = JSON.stringify([events, audits]);
    expect(serialized).not.toContain('lead.history@example.test');
    expect(serialized).not.toContain('+14155552671');
    expect(serialized).not.toContain('Lead history');
  });

  it('rejects a duplicate email with 409', async () => {
    await createAs('sales@example.test', newLead('dup'));
    const res = await createAs('sales@example.test', newLead('dup'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('lists, filters and searches leads', async () => {
    await createAs('sales@example.test', newLead('searchable', { source: 'webinar' }));
    const headers = await as('viewer@example.test');

    const all = await call(leadsRoute.GET, '/api/v1/leads?limit=100', { headers });
    expect(all.status).toBe(200);
    expect(all.body.data.total).toBeGreaterThanOrEqual(4);

    const search = await call(leadsRoute.GET, '/api/v1/leads?q=searchable', { headers });
    expect(search.body.data.items).toHaveLength(1);
    expect(search.body.data.items[0].email).toBe('lead.searchable@example.test');

    const bySource = await call(leadsRoute.GET, '/api/v1/leads?source=webinar', { headers });
    expect(bySource.body.data.items.every((l: { source: string }) => l.source === 'webinar')).toBe(
      true,
    );

    const wildcard = await call(leadsRoute.GET, '/api/v1/leads?q=%25', { headers });
    expect(wildcard.body.data.items).toHaveLength(0);
  });
});

describe('update', () => {
  it('updates fields, records changed field names and keeps the stage', async () => {
    const created = await createAs('sales@example.test', newLead('update'));
    const id = created.body.data.id;
    const res = await call(leadRoute.PATCH, '/api/v1/leads/x', {
      method: 'PATCH',
      headers: await as('sales@example.test'),
      params: { id },
      body: {
        fullName: 'Renamed',
        ownerUserId: salesId,
        qualification: { goals: ['consistency'] },
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      fullName: 'Renamed',
      ownerUserId: salesId,
      stage: 'NEW_LEAD',
    });

    const timeline = await call(timelineRoute.GET, '/api/v1/leads/x/timeline', {
      headers: await as('viewer@example.test'),
      params: { id },
    });
    const updated = timeline.body.data.find((e: { type: string }) => e.type === 'lead.updated');
    expect(updated.payload.fields.sort()).toEqual(
      ['fullName', 'ownerUserId', 'qualification.goals'].sort(),
    );
    expect(JSON.stringify(updated.payload)).not.toContain('Renamed');
  });

  it('refuses stage changes through PATCH', async () => {
    const created = await createAs('sales@example.test', newLead('nostage'));
    const res = await call(leadRoute.PATCH, '/api/v1/leads/x', {
      method: 'PATCH',
      headers: await as('admin@example.test'),
      params: { id: created.body.data.id },
      body: { stage: 'ENROLLED' },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses to remove the last contact detail', async () => {
    const created = await createAs('sales@example.test', newLead('lastcontact'));
    const res = await call(leadRoute.PATCH, '/api/v1/leads/x', {
      method: 'PATCH',
      headers: await as('sales@example.test'),
      params: { id: created.body.data.id },
      body: { email: null },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects an owner from another organization', async () => {
    const created = await createAs('sales@example.test', newLead('badowner'));
    const otherOwner = (await createStaff('sales', orgB, 'b-')).id;
    const res = await call(leadRoute.PATCH, '/api/v1/leads/x', {
      method: 'PATCH',
      headers: await as('sales@example.test'),
      params: { id: created.body.data.id },
      body: { ownerUserId: otherOwner },
    });
    expect(res.status).toBe(400);
  });
});

describe('validation errors use the typed envelope', () => {
  it.each([
    ['missing email and phone', { fullName: 'No contact' }],
    ['invalid email', { email: 'nope' }],
    ['local phone without country code', { phone: '020 7946 0958' }],
    ['unknown field', { email: 'a@example.test', hacker: true }],
    ['stage on create', { email: 'b@example.test', stage: 'ENROLLED' }],
  ])('%s → 400', async (_name, body) => {
    const res = await createAs('sales@example.test', body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatchObject({
      code: 'VALIDATION_ERROR',
      requestId: expect.any(String),
    });
  });

  it('returns 404 for a malformed id', async () => {
    const res = await call(leadRoute.GET, '/api/v1/leads/x', {
      headers: await as('viewer@example.test'),
      params: { id: 'not-a-uuid' },
    });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('role permissions', () => {
  it('requires a session (401)', async () => {
    const res = await call(leadsRoute.GET, '/api/v1/leads');
    expect(res.status).toBe(401);
  });

  it('lets viewers read but not write (403)', async () => {
    const created = await createAs('sales@example.test', newLead('rbac'));
    const id = created.body.data.id;
    const viewer = await as('viewer@example.test');

    expect((await createAs('viewer@example.test', newLead('viewer-create'))).status).toBe(403);
    expect(
      (
        await call(leadRoute.PATCH, '/', {
          method: 'PATCH',
          headers: viewer,
          params: { id },
          body: { fullName: 'x' },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(notesRoute.POST, '/', {
          method: 'POST',
          headers: viewer,
          params: { id },
          body: { body: 'hi' },
        })
      ).status,
    ).toBe(403);
  });

  it.each(['sales', 'admin'] as const)(
    'forbids %s from erasing a lead (owner only)',
    async (role) => {
      const created = await createAs('sales@example.test', newLead(`erase-${role}`));
      const res = await call(leadRoute.DELETE, '/', {
        method: 'DELETE',
        headers: await as(`${role}@example.test`),
        params: { id: created.body.data.id },
      });
      expect(res.status).toBe(403);
    },
  );
});

describe('organization isolation', () => {
  it('hides leads from other organizations on every route (404) and in lists', async () => {
    const created = await createAs('sales@example.test', newLead('isolated'));
    const id = created.body.data.id;
    const other = await as('b-owner@example.test');

    for (const [handler, method, body] of [
      [leadRoute.GET, 'GET', undefined],
      [leadRoute.PATCH, 'PATCH', { fullName: 'stolen' }],
      [leadRoute.DELETE, 'DELETE', undefined],
      [timelineRoute.GET, 'GET', undefined],
      [notesRoute.POST, 'POST', { body: 'x' }],
    ] as const) {
      const res = await call(handler, '/', { method, headers: other, params: { id }, body });
      expect(res.status).toBe(404);
    }

    const list = await call(leadsRoute.GET, '/api/v1/leads?q=isolated', { headers: other });
    expect(list.body.data.total).toBe(0);
  });

  it('lets two organizations hold the same email independently', async () => {
    await createAs('sales@example.test', newLead('shared'));
    const res = await createAs('b-owner@example.test', newLead('shared'));
    expect(res.status).toBe(201);
    expect(res.body.data.organizationId).toBe(orgB);
  });
});
