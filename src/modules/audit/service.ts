import { desc, eq } from 'drizzle-orm';
import type { Database, DbExecutor } from '@/db/client';
import { auditLog, type AuditLogEntry, type NewAuditLogEntry } from '@/db/schema';

export type AuditInput = Omit<NewAuditLogEntry, 'id' | 'createdAt'>;

/** Append an entry to the audit log. Never pass personal data in `metadata`. */
export async function recordAudit(db: DbExecutor, entry: AuditInput): Promise<void> {
  await db.insert(auditLog).values(entry);
}

export async function listRecentAudit(
  db: Database,
  organizationId: string,
  limit = 50,
): Promise<AuditLogEntry[]> {
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.organizationId, organizationId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}
