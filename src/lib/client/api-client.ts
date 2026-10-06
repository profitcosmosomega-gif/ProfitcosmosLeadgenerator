'use client';

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: { code: string; message: string; details?: unknown };
}

/** Call the app's JSON API from the browser and unwrap the `{ data }` / `{ error }` envelope. */
export async function apiFetch<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const res = await fetch(path, {
    method: options.method ?? 'GET',
    headers: options.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data: json?.data, error: json?.error };
}

/** Human-readable message for an API error, including field errors when present. */
export function errorMessage(error: ApiResult<unknown>['error']): string {
  if (!error) return 'Something went wrong';
  const details = Array.isArray(error.details)
    ? (error.details as { path?: unknown[]; message: string }[])
        .map((d) => (d.path?.length ? `${d.path.join('.')}: ${d.message}` : d.message))
        .join('; ')
    : '';
  return details ? `${error.message} (${details})` : error.message;
}
