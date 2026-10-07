import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { ALL_STAGES } from '../../../config/pipeline';
import { CHANNEL_KINDS } from '../../modules/channels/types';
import { users } from './auth';
import { createdAt, id, updatedAt } from './columns';
import { organizations } from './organizations';

/*
 * Lead database and CRM (Phase 2).
 * Every table carries organization_id; all queries are scoped by it.
 * `lead_events` and `stage_transitions` are append-only (enforced by database triggers).
 */

export const pipelineStage = pgEnum('pipeline_stage', ALL_STAGES);
export const experienceLevel = pgEnum('experience_level', [
  'unknown',
  'beginner',
  'intermediate',
  'experienced',
]);
export const desiredStart = pgEnum('desired_start', ['unknown', 'now', '30d', '90d', 'later']);
export const mentorshipInterest = pgEnum('mentorship_interest', ['unknown', 'yes', 'maybe', 'no']);
export const actorType = pgEnum('actor_type', ['user', 'system', 'lead', 'ai']);
export const consentChannel = pgEnum('consent_channel', ['email', 'sms', 'whatsapp', 'phone']);
export const consentPurpose = pgEnum('consent_purpose', ['transactional', 'marketing']);
export const consentStatus = pgEnum('consent_status', ['granted', 'revoked']);
export const dataSource = pgEnum('data_source', ['form', 'import', 'staff', 'chat']);
export const suppressionKind = pgEnum('suppression_kind', ['email', 'phone']);
export const channelKind = pgEnum('channel_kind', CHANNEL_KINDS);

export const leads = pgTable(
  'leads',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    fullName: text(),
    /** Lower-cased. */
    email: text(),
    /** E.164. */
    phone: text(),
    country: text(),
    timezone: text(),
    locale: text(),
    ageConfirmed18plus: boolean(),
    /** Changed only by the CRM transition service. */
    stage: pipelineStage().notNull().default('NEW_LEAD'),
    outcomeReason: text(),
    ownerUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    /** Source of the first touchpoint, denormalised for filtering. */
    source: text(),
    firstTouchId: uuid().references((): AnyPgColumn => touchpoints.id, { onDelete: 'set null' }),
    lastTouchId: uuid().references((): AnyPgColumn => touchpoints.id, { onDelete: 'set null' }),
    mergedIntoLeadId: uuid().references((): AnyPgColumn => leads.id, { onDelete: 'restrict' }),
    lastActivityAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    erasedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One active lead per email / phone within an organization.
    uniqueIndex('leads_org_email_active_unique')
      .on(t.organizationId, t.email)
      .where(
        sql`${t.email} is not null and ${t.erasedAt} is null and ${t.mergedIntoLeadId} is null`,
      ),
    uniqueIndex('leads_org_phone_active_unique')
      .on(t.organizationId, t.phone)
      .where(
        sql`${t.phone} is not null and ${t.erasedAt} is null and ${t.mergedIntoLeadId} is null`,
      ),
    index().on(t.organizationId, t.stage),
    index().on(t.organizationId, t.createdAt),
    index().on(t.organizationId, t.ownerUserId),
  ],
);

export const leadQualification = pgTable('lead_qualification', {
  leadId: uuid()
    .primaryKey()
    .references(() => leads.id, { onDelete: 'cascade' }),
  organizationId: uuid()
    .notNull()
    .references(() => organizations.id, { onDelete: 'restrict' }),
  experienceLevel: experienceLevel().notNull().default('unknown'),
  marketsOfInterest: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  mainDifficulties: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  goals: text()
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  reasonForTraining: text(),
  previousTraining: text(),
  desiredStart: desiredStart().notNull().default('unknown'),
  mentorshipInterest: mentorshipInterest().notNull().default('unknown'),
  /** Provenance per field: { field: { source, actorUserId?, at, … } }. Never contains values. */
  evidence: jsonb().$type<Record<string, QualificationEvidence>>().notNull().default({}),
  updatedAt: updatedAt(),
});

export interface QualificationEvidence {
  source: 'staff' | 'form' | 'import' | 'chat' | 'ai';
  actorUserId?: string;
  at: string;
  /** AI only: the lead message the value was taken from and the AI run that recorded it. */
  messageId?: string;
  aiRunId?: string;
  /** AI only: character range of the supporting quote inside that message (no text copied). */
  quoteStart?: number;
  quoteEnd?: number;
}

/** Lead timeline. Append-only. Payloads reference ids and field names — never personal data. */
export const leadEvents = pgTable(
  'lead_events',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: 'restrict' }),
    type: text().notNull(),
    actorType: actorType().notNull(),
    actorUserId: uuid().references(() => users.id, { onDelete: 'no action' }),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index().on(t.leadId, t.occurredAt), index().on(t.organizationId, t.occurredAt)],
);

/** Pipeline history. Append-only. */
export const stageTransitions = pgTable(
  'stage_transitions',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: 'restrict' }),
    /** Null for the initial stage on creation. */
    fromStage: pipelineStage(),
    toStage: pipelineStage().notNull(),
    actorType: actorType().notNull(),
    actorUserId: uuid().references(() => users.id, { onDelete: 'no action' }),
    reason: text(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.leadId, t.createdAt)],
);

export const leadNotes = pgTable(
  'lead_notes',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    authorUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.leadId, t.createdAt)],
);

/** Consent history: the latest row per (lead, channel, purpose) is the current state. */
export const consents = pgTable(
  'consents',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    channel: consentChannel().notNull(),
    purpose: consentPurpose().notNull(),
    status: consentStatus().notNull(),
    source: dataSource().notNull(),
    /** Wording version shown, page URL, recorded-by user. */
    evidence: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.leadId, t.channel, t.purpose, t.createdAt)],
);

/** Global do-not-contact list. Stores SHA-256 hashes, so it survives erasure. */
export const suppressionList = pgTable(
  'suppression_list',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    kind: suppressionKind().notNull(),
    valueHash: text().notNull(),
    reason: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.organizationId, t.kind, t.valueHash)],
);

export const touchpoints = pgTable(
  'touchpoints',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    leadId: uuid()
      .notNull()
      .references((): AnyPgColumn => leads.id, { onDelete: 'cascade' }),
    occurredAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    channel: dataSource().notNull(),
    source: text(),
    medium: text(),
    campaign: text(),
    content: text(),
    term: text(),
    landingPage: text(),
    referrer: text(),
    /** gclid / fbclid / ttclid … */
    clickIds: jsonb().$type<Record<string, string>>().notNull().default({}),
  },
  (t) => [index().on(t.leadId, t.occurredAt), index().on(t.organizationId, t.source)],
);

/** Platform identities (email address, phone, WhatsApp id …) used by future channel adapters. */
export const channelIdentities = pgTable(
  'channel_identities',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: 'cascade' }),
    channel: channelKind().notNull(),
    externalId: text().notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex().on(t.organizationId, t.channel, t.externalId), index().on(t.leadId)],
);

export const leadImports = pgTable(
  'lead_imports',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    createdByUserId: uuid().references(() => users.id, { onDelete: 'set null' }),
    fileName: text(),
    counts: jsonb().$type<ImportCounts>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index().on(t.organizationId, t.createdAt)],
);

export interface ImportCounts {
  rows: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
}

export type Lead = typeof leads.$inferSelect;
export type LeadQualification = typeof leadQualification.$inferSelect;
export type LeadEvent = typeof leadEvents.$inferSelect;
export type StageTransition = typeof stageTransitions.$inferSelect;
export type Consent = typeof consents.$inferSelect;
export type Touchpoint = typeof touchpoints.$inferSelect;
export type LeadNote = typeof leadNotes.$inferSelect;
export type ChannelIdentity = typeof channelIdentities.$inferSelect;
