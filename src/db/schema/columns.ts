import { timestamp, uuid } from 'drizzle-orm/pg-core';
import { newId } from '../../lib/ids';

/** UUID v7 primary key generated in the application. */
export const id = () =>
  uuid()
    .primaryKey()
    .$defaultFn(() => newId());

export const createdAt = () => timestamp({ withTimezone: true }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp({ withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());
