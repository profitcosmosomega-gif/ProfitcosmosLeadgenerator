import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { apiHandler, json, parseJson, REQUEST_ID_HEADER } from '@/lib/api';
import { Errors } from '@/lib/errors';

const route = { params: Promise.resolve({}) };

describe('apiHandler', () => {
  it('wraps data and sets a request id header', async () => {
    const res = await apiHandler(async () => json({ ok: true }))(
      new Request('http://localhost/api/x'),
      route,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { ok: true } });
    expect(res.headers.get(REQUEST_ID_HEADER)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('propagates a well-formed incoming request id', async () => {
    const res = await apiHandler(async () => json(null))(
      new Request('http://localhost/api/x', { headers: { [REQUEST_ID_HEADER]: 'abc-123' } }),
      route,
    );
    expect(res.headers.get(REQUEST_ID_HEADER)).toBe('abc-123');
  });

  it('ignores a malformed incoming request id', async () => {
    const res = await apiHandler(async () => json(null))(
      new Request('http://localhost/api/x', { headers: { [REQUEST_ID_HEADER]: 'bad id\n' } }),
      route,
    );
    expect(res.headers.get(REQUEST_ID_HEADER)).not.toBe('bad id\n');
  });

  it('turns thrown AppErrors into the error envelope', async () => {
    const res = await apiHandler(async () => {
      throw Errors.notFound('Lead not found');
    })(new Request('http://localhost/api/x'), route);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Lead not found' });
    expect(body.error.requestId).toBe(res.headers.get(REQUEST_ID_HEADER));
  });

  it('validates JSON bodies', async () => {
    const schema = z.object({ name: z.string().min(1) });
    const handler = apiHandler(async (req) => json(await parseJson(req, schema)));

    const ok = await handler(
      new Request('http://localhost/api/x', { method: 'POST', body: '{"name":"A"}' }),
      route,
    );
    expect(await ok.json()).toEqual({ data: { name: 'A' } });

    const invalid = await handler(
      new Request('http://localhost/api/x', { method: 'POST', body: '{"name":""}' }),
      route,
    );
    expect(invalid.status).toBe(400);

    const malformed = await handler(
      new Request('http://localhost/api/x', { method: 'POST', body: '{' }),
      route,
    );
    expect(malformed.status).toBe(400);
  });
});
