import { signInHeaders } from './auth';
import { TEST_PASSWORD } from './db';

type Handler = (
  req: Request,
  route: { params: Promise<Record<string, string>> },
) => Promise<Response>;

export interface CallOptions {
  method?: string;
  headers?: Headers | Record<string, string>;
  body?: unknown;
  params?: Record<string, string>;
}

/** Invoke a Next.js route handler directly and return status + parsed JSON body. */
export async function call(handler: Handler, path: string, options: CallOptions = {}) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const res = await handler(
    new Request(`http://localhost${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
    { params: Promise.resolve(options.params ?? {}) },
  );
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json: any = text ? JSON.parse(text) : null;
  return { status: res.status, body: json, headers: res.headers };
}

const sessionCache = new Map<string, Headers>();

/** Session headers for a test staff user (cached per email for speed). */
export async function as(email: string): Promise<Headers> {
  const cached = sessionCache.get(email);
  if (cached) return cached;
  const headers = await signInHeaders(email, TEST_PASSWORD);
  sessionCache.set(email, headers);
  return headers;
}

export function clearSessions(): void {
  sessionCache.clear();
}
