import { z } from 'zod';

const booleanFromString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),

  // Single-tenant for now: every record belongs to this organization.
  DEFAULT_ORGANIZATION_SLUG: z.string().min(1).default('profitcosmos-omega'),

  // Public lead form: extra origins allowed to post (comma-separated), and per-IP limit per minute.
  PUBLIC_FORM_ORIGINS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.url())),
  PUBLIC_FORM_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),

  EMAIL_PROVIDER: z.enum(['smtp', 'console']).default('console'),
  EMAIL_FROM: z.string().min(3).default('ProfitCosmos Omega <no-reply@localhost>'),
  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: booleanFromString.default(false),

  // AI is not used in Phase 1. Kill-switch defaults to off.
  AI_ENABLED: booleanFromString.default(false),
  ANTHROPIC_API_KEY: z.string().optional(),
  LLM_MODEL_CONVERSATION: z.string().optional(),
  LLM_MODEL_EXTRACTION: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvValidationError';
  }
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  // Treat empty strings as unset so `.env` files can leave values blank.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return result.data;
}

let cached: Env | undefined;

/** Validated environment. Parsed lazily so `next build` does not need runtime secrets. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}

/** Test-only: forget the cached env so changes to process.env are picked up. */
export function resetEnvCache(): void {
  cached = undefined;
}
