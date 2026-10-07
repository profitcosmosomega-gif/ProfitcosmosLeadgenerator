import { getEnv } from './env';
import { Errors } from './errors';

/*
 * Helpers for the unauthenticated public endpoints (lead form, chat): origin allow-list, CORS,
 * client IP and size-limited JSON bodies.
 */

function allowedOrigins(): Set<string> {
  const env = getEnv();
  return new Set([env.APP_URL, ...env.PUBLIC_FORM_ORIGINS].map((url) => new URL(url).origin));
}

/** Browsers from other sites are refused; requests without an Origin (server-to-server) pass. */
export function assertAllowedOrigin(req: Request): void {
  const origin = req.headers.get('origin');
  if (origin && !allowedOrigins().has(origin)) throw Errors.forbidden('Origin not allowed');
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export function withCors(req: Request, res: Response): Response {
  const origin = req.headers.get('origin');
  if (origin && allowedOrigins().has(origin)) {
    res.headers.set('access-control-allow-origin', origin);
    res.headers.set('vary', 'Origin');
  }
  return res;
}

/** CORS preflight response for an allowed origin. */
export function preflight(req: Request, methods: string, headers: string): Response {
  const res = new Response(null, { status: 204 });
  const origin = req.headers.get('origin');
  if (origin && allowedOrigins().has(origin)) {
    res.headers.set('access-control-allow-origin', origin);
    res.headers.set('access-control-allow-methods', methods);
    res.headers.set('access-control-allow-headers', headers);
    res.headers.set('access-control-max-age', '600');
    res.headers.set('vary', 'Origin');
  }
  return res;
}

/** Parse a JSON body, enforcing the size limit on the bytes actually received. */
export async function readJsonBody(req: Request, maxBytes: number): Promise<unknown> {
  const raw = await req.text();
  if (Buffer.byteLength(raw) > maxBytes) throw Errors.validation('Request body too large');
  try {
    return JSON.parse(raw);
  } catch {
    throw Errors.validation('Request body must be valid JSON');
  }
}
