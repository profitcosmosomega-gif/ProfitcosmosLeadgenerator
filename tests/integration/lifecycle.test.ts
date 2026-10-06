import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CURRENT_CONSENT_WORDING } from '@config/consent';
import * as publicRoute from '@/app/api/public/leads/route';
import * as consentsRoute from '@/app/api/v1/leads/[id]/consents/route';
import * as exportRoute from '@/app/api/v1/leads/[id]/export/route';
import * as notesRoute from '@/app/api/v1/leads/[id]/notes/route';
import * as leadRoute from '@/app/api/v1/leads/[id]/route';
import * as timelineRoute from '@/app/api/v1/leads/[id]/timeline/route';
import * as mergeRoute from '@/app/api/v1/leads/merge/route';
import * as leadsRoute from '@/app/api/v1/leads/route';
import { closeDb, getDb } from '@/db/client';
import {
  channelIdentities,
  consents,
  leadEvents,
  leadNotes,
  leads,
  stageTransitions,
  suppressionList,
} from '@/db/schema';
import { publicFormLimiter } from '@/lib/rate-limit';
import { findLeadByChannelIdentity, linkChannelIdentity } from '@/modules/channels/identities';
import { as, call, clearSessions } from '../helpers/http';
import { createOrg, createStaff, resetDb } from '../helpers/db';

let orgId: string;
let otherOrgId: string;

beforeAll(async () => {
  await resetDb();
  clearSessions();
  publicFormLimiter().reset();
  orgId = (await createOrg()).id;
  for (const role of ['sales', 'admin', 'owner'] as const) await createStaff(role, orgId);
  otherOrgId = (await createOrg('other-academy')).id;
});
afterAll(closeDb);

async function create(body: Record<string, unknown>) {
  const res = await call(leadsRoute.POST, '/', {
    method: 'POST',
    headers: await as('sales@example.test'),
    body,
  });
  expect(res.status).toBe(201);
  return res.body.data.id as string;
}

describe('notes and consents', () => {
  it('adds notes and records consent changes (latest wins)', async () => {
    const id = await create({ email: 'notes@example.test' });
    const headers = await as('sales@example.test');
    const note = await call(notesRoute.POST, '/', {
      method: 'POST',
      headers,
      params: { id },
      body: { body: 'Called, wants info pack' },
    });
    expect(note.status).toBe(201);

    for (const status of ['granted', 'revoked'] as const) {
      const res = await call(consentsRoute.POST, '/', {
        method: 'POST',
        headers,
        params: { id },
        body: { channel: 'email', purpose: 'marketing', status },
      });
      expect(res.status).toBe(201);
    }
    const detail = await call(leadRoute.GET, '/', { headers, params: { id } });
    expect(detail.body.data.notes).toHaveLength(1);
    expect(detail.body.data.consents).toEqual([
      expect.objectContaining({ channel: 'email', purpose: 'marketing', status: 'revoked' }),
    ]);
    const timeline = await call(timelineRoute.GET, '/', { headers, params: { id } });
    // The note text lives in lead_notes, not in the timeline payload.
    expect(JSON.stringify(timeline.body.data)).not.toContain('info pack');
  });
});

describe('merge', () => {
  it('merges a duplicate into the target, keeping both histories', async () => {
    const target = await create({
      email: 'target@example.test',
      qualification: { goals: ['income'] },
    });
    const source = await create({
      phone: '+14155550100',
      fullName: 'Dup Person',
      source: 'webinar',
      qualification: { experienceLevel: 'intermediate', goals: ['other'] },
    });
    const headers = await as('admin@example.test');
    await call(notesRoute.POST, '/', {
      method: 'POST',
      headers,
      params: { id: source },
      body: { body: 'from source' },
    });

    expect(
      (
        await call(mergeRoute.POST, '/', {
          method: 'POST',
          headers: await as('sales@example.test'),
          body: { targetLeadId: target, sourceLeadId: source },
        })
      ).status,
    ).toBe(403);

    const res = await call(mergeRoute.POST, '/', {
      method: 'POST',
      headers,
      body: { targetLeadId: target, sourceLeadId: source },
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      email: 'target@example.test',
      phone: '+14155550100',
      fullName: 'Dup Person',
    });

    const detail = await call(leadRoute.GET, '/', { headers, params: { id: target } });
    expect(detail.body.data.qualification).toMatchObject({
      experienceLevel: 'intermediate',
      goals: ['income'],
    });
    expect(detail.body.data.notes.map((n: { body: string }) => n.body)).toContain('from source');

    const [merged] = await getDb().select().from(leads).where(eq(leads.id, source));
    expect(merged).toMatchObject({ mergedIntoLeadId: target, phone: null });

    const timeline = await call(timelineRoute.GET, '/', { headers, params: { id: target } });
    const types = timeline.body.data.map((e: { type: string }) => e.type);
    expect(types).toEqual(expect.arrayContaining(['lead.merged', 'lead.merged_into']));

    // Merged leads are read-only and hidden from the list.
    const edit = await call(leadRoute.PATCH, '/', {
      method: 'PATCH',
      headers,
      params: { id: source },
      body: { fullName: 'x' },
    });
    expect(edit.status).toBe(409);
    const list = await call(leadsRoute.GET, '/api/v1/leads?q=Dup', { headers });
    expect(list.body.data.items.map((l: { id: string }) => l.id)).toEqual([target]);
  });
});

describe('export and erasure', () => {
  it('exports everything stored about a lead (admin) and audits it', async () => {
    const id = await create({ email: 'export@example.test', fullName: 'Export Me' });
    expect(
      (
        await call(exportRoute.GET, '/', {
          headers: await as('sales@example.test'),
          params: { id },
        })
      ).status,
    ).toBe(403);
    const res = await call(exportRoute.GET, '/', {
      headers: await as('admin@example.test'),
      params: { id },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain(`lead-${id}.json`);
    expect(res.body.data.lead.email).toBe('export@example.test');
    expect(res.body.data.stageHistory).toHaveLength(1);
    expect(res.body.data.timeline.length).toBeGreaterThan(0);
  });

  it('erases personal data, keeps anonymous history and blocks re-capture', async () => {
    const id = await create({
      email: 'erase@example.test',
      phone: '+14155550199',
      fullName: 'Erase Me',
      qualification: { reasonForTraining: 'personal story', goals: ['x'] },
    });
    const owner = await as('owner@example.test');
    await call(notesRoute.POST, '/', {
      method: 'POST',
      headers: owner,
      params: { id },
      body: { body: 'private note' },
    });
    await linkChannelIdentity(getDb(), {
      organizationId: orgId,
      leadId: id,
      channel: 'whatsapp',
      externalId: '14155550199',
      actor: { type: 'system' },
    });

    const res = await call(leadRoute.DELETE, '/', {
      method: 'DELETE',
      headers: owner,
      params: { id },
    });
    expect(res.status).toBe(200);

    const [lead] = await getDb().select().from(leads).where(eq(leads.id, id));
    expect(lead).toMatchObject({ fullName: null, email: null, phone: null, stage: 'NEW_LEAD' });
    expect(lead!.erasedAt).not.toBeNull();
    expect(await getDb().$count(leadNotes, eq(leadNotes.leadId, id))).toBe(0);
    expect(await getDb().$count(channelIdentities, eq(channelIdentities.leadId, id))).toBe(0);
    expect(await getDb().$count(consents, eq(consents.leadId, id))).toBe(0);
    expect(await getDb().$count(stageTransitions, eq(stageTransitions.leadId, id))).toBe(1);
    expect(await getDb().$count(suppressionList)).toBeGreaterThanOrEqual(2);

    // Nothing personal remains anywhere for this lead.
    const exported = await call(exportRoute.GET, '/', { headers: owner, params: { id } });
    const dump = JSON.stringify(exported.body);
    for (const value of [
      'erase@example.test',
      '+14155550199',
      'Erase Me',
      'personal story',
      'private note',
    ]) {
      expect(dump).not.toContain(value);
    }

    // Erased leads cannot be edited or erased again, and do not come back via the form.
    expect(
      (
        await call(leadRoute.PATCH, '/', {
          method: 'PATCH',
          headers: owner,
          params: { id },
          body: { fullName: 'x' },
        })
      ).status,
    ).toBe(409);
    expect(
      (await call(leadRoute.DELETE, '/', { method: 'DELETE', headers: owner, params: { id } }))
        .status,
    ).toBe(409);

    const resubmit = await call(publicRoute.POST, '/', {
      method: 'POST',
      headers: { 'x-forwarded-for': '198.51.100.7' },
      body: {
        email: 'erase@example.test',
        ageConfirmed18plus: true,
        consent: { wordingVersion: CURRENT_CONSENT_WORDING.version, marketingEmail: true },
      },
    });
    expect(resubmit.status).toBe(202);
    expect(await getDb().$count(leads, eq(leads.email, 'erase@example.test'))).toBe(0);

    const staffCreate = await call(leadsRoute.POST, '/', {
      method: 'POST',
      headers: owner,
      body: { email: 'erase@example.test' },
    });
    expect(staffCreate.status).toBe(409);
  });
});

describe('channel identities', () => {
  it('links an identity to one lead per organization', async () => {
    const a = await create({ email: 'ident-a@example.test' });
    const b = await create({ email: 'ident-b@example.test' });
    const actor = { type: 'system' } as const;
    const db = getDb();
    await linkChannelIdentity(db, {
      organizationId: orgId,
      leadId: a,
      channel: 'instagram',
      externalId: 'ig-1',
      actor,
    });
    expect((await findLeadByChannelIdentity(db, orgId, 'instagram', 'ig-1'))?.leadId).toBe(a);
    expect(await findLeadByChannelIdentity(db, otherOrgId, 'instagram', 'ig-1')).toBeUndefined();
    await expect(
      linkChannelIdentity(db, {
        organizationId: orgId,
        leadId: b,
        channel: 'instagram',
        externalId: 'ig-1',
        actor,
      }),
    ).rejects.toThrow('another lead');
    await expect(
      linkChannelIdentity(db, {
        organizationId: otherOrgId,
        leadId: a,
        channel: 'instagram',
        externalId: 'ig-2',
        actor,
      }),
    ).rejects.toThrow('Lead not found');
  });
});

describe('append-only history', () => {
  it('blocks UPDATE and DELETE on lead_events and stage_transitions', async () => {
    const id = await create({ email: 'append@example.test' });
    const db = getDb();
    await expect(
      db.update(leadEvents).set({ type: 'tampered' }).where(eq(leadEvents.leadId, id)),
    ).rejects.toThrow();
    await expect(db.delete(leadEvents).where(eq(leadEvents.leadId, id))).rejects.toThrow();
    await expect(
      db.update(stageTransitions).set({ reason: 'x' }).where(eq(stageTransitions.leadId, id)),
    ).rejects.toThrow();
    await expect(
      db.execute(sql`delete from stage_transitions where lead_id = ${id}`),
    ).rejects.toThrow();
    expect(await db.$count(leadEvents, eq(leadEvents.leadId, id))).toBe(1);
  });
});
