import { boolean, index, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { STAFF_ROLES } from '../../lib/rbac';
import { createdAt, id, updatedAt } from './columns';
import { organizations } from './organizations';

/*
 * Tables used by Better Auth (staff authentication only — prospects never log in).
 * Property names follow Better Auth's field names; columns are snake_case.
 */

export const staffRole = pgEnum('staff_role', STAFF_ROLES);

export const users = pgTable(
  'users',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    name: text().notNull(),
    email: text().notNull().unique(),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    role: staffRole().notNull().default('viewer'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.organizationId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    token: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    ipAddress: text(),
    userAgent: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.userId)],
);

export const accounts = pgTable(
  'accounts',
  {
    id: id(),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accountId: text().notNull(),
    providerId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestamp({ withTimezone: true }),
    refreshTokenExpiresAt: timestamp({ withTimezone: true }),
    scope: text(),
    password: text(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.userId)],
);

export const verifications = pgTable(
  'verifications',
  {
    id: id(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index().on(t.identifier)],
);

export type User = typeof users.$inferSelect;
