import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GET as getAuditLog } from '@/app/api/v1/admin/audit-log/route';
import { GET as getMe } from '@/app/api/v1/me/route';
import { closeDb, getDb } from '@/db/client';
import { auditLog } from '@/db/schema';
import { getAuth } from '@/lib/auth';
import { noRouteParams, signInHeaders } from '../helpers/auth';
import { createOrg, createStaff, resetDb, TEST_PASSWORD } from '../helpers/db';

let orgId: string;

beforeAll(async () => {
  await resetDb();
  orgId = (await createOrg()).id;
  await Promise.all(
    (['viewer', 'sales', 'admin', 'owner'] as const).map((role) => createStaff(role, orgId)),
  );
});
afterAll(closeDb);

const request = (path: string, headers?: Headers) =>
  new Request(`http://localhost${path}`, { headers });

describe('staff authentication', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const res = await getMe(request('/api/v1/me'), noRouteParams);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a forged session cookie with 401', async () => {
    const headers = new Headers({ cookie: 'better-auth.session_token=forged.value' });
    const res = await getMe(request('/api/v1/me', headers), noRouteParams);
    expect(res.status).toBe(401);
  });

  it('rejects a wrong password', async () => {
    await expect(signInHeaders('viewer@example.test', 'wrong-password-123')).rejects.toThrow();
  });

  it('disables public sign-up', async () => {
    await expect(
      getAuth().api.signUpEmail({
        body: { email: 'new@example.test', password: 'another-long-password', name: 'New' },
      }),
    ).rejects.toThrow();
  });

  it('returns the signed-in user with role and organization', async () => {
    const headers = await signInHeaders('sales@example.test', TEST_PASSWORD);
    const res = await getMe(request('/api/v1/me', headers), noRouteParams);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({
      email: 'sales@example.test',
      role: 'sales',
      organizationId: orgId,
    });
  });

  it('records sign-ins in the audit log', async () => {
    await signInHeaders('owner@example.test', TEST_PASSWORD);
    const entries = await getDb()
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.organizationId, orgId), eq(auditLog.action, 'auth.sign_in')));
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe('role-based access control', () => {
  it.each(['viewer', 'sales'] as const)('forbids %s from admin-only routes (403)', async (role) => {
    const headers = await signInHeaders(`${role}@example.test`, TEST_PASSWORD);
    const res = await getAuditLog(request('/api/v1/admin/audit-log', headers), noRouteParams);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('FORBIDDEN');
  });

  it.each(['admin', 'owner'] as const)('allows %s on admin-only routes', async (role) => {
    const headers = await signInHeaders(`${role}@example.test`, TEST_PASSWORD);
    const res = await getAuditLog(
      request('/api/v1/admin/audit-log?limit=5', headers),
      noRouteParams,
    );
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.length).toBeLessThanOrEqual(5);
  });

  it('validates query parameters', async () => {
    const headers = await signInHeaders('admin@example.test', TEST_PASSWORD);
    const res = await getAuditLog(
      request('/api/v1/admin/audit-log?limit=0', headers),
      noRouteParams,
    );
    expect(res.status).toBe(400);
  });
});
