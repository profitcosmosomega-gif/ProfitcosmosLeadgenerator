import { sql } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { ensureOrganization, ensureStaffUser } from '@/db/seed';
import type { StaffRole } from '@/lib/rbac';
import { TEST_ENV } from '../test-env';

/** Remove all application data (keeps schema and migrations). */
export async function resetDb(): Promise<void> {
  await getDb().execute(
    sql`truncate table
      conversation_escalations, messages, ai_runs, conversations,
      lead_imports, channel_identities, touchpoints, suppression_list, consents, lead_notes,
      stage_transitions, lead_events, lead_qualification, leads,
      audit_log, verifications, accounts, sessions, users, organizations cascade`,
  );
}

export const TEST_PASSWORD = 'correct-horse-battery-staple';

export async function createOrg(slug: string = TEST_ENV.DEFAULT_ORGANIZATION_SLUG) {
  return ensureOrganization(getDb(), { slug, name: `Org ${slug}` });
}

export async function createStaff(role: StaffRole, organizationId: string, prefix = '') {
  return ensureStaffUser(getDb(), {
    organizationId,
    email: `${prefix}${role}@example.test`,
    name: `Test ${prefix}${role}`,
    password: TEST_PASSWORD,
    role,
  });
}
