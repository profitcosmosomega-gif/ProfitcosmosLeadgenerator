import { z } from 'zod';
import { closeDb, getDb } from '../src/db/client';
import { seedFoundation } from '../src/db/seed';
import { getEnv } from '../src/lib/env';
import { logger } from '../src/lib/logger';

const seedEnv = z.object({
  SEED_ORGANIZATION_NAME: z.string().min(1).default('ProfitCosmos Omega Academy'),
  SEED_OWNER_EMAIL: z.email(),
  SEED_OWNER_NAME: z.string().min(1).default('Owner'),
  SEED_OWNER_PASSWORD: z.string().min(12, 'SEED_OWNER_PASSWORD must be at least 12 characters'),
});

try {
  const env = getEnv();
  const seed = seedEnv.parse(process.env);
  const { organization, owner } = await seedFoundation(getDb(), {
    organization: { slug: env.DEFAULT_ORGANIZATION_SLUG, name: seed.SEED_ORGANIZATION_NAME },
    owner: {
      email: seed.SEED_OWNER_EMAIL,
      name: seed.SEED_OWNER_NAME,
      password: seed.SEED_OWNER_PASSWORD,
    },
  });
  logger.info({ organizationId: organization.id, ownerUserId: owner.id }, 'seed complete');
} catch (err) {
  logger.fatal({ err }, 'seed failed');
  process.exitCode = 1;
} finally {
  await closeDb();
}
