import type { z } from 'zod';
import { newId } from './ids';
import { toErrorResponse, Errors } from './errors';
import { logger, type Logger } from './logger';
import type { StaffRole } from './rbac';
import { requireStaffUser, type StaffUser } from './session';

export const REQUEST_ID_HEADER = 'x-request-id';

export interface ApiContext {
  requestId: string;
  log: Logger;
}

export interface AuthedApiContext extends ApiContext {
  user: StaffUser;
}

type RouteParams = { params: Promise<Record<string, string | string[]>> };

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function resolveRequestId(req: Request): string {
  const incoming = req.headers.get(REQUEST_ID_HEADER);
  return incoming && REQUEST_ID_PATTERN.test(incoming) ? incoming : newId();
}

export function json<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ data }, init);
}

/**
 * Wrap a route handler with request ids, structured logging and the standard error envelope.
 * Handlers return a Response (use `json()` for the `{ data }` envelope).
 */
export function apiHandler(
  handler: (req: Request, ctx: ApiContext, route: RouteParams) => Promise<Response>,
) {
  return async (req: Request, route: RouteParams): Promise<Response> => {
    const requestId = resolveRequestId(req);
    const log = logger.child({ requestId, method: req.method, path: new URL(req.url).pathname });
    const started = performance.now();
    let response: Response;
    try {
      response = await handler(req, { requestId, log }, route);
    } catch (error) {
      const { status, body } = toErrorResponse(error, requestId);
      if (status >= 500) log.error({ err: error }, 'request failed');
      else log.warn({ code: body.error.code }, 'request rejected');
      response = Response.json(body, { status });
    }
    response.headers.set(REQUEST_ID_HEADER, requestId);
    log.info(
      { status: response.status, durationMs: Math.round(performance.now() - started) },
      'request completed',
    );
    return response;
  };
}

/** Like `apiHandler`, but requires a signed-in staff user with at least `minRole`. */
export function authedApiHandler(
  minRole: StaffRole,
  handler: (req: Request, ctx: AuthedApiContext, route: RouteParams) => Promise<Response>,
) {
  return apiHandler(async (req, ctx, route) => {
    const user = await requireStaffUser(req.headers, minRole);
    return handler(req, { ...ctx, user, log: ctx.log.child({ userId: user.id }) }, route);
  });
}

/** Parse and validate a JSON request body. */
export async function parseJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw Errors.validation('Request body must be valid JSON');
  }
  return schema.parse(body);
}

/** Parse and validate URL search params. */
export function parseQuery<S extends z.ZodType>(req: Request, schema: S): z.infer<S> {
  return schema.parse(Object.fromEntries(new URL(req.url).searchParams));
}
