import { getEnv } from './env';

/**
 * Fixed-window, in-memory rate limiter. Counts are per process, so with several web instances
 * each enforces its own limit. Good enough for spam protection on the public form; move to a
 * shared store if the app is scaled out.
 */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true if the request is allowed. */
  take(key: string, now = Date.now()): boolean {
    if (this.hits.size > 10_000) this.sweep(now);
    const entry = this.hits.get(key);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count++;
    return entry.count <= this.limit;
  }

  reset(): void {
    this.hits.clear();
  }

  private sweep(now: number) {
    for (const [key, entry] of this.hits) {
      if (entry.resetAt <= now) this.hits.delete(key);
    }
  }
}

const globalForLimiter = globalThis as unknown as { __pcPublicFormLimiter?: RateLimiter };

/** Shared per-IP limiter for the public lead form (PUBLIC_FORM_RATE_LIMIT_PER_MINUTE). */
export function publicFormLimiter(): RateLimiter {
  globalForLimiter.__pcPublicFormLimiter ??= new RateLimiter(
    getEnv().PUBLIC_FORM_RATE_LIMIT_PER_MINUTE,
    60_000,
  );
  return globalForLimiter.__pcPublicFormLimiter;
}

const globalLimiters = globalThis as unknown as { __pcLimiters?: Map<string, RateLimiter> };

/** A process-wide limiter, created on first use. Same per-process caveat as above. */
export function sharedLimiter(name: string, limit: number, windowMs = 60_000): RateLimiter {
  globalLimiters.__pcLimiters ??= new Map();
  let limiter = globalLimiters.__pcLimiters.get(name);
  if (!limiter) {
    limiter = new RateLimiter(limit, windowMs);
    globalLimiters.__pcLimiters.set(name, limiter);
  }
  return limiter;
}

/** Clear every shared limiter (tests). */
export function resetSharedLimiters(): void {
  for (const limiter of globalLimiters.__pcLimiters?.values() ?? []) limiter.reset();
}
