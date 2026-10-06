import { describe, expect, it } from 'vitest';
import { RateLimiter } from '@/lib/rate-limit';

describe('RateLimiter', () => {
  it('allows up to the limit per window, per key', () => {
    const limiter = new RateLimiter(2, 1000);
    expect(limiter.take('a', 0)).toBe(true);
    expect(limiter.take('a', 10)).toBe(true);
    expect(limiter.take('a', 20)).toBe(false);
    expect(limiter.take('b', 20)).toBe(true);
  });

  it('resets after the window', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.take('a', 0)).toBe(true);
    expect(limiter.take('a', 500)).toBe(false);
    expect(limiter.take('a', 1000)).toBe(true);
  });
});
