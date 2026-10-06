import { describe, expect, it } from 'vitest';
import { hashContact, normalizeEmail, normalizePhone } from '@/modules/leads/normalize';

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Jane.Doe@Example.COM ')).toBe('jane.doe@example.com');
  });
  it('rejects invalid addresses', () => {
    expect(normalizeEmail('not-an-email')).toBeNull();
  });
});

describe('normalizePhone', () => {
  it.each([
    ['+44 20 7946 0958', '+442079460958'],
    ['0044 (20) 7946-0958', '+442079460958'],
    ['+1.415.555.2671', '+14155552671'],
  ])('normalises %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['020 7946 0958', '+0 123 456 789', '+12', 'call me', '+1234567890123456'])(
    'rejects %s',
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );
});

describe('hashContact', () => {
  it('is stable and does not contain the value', () => {
    const hash = hashContact('jane@example.com');
    expect(hash).toBe(hashContact('jane@example.com'));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('jane');
  });
});
