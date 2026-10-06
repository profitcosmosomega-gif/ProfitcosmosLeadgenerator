import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError, Errors, toErrorResponse } from '@/lib/errors';

describe('toErrorResponse', () => {
  it('maps AppError codes to HTTP statuses', () => {
    expect(toErrorResponse(Errors.unauthenticated()).status).toBe(401);
    expect(toErrorResponse(Errors.forbidden()).status).toBe(403);
    expect(toErrorResponse(Errors.notFound()).status).toBe(404);
    expect(toErrorResponse(Errors.conflict()).status).toBe(409);
    expect(toErrorResponse(Errors.unavailable()).status).toBe(503);
  });

  it('includes details and request id for AppError', () => {
    const { body } = toErrorResponse(new AppError('VALIDATION_ERROR', 'bad', { field: 'x' }), 'r1');
    expect(body).toEqual({
      error: { code: 'VALIDATION_ERROR', message: 'bad', details: { field: 'x' }, requestId: 'r1' },
    });
  });

  it('maps ZodError to a 400 with issue paths', () => {
    const result = z.object({ email: z.email() }).safeParse({ email: 'nope' });
    const { status, body } = toErrorResponse(result.error);
    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual([{ path: ['email'], message: expect.any(String) }]);
  });

  it('never leaks unknown error messages', () => {
    const { status, body } = toErrorResponse(new Error('db password is hunter2'), 'r2');
    expect(status).toBe(500);
    expect(body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: 'r2' },
    });
  });
});
