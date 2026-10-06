import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as transitionRoute from '@/app/api/v1/leads/[id]/transition/route';
import * as leadsRoute from '@/app/api/v1/leads/route';
import { closeDb, getDb } from '@/db/client';
import { auditLog, leadEvents, stageTransitions } from '@/db/schema';
import { as, call, clearSessions } from '../helpers/http';
import { createOrg, createStaff, resetDb } from '../helpers/db';

let counter = 0;

beforeAll(async () => {
  await resetDb();
  clearSessions();
  const org = await createOrg();
  for (const role of ['viewer', 'sales'] as const) await createStaff(role, org.id);
  const other = await createOrg('other-academy');
  await createStaff('owner', other.id, 'b-');
});
afterAll(closeDb);

async function newLeadId(): Promise<string> {
  const res = await call(leadsRoute.POST, '/', {
    method: 'POST',
    headers: await as('sales@example.test'),
    body: { email: `crm${++counter}@example.test` },
  });
  return res.body.data.id;
}

async function move(id: string, to: string, reason?: string, email = 'sales@example.test') {
  return call(transitionRoute.POST, '/', {
    method: 'POST',
    headers: await as(email),
    params: { id },
    body: reason === undefined ? { to } : { to, reason },
  });
}

describe('stage transitions', () => {
  it('walks the main path and records every step', async () => {
    const id = await newLeadId();
    const path = [
      'QUALIFYING',
      'QUALIFIED',
      'CONSULTATION_BOOKED',
      'CONSULTATION_COMPLETED',
      'ENROLLMENT_PENDING',
      'ENROLLED',
    ];
    for (const to of path) {
      const res = await move(id, to);
      expect(res.status).toBe(200);
      expect(res.body.data.stage).toBe(to);
    }

    const db = getDb();
    const history = await db
      .select()
      .from(stageTransitions)
      .where(eq(stageTransitions.leadId, id))
      .orderBy(stageTransitions.createdAt);
    expect(history.map((h) => [h.fromStage, h.toStage])).toEqual([
      [null, 'NEW_LEAD'],
      ['NEW_LEAD', 'QUALIFYING'],
      ['QUALIFYING', 'QUALIFIED'],
      ['QUALIFIED', 'CONSULTATION_BOOKED'],
      ['CONSULTATION_BOOKED', 'CONSULTATION_COMPLETED'],
      ['CONSULTATION_COMPLETED', 'ENROLLMENT_PENDING'],
      ['ENROLLMENT_PENDING', 'ENROLLED'],
    ]);

    const events = await db
      .select()
      .from(leadEvents)
      .where(and(eq(leadEvents.leadId, id), eq(leadEvents.type, 'stage.changed')));
    expect(events).toHaveLength(path.length);
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entityId, id), eq(auditLog.action, 'stage.changed')));
    expect(audits).toHaveLength(path.length);

    // ENROLLED is final.
    const after = await move(id, 'NURTURE', 'changed mind');
    expect(after.status).toBe(409);
    expect(after.body.error.code).toBe('INVALID_STATE_TRANSITION');
  });

  it('rejects skipping stages with the typed error and allowed list', async () => {
    const id = await newLeadId();
    const res = await move(id, 'ENROLLED');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({
      code: 'INVALID_STATE_TRANSITION',
      details: {
        from: 'NEW_LEAD',
        to: 'ENROLLED',
        allowed: ['ENGAGED', 'QUALIFYING', 'NURTURE', 'LOST'],
      },
    });
    const history = await getDb()
      .select()
      .from(stageTransitions)
      .where(eq(stageTransitions.leadId, id));
    expect(history).toHaveLength(1);
  });

  it('rejects moving to the current stage', async () => {
    const id = await newLeadId();
    expect((await move(id, 'NEW_LEAD')).status).toBe(409);
  });

  it('requires a reason for LOST and NURTURE, and stores it as the outcome', async () => {
    const id = await newLeadId();
    const missing = await move(id, 'LOST');
    expect(missing.status).toBe(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');

    const lost = await move(id, 'LOST', 'not interested');
    expect(lost.status).toBe(200);
    expect(lost.body.data.outcomeReason).toBe('not interested');

    const reopened = await move(id, 'NURTURE', 'asked to be contacted next year');
    expect(reopened.body.data).toMatchObject({
      stage: 'NURTURE',
      outcomeReason: 'asked to be contacted next year',
    });

    const engaged = await move(id, 'ENGAGED');
    expect(engaged.body.data.outcomeReason).toBeNull();
  });

  it('rejects unknown stages', async () => {
    const id = await newLeadId();
    expect((await move(id, 'WON')).status).toBe(400);
  });

  it('forbids viewers (403) and other organizations (404)', async () => {
    const id = await newLeadId();
    expect((await move(id, 'ENGAGED', undefined, 'viewer@example.test')).status).toBe(403);
    expect((await move(id, 'ENGAGED', undefined, 'b-owner@example.test')).status).toBe(404);
  });

  it('serialises concurrent transitions on the same lead', async () => {
    const id = await newLeadId();
    const results = await Promise.all([move(id, 'ENGAGED'), move(id, 'QUALIFYING')]);
    const ok = results.filter((r) => r.status === 200);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const history = await getDb()
      .select()
      .from(stageTransitions)
      .where(eq(stageTransitions.leadId, id));
    // Every recorded transition chains from the previous one.
    const sorted = history.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.fromStage).toBe(sorted[i - 1]!.toStage);
    }
  });
});
