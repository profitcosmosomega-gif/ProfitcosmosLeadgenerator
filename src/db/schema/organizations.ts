import { pgTable, text } from 'drizzle-orm/pg-core';
import { createdAt, id, updatedAt } from './columns';

/**
 * Tenant boundary. The system runs single-tenant for now (one seeded organization);
 * `organization_id` exists on core tables so multi-tenancy can be added later without a rewrite.
 */
export const organizations = pgTable('organizations', {
  id: id(),
  slug: text().notNull().unique(),
  name: text().notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export type Organization = typeof organizations.$inferSelect;
