import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import * as schema from '@/db/schema';
import { recordAudit } from '@/modules/audit/service';
import { getEnv } from './env';
import { newId } from './ids';
import { logger } from './logger';

function createAuth() {
  const env = getEnv();
  const db = getDb();

  return betterAuth({
    appName: 'ProfitCosmos Omega',
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.APP_URL],
    database: drizzleAdapter(db, { provider: 'pg', schema, usePlural: true }),
    emailAndPassword: {
      enabled: true,
      // Staff accounts are provisioned by an owner/admin (or the seed script), never self-registered.
      disableSignUp: true,
      minPasswordLength: 12,
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
    },
    user: {
      additionalFields: {
        role: { type: 'string', input: false, required: false },
        organizationId: { type: 'string', input: false, required: false },
      },
    },
    advanced: {
      database: { generateId: () => newId() },
      useSecureCookies: env.NODE_ENV === 'production',
    },
    rateLimit: { enabled: env.NODE_ENV === 'production' },
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            try {
              const [user] = await db
                .select({ organizationId: schema.users.organizationId })
                .from(schema.users)
                .where(eq(schema.users.id, session.userId));
              if (!user) return;
              await recordAudit(db, {
                organizationId: user.organizationId,
                actorType: 'user',
                actorUserId: session.userId,
                action: 'auth.sign_in',
                entityType: 'session',
                entityId: session.id,
                ipAddress: session.ipAddress ?? null,
                userAgent: session.userAgent ?? null,
              });
            } catch (err) {
              logger.error({ err }, 'failed to audit sign-in');
            }
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

const globalForAuth = globalThis as unknown as { __pcAuth?: Auth };

export function getAuth(): Auth {
  globalForAuth.__pcAuth ??= createAuth();
  return globalForAuth.__pcAuth;
}
