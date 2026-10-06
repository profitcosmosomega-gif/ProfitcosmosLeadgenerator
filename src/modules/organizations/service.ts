import { eq } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { organizations, type Organization } from '@/db/schema';
import { getEnv } from '@/lib/env';
import { Errors } from '@/lib/errors';

/**
 * Single-tenant for now: the whole system operates on the organization named by
 * DEFAULT_ORGANIZATION_SLUG. Callers should still pass organization ids explicitly
 * so multi-tenancy can be introduced later without changing call sites.
 */
export async function getDefaultOrganization(db: Database): Promise<Organization> {
  const slug = getEnv().DEFAULT_ORGANIZATION_SLUG;
  const [org] = await db.select().from(organizations).where(eq(organizations.slug, slug)).limit(1);
  if (!org) {
    throw Errors.unavailable(`Default organization "${slug}" not found. Run "pnpm db:seed".`);
  }
  return org;
}
