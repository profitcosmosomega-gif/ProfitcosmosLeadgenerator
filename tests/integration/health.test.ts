import { afterAll, describe, expect, it } from 'vitest';
import { GET } from '@/app/api/health/route';
import { closeDb } from '@/db/client';
import { noRouteParams } from '../helpers/auth';

afterAll(closeDb);

describe('GET /api/health', () => {
  it('reports database and queue as ok', async () => {
    const res = await GET(new Request('http://localhost/api/health'), noRouteParams);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.status).toBe('ok');
    expect(data.checks).toEqual({ database: { status: 'ok' }, queue: { status: 'ok' } });
  });
});
