import { asc, eq } from 'drizzle-orm';
import type { Database } from '@/db/client';
import { users } from '@/db/schema';

/** Staff members of an organization (for owner pickers). No contact details. */
export async function listStaff(db: Database, organizationId: string) {
  return db
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(eq(users.organizationId, organizationId))
    .orderBy(asc(users.name));
}
