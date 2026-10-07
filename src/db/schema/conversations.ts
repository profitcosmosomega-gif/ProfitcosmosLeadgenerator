import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { users } from './auth';
import { createdAt, id, updatedAt } from './columns';
import { actorType, channelKind, leads } from './crm';
import { organizations } from './organizations';

/*
 * AI qualification conversations (Phase 3).
 * Every table carries organization_id; all queries are scoped by it.
 * Message bodies are personal data: they are deleted on lead erasure and never logged.
 * `ai_runs` hold metadata only — never prompt text, reply text or secrets.
 */

export const conversationStatus = pgEnum('conversation_status', ['active', 'closed']);
export const messageDirection = pgEnum('message_direction', ['in', 'out']);
export const messageAuthor = pgEnum('message_author', ['lead', 'ai', 'system']);
/** `received` (inbound), `sent` (shown to the lead), `blocked` (AI draft stopped by guardrails, staff only). */
export const messageStatus = pgEnum('message_status', ['received', 'sent', 'blocked']);
export const aiRunPurpose = pgEnum('ai_run_purpose', ['turn', 'guardrail']);
export const aiRunStatus = pgEnum('ai_run_status', ['succeeded', 'failed', 'blocked', 'skipped']);
export const escalationReason = pgEnum('escalation_reason', [
  'human_requested',
  'cannot_confirm',
  'sensitive_topic',
  'possible_underage',
  'abusive',
  'guardrail_failure',
  'limit_reached',
]);
export const escalationStatus = pgEnum('escalation_status', ['open', 'resolved']);

export const conversations = pgTable(
  'conversations',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: 'restrict' }),
    channel: channelKind().notNull(),
    status: conversationStatus().notNull().default('active'),
    /** Set by staff, by an escalation, or on erasure. While true the AI never replies. */
    aiPaused: boolean().notNull().default(false),
    /** SHA-256 of the conversation access token given to the browser. The token is never stored. */
    accessTokenHash: text().notNull(),
    closedReason: text(),
    /** Lease held by the worker while it runs a turn, so turns never overlap. */
    processingUntil: timestamp({ withTimezone: true }),
    lastMessageAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex().on(t.accessTokenHash),
    index().on(t.organizationId, t.leadId),
    index().on(t.organizationId, t.lastMessageAt),
  ],
);

export const aiRuns = pgTable(
  'ai_runs',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: 'restrict' }),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: 'restrict' }),
    /** The guardrail run's parent turn run. */
    parentRunId: uuid().references((): AnyPgColumn => aiRuns.id, { onDelete: 'restrict' }),
    purpose: aiRunPurpose().notNull(),
    status: aiRunStatus().notNull(),
    /** Why a turn was skipped or blocked (gate or guardrail code). Never free text. */
    reason: text(),
    provider: text(),
    model: text(),
    promptId: text(),
    promptVersion: text(),
    stopReason: text(),
    inputTokens: integer().notNull().default(0),
    outputTokens: integer().notNull().default(0),
    cacheReadTokens: integer().notNull().default(0),
    cacheWriteTokens: integer().notNull().default(0),
    /** Millionths of a US dollar. Null when the model's price is unknown — never guessed. */
    costMicroUsd: integer(),
    latencyMs: integer(),
    /** Tool calls made: name and outcome only, never inputs. */
    toolCalls: jsonb().$type<AiToolCallRecord[]>().notNull().default([]),
    /** Signals such as suspected prompt injection. Codes only. */
    flags: jsonb().$type<string[]>().notNull().default([]),
    errorCode: text(),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.organizationId, t.createdAt),
    index().on(t.conversationId, t.createdAt),
    index().on(t.leadId, t.createdAt),
  ],
);

export interface AiToolCallRecord {
  name: string;
  outcome: 'accepted' | 'rejected' | 'invalid' | 'unknown_tool';
  /** Machine-readable rejection reason (e.g. `quote_not_found`). */
  code?: string;
}

export const messages = pgTable(
  'messages',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: 'restrict' }),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: 'restrict' }),
    direction: messageDirection().notNull(),
    author: messageAuthor().notNull(),
    status: messageStatus().notNull(),
    /** Null after lead erasure. */
    body: text(),
    aiRunId: uuid().references(() => aiRuns.id, { onDelete: 'restrict' }),
    promptId: text(),
    promptVersion: text(),
    /** Guardrail verdict codes for AI messages. No text. */
    guardrail: jsonb().$type<GuardrailRecord>(),
    /** Inbound only: when a turn took this message into account (answered or skipped). */
    handledAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.conversationId, t.createdAt),
    index('messages_unhandled_idx')
      .on(t.conversationId, t.createdAt)
      .where(sql`${t.direction} = 'in' and ${t.handledAt} is null`),
  ],
);

export interface GuardrailRecord {
  passed: boolean;
  /** Check codes that failed, e.g. `rule:guarantee`, `leak`, `classifier:financial_advice`. */
  failures: string[];
  attempt: number;
  fallback?: boolean;
}

export const conversationEscalations = pgTable(
  'conversation_escalations',
  {
    id: id(),
    organizationId: uuid()
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    conversationId: uuid()
      .notNull()
      .references(() => conversations.id, { onDelete: 'restrict' }),
    leadId: uuid()
      .notNull()
      .references(() => leads.id, { onDelete: 'restrict' }),
    reason: escalationReason().notNull(),
    status: escalationStatus().notNull().default('open'),
    /** The lead message that led to the flag, when there is one. */
    messageId: uuid().references(() => messages.id, { onDelete: 'restrict' }),
    aiRunId: uuid().references(() => aiRuns.id, { onDelete: 'restrict' }),
    createdByType: actorType().notNull(),
    resolvedByUserId: uuid().references(() => users.id, { onDelete: 'no action' }),
    resolvedAt: timestamp({ withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index().on(t.organizationId, t.status, t.createdAt),
    index().on(t.conversationId),
    index().on(t.leadId),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type AiRun = typeof aiRuns.$inferSelect;
export type NewAiRun = typeof aiRuns.$inferInsert;
export type ConversationEscalation = typeof conversationEscalations.$inferSelect;
export type EscalationReason = (typeof escalationReason.enumValues)[number];
