import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { ensureOrganization, ensureStaffUser } from '@/db/seed';
import type { StaffRole } from '@/lib/rbac';
import { TEST_ENV } from '../test-env';

/** Remove all application data (keeps schema and migrations). */
export async function resetDb(): Promise<void> {
  await getDb().execute(
    sql`truncate table audit_log, verifications, accounts, sessions, users, organizations cascade`,
  );
}

export const TEST_PASSWORD = 'correct-horse-battery-staple';

export async function createOrg() {
  return ensureOrganization(getDb(), {
    slug: TEST_ENV.DEFAULT_ORGANIZATION_SLUG,
    name: 'ProfitCosmos Omega Academy',
  });
}

export async function createStaff(role: StaffRole, organizationId: string) {
  return ensureStaffUser(getDb(), {
    organizationId,
    email: `${role}@example.test`,
    name: `Test ${role}`,
    password: TEST_PASSWORD,
    role,
  });
}
