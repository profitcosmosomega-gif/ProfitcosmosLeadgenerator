import { index, jsonb, pgEnum, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, id } from './columns';
import { users } from './auth';
import { organizations } from './organizations';

export const auditActorType = pgEnum('audit_actor_type', ['user', 'system']);

/**
 * Append-only record of who did what to which record. Never updated.
 * Do not store personal data in `metadata`; reference records by id.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    actorType: auditActorType().notNull(),
    actorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    action: text().notNull(),
    entityType: text(),
    entityId: text(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    requestId: text(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.organizationId, t.createdAt),
    index().on(t.entityType, t.entityId),
    index().on(t.actorUserId),
  ],
);

export type AuditLogEntry = typeof auditLog.$inferSelect;
export type NewAuditLogEntry = typeof auditLog.$inferInsert;
