/** Environment used by every test run. Override the database with TEST_DATABASE_URL. */
export const TEST_ENV = {
  NODE_ENV: 'test',
  APP_URL: 'http://localhost:3000',
  LOG_LEVEL: 'silent',
  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    'postgres://postgres:postgres@localhost:5432/profitcosmos_test',
  BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
  DEFAULT_ORGANIZATION_SLUG: 'profitcosmos-omega',
  EMAIL_PROVIDER: 'console',
} as const;

export function applyTestEnv(): void {
  Object.assign(process.env, TEST_ENV);
}
