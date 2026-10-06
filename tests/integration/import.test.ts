import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as importsRoute from '@/app/api/v1/imports/route';
import * as leadsRoute from '@/app/api/v1/leads/route';
import { closeDb, getDb } from '@/db/client';
import { consents, leadImports, leads } from '@/db/schema';
import { as, call, clearSessions } from '../helpers/http';
import { createOrg, createStaff, resetDb } from '../helpers/db';

let orgId: string;

beforeAll(async () => {
  await resetDb();
  clearSessions();
  orgId = (await createOrg()).id;
  for (const role of ['sales', 'admin'] as const) await createStaff(role, orgId);
  // An existing lead the import should update, not duplicate.
  await call(leadsRoute.POST, '/', {
    method: 'POST',
    headers: await as('sales@example.test'),
    body: { email: 'existing@example.test', fullName: 'Kept Name' },
  });
});
afterAll(closeDb);

const CSV = [
  'Name,Email,Phone,Country,UTM Source,Experience,Markets,Marketing Email Consent,Favourite Colour',
  'Ann One,ann@example.test,+44 20 7946 0001,gb,facebook,Beginner,forex;indices,yes,blue',
  'Changed Name,existing@example.test,,,,,,,',
  'Ann Again,ANN@example.test,,,,,,no,',
  'No Contact,,,,,,,,',
  'Bad Phone,bad@example.test,0207946,,,,,,',
].join('\n');

function runImport(dryRun: boolean, email = 'admin@example.test', csv = CSV) {
  return as(email).then((headers) =>
    call(importsRoute.POST, '/api/v1/imports', {
      method: 'POST',
      headers,
      body: { csv, fileName: 'leads.csv', dryRun },
    }),
  );
}

describe('CSV import', () => {
  it('is admin-only', async () => {
    expect((await runImport(true, 'sales@example.test')).status).toBe(403);
  });

  it('previews without writing anything', async () => {
    const before = await getDb().$count(leads);
    const res = await runImport(true);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      dryRun: true,
      counts: { rows: 5, created: 1, updated: 2, skipped: 0, errors: 2 },
      unknownColumns: ['Favourite Colour'],
    });
    expect(res.body.data.rows.map((r: { outcome: string }) => r.outcome)).toEqual([
      'created',
      'updated',
      'updated', // same email as row 2 of the file
      'error',
      'error',
    ]);
    expect(await getDb().$count(leads)).toBe(before);
    expect(await getDb().$count(leadImports)).toBe(0);
  });

  it('commits exactly what the preview showed', async () => {
    const res = await runImport(false);
    expect(res.status).toBe(201);
    expect(res.body.data.counts).toEqual({
      rows: 5,
      created: 1,
      updated: 2,
      skipped: 0,
      errors: 2,
    });
    expect(res.body.data.importId).toBeTruthy();

    const [ann] = await getDb().select().from(leads).where(eq(leads.email, 'ann@example.test'));
    expect(ann).toMatchObject({
      fullName: 'Ann One',
      phone: '+442079460001',
      country: 'GB',
      source: 'facebook',
    });
    const [existing] = await getDb()
      .select()
      .from(leads)
      .where(eq(leads.email, 'existing@example.test'));
    expect(existing!.fullName).toBe('Kept Name');

    const annConsents = await getDb().select().from(consents).where(eq(consents.leadId, ann!.id));
    expect(annConsents).toEqual([
      expect.objectContaining({
        channel: 'email',
        purpose: 'marketing',
        status: 'granted',
        source: 'import',
      }),
    ]);
  });

  it('rejects a CSV without email or phone columns', async () => {
    const res = await runImport(true, 'admin@example.test', 'name,country\nA,GB');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
