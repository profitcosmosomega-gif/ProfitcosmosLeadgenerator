import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '@/lib/env';

const valid = {
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
};

describe('parseEnv', () => {
  it('applies defaults for optional values', () => {
    const env = parseEnv(valid);
    expect(env.NODE_ENV).toBe('development');
    expect(env.EMAIL_PROVIDER).toBe('console');
    expect(env.AI_ENABLED).toBe(false);
    expect(env.DEFAULT_ORGANIZATION_SLUG).toBe('profitcosmos-omega');
  });

  it('treats empty strings as unset', () => {
    expect(parseEnv({ ...valid, LOG_LEVEL: '' }).LOG_LEVEL).toBe('info');
  });

  it('parses booleans and numbers from strings', () => {
    const env = parseEnv({ ...valid, AI_ENABLED: 'true', SMTP_PORT: '2525' });
    expect(env.AI_ENABLED).toBe(true);
    expect(env.SMTP_PORT).toBe(2525);
  });

  it('reports every invalid variable by name', () => {
    expect.assertions(3);
    try {
      parseEnv({ DATABASE_URL: 'mysql://localhost/db', BETTER_AUTH_SECRET: 'short' });
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      const message = (err as Error).message;
      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('BETTER_AUTH_SECRET');
    }
  });
});
