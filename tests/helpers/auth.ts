import { getAuth } from '@/lib/auth';

/** Sign in through Better Auth and return request headers carrying the session cookie. */
export async function signInHeaders(email: string, password: string): Promise<Headers> {
  const { headers } = await getAuth().api.signInEmail({
    body: { email, password },
    returnHeaders: true,
  });
  const cookies = headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
  return new Headers({ cookie: cookies });
}

export const noRouteParams = { params: Promise.resolve({}) };
