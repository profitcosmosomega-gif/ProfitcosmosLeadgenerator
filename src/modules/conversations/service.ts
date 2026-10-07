import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  getTableName,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type AnyColumn,
  type SQL,
} from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { aiConfig } from '@config/ai';
import type { Database, DbExecutor } from '@/db/client';
import {
  aiRuns,
  conversationEscalations,
  conversations,
  messages,
  users,
  type Conversation,
  type ConversationEscalation,
  type EscalationReason,
  type GuardrailRecord,
  type Message,
} from '@/db/schema';
import { Errors } from '@/lib/errors';
import { transitionLead } from '@/modules/crm/service';
import { recordLeadHistory, systemActor, type Actor } from '@/modules/leads/history';
import { findLead } from '@/modules/leads/repository';
import type { ChannelKind } from '@/modules/channels/types';

/*
 * Conversations between a lead and the AI assistant (Phase 3).
 * Every query filters by organization_id. Message bodies never go into events, audit or logs.
 */

// ---------------------------------------------------------------------------------------------
// Access tokens
// ---------------------------------------------------------------------------------------------

/** A random bearer token for one conversation. Only its SHA-256 hash is stored. */
export function newAccessToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashAccessToken(token) };
}

export function hashAccessToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * Load a conversation for a public request. The token must belong to this conversation and
 * organization; anything else is a 404 so ids and tokens cannot be probed.
 */
export async function findConversationByToken(
  db: DbExecutor,
  organizationId: string,
  conversationId: string,
  token: string | null,
): Promise<Conversation> {
  if (!token) throw Errors.notFound('Conversation not found');
  const [conversation] = await db
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)),
    );
  if (!conversation || !sameHash(conversation.accessTokenHash, hashAccessToken(token))) {
    throw Errors.notFound('Conversation not found');
  }
  return conversation;
}

// ---------------------------------------------------------------------------------------------
// Lead side
// ---------------------------------------------------------------------------------------------

/** Open a conversation for a lead. Returns the access token once; it is not stored. */
export async function startConversation(
  tx: DbExecutor,
  input: { organizationId: string; leadId: string; channel: ChannelKind; actor: Actor },
): Promise<{ conversation: Conversation; accessToken: string }> {
  const { token, hash } = newAccessToken();
  const [conversation] = await tx
    .insert(conversations)
    .values({
      organizationId: input.organizationId,
      leadId: input.leadId,
      channel: input.channel,
      accessTokenHash: hash,
    })
    .returning();
  await recordLeadHistory(tx, {
    organizationId: input.organizationId,
    leadId: input.leadId,
    type: 'conversation.started',
    actor: input.actor,
    payload: { conversationId: conversation!.id, channel: input.channel },
  });
  return { conversation: conversation!, accessToken: token };
}

/**
 * Store a message from the lead. Applies the Phase 3 stage rule: the first message from a lead
 * in `NEW_LEAD` moves it to `ENGAGED` (through the CRM transition service).
 */
export async function addLeadMessage(
  db: Database,
  input: { conversation: Conversation; text: string; requestId?: string },
): Promise<Message> {
  const { conversation } = input;
  const message = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversation.id))
      .for('update');
    if (!locked || locked.status !== 'active') {
      throw Errors.conflict('This conversation is closed');
    }
    const [{ count } = { count: 0 }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(messages)
      .where(and(eq(messages.conversationId, conversation.id), eq(messages.author, 'lead')));
    if (count >= aiConfig.maxLeadMessagesPerConversation) {
      throw Errors.conflict('This conversation has reached its message limit');
    }
    const [inserted] = await tx
      .insert(messages)
      .values({
        organizationId: conversation.organizationId,
        conversationId: conversation.id,
        leadId: conversation.leadId,
        direction: 'in',
        author: 'lead',
        status: 'received',
        body: input.text,
      })
      .returning();
    await tx
      .update(conversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversations.id, conversation.id));
    await recordLeadHistory(tx, {
      organizationId: conversation.organizationId,
      leadId: conversation.leadId,
      type: 'message.received',
      actor: { type: 'lead', requestId: input.requestId },
      payload: { conversationId: conversation.id, messageId: inserted!.id },
    });
    return inserted!;
  });

  await applyStageRule(db, conversation.organizationId, conversation.leadId, 'firstMessage');
  return message;
}

/** The only automatic stage changes in Phase 3 (owner gate 6). */
export const STAGE_RULES = {
  firstMessage: { from: 'NEW_LEAD', to: 'ENGAGED', reason: 'First chat message received' },
  firstAnswer: {
    from: 'ENGAGED',
    to: 'QUALIFYING',
    reason: 'First qualification answer recorded from chat',
  },
} as const;

/**
 * Apply a Phase 3 stage rule. Moves the lead only if it is still exactly in the rule's `from`
 * stage; a lead moved meanwhile (by staff or a concurrent turn) is left alone.
 */
export async function applyStageRule(
  db: Database,
  organizationId: string,
  leadId: string,
  name: keyof typeof STAGE_RULES,
): Promise<boolean> {
  const rule = STAGE_RULES[name];
  const lead = await findLead(db, organizationId, leadId);
  if (lead.stage !== rule.from || lead.erasedAt || lead.mergedIntoLeadId) return false;
  try {
    await transitionLead(db, {
      organizationId,
      leadId,
      to: rule.to,
      reason: rule.reason,
      actor: systemActor,
    });
    return true;
  } catch (error) {
    // Lost a race with another transition: the lead is no longer in `from`.
    if ((error as { code?: string }).code === 'INVALID_STATE_TRANSITION') return false;
    throw error;
  }
}

export interface PublicMessage {
  id: string;
  author: 'lead' | 'assistant';
  text: string;
  createdAt: Date;
}

/** Messages the lead may see: their own and AI replies that were sent. Oldest first. */
export async function listPublicMessages(
  db: DbExecutor,
  conversation: Conversation,
  afterMessageId?: string,
): Promise<PublicMessage[]> {
  const conditions: SQL[] = [
    eq(messages.conversationId, conversation.id),
    eq(messages.organizationId, conversation.organizationId),
    or(
      and(eq(messages.author, 'lead'), eq(messages.status, 'received')),
      and(eq(messages.author, 'ai'), eq(messages.status, 'sent')),
    )!,
  ];
  if (afterMessageId) conditions.push(gt(messages.id, afterMessageId));
  const rows = await db
    .select({
      id: messages.id,
      author: messages.author,
      body: messages.body,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(...conditions))
    .orderBy(asc(messages.id))
    .limit(200);
  return rows.map((row) => ({
    id: row.id,
    author: row.author === 'lead' ? 'lead' : 'assistant',
    text: row.body ?? '',
    createdAt: row.createdAt,
  }));
}

/** True while a lead message still waits for a turn. */
export async function hasUnhandledMessages(
  db: DbExecutor,
  conversationId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, 'in'),
        isNull(messages.handledAt),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** True once the assistant has sent any message in the conversation (AI reply or fallback). */
export async function hasSentAiMessage(db: DbExecutor, conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.author, 'ai'),
        eq(messages.status, 'sent'),
      ),
    )
    .limit(1);
  return Boolean(row);
}

export async function hasOpenEscalation(db: DbExecutor, conversationId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: conversationEscalations.id })
    .from(conversationEscalations)
    .where(
      and(
        eq(conversationEscalations.conversationId, conversationId),
        eq(conversationEscalations.status, 'open'),
      ),
    )
    .limit(1);
  return Boolean(row);
}

// ---------------------------------------------------------------------------------------------
// Turn support (used by the agent pipeline)
// ---------------------------------------------------------------------------------------------

/**
 * Take the worker lease on a conversation. Returns null when another turn holds it.
 * The lease expires on its own, so a crashed worker never blocks a conversation for long.
 */
export async function claimConversation(
  db: DbExecutor,
  organizationId: string,
  conversationId: string,
): Promise<Conversation | null> {
  const [claimed] = await db
    .update(conversations)
    .set({
      processingUntil: sql`now() + make_interval(secs => ${aiConfig.turnLeaseSeconds})`,
    })
    .where(
      and(
        eq(conversations.id, conversationId),
        eq(conversations.organizationId, organizationId),
        or(isNull(conversations.processingUntil), lt(conversations.processingUntil, sql`now()`)),
      ),
    )
    .returning();
  return claimed ?? null;
}

export async function releaseConversation(db: DbExecutor, conversationId: string): Promise<void> {
  await db
    .update(conversations)
    .set({ processingUntil: null })
    .where(eq(conversations.id, conversationId));
}

/** Lead messages not yet taken into account by a turn, oldest first. */
export async function unhandledLeadMessages(
  db: DbExecutor,
  conversationId: string,
): Promise<Message[]> {
  return db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        eq(messages.direction, 'in'),
        isNull(messages.handledAt),
      ),
    )
    .orderBy(asc(messages.id));
}

/** Recent transcript for the model: lead messages and sent AI replies (never blocked drafts). */
export async function recentTranscript(
  db: DbExecutor,
  conversationId: string,
  limit: number,
): Promise<Message[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversationId),
        or(
          eq(messages.author, 'lead'),
          and(eq(messages.author, 'ai'), eq(messages.status, 'sent')),
        ),
      ),
    )
    .orderBy(desc(messages.id))
    .limit(limit);
  return rows.reverse();
}

/** All lead messages of a conversation (used to verify AI evidence quotes). */
export async function leadMessagesOf(db: DbExecutor, conversationId: string): Promise<Message[]> {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.author, 'lead')))
    .orderBy(asc(messages.id));
}

export async function markMessagesHandled(tx: DbExecutor, messageIds: string[]): Promise<void> {
  if (messageIds.length === 0) return;
  await tx.update(messages).set({ handledAt: new Date() }).where(inArray(messages.id, messageIds));
}

export async function insertAiMessage(
  tx: DbExecutor,
  conversation: Conversation,
  input: {
    status: 'sent' | 'blocked';
    body: string | null;
    aiRunId: string | null;
    promptId: string | null;
    promptVersion: string | null;
    guardrail: GuardrailRecord;
  },
): Promise<Message> {
  const [message] = await tx
    .insert(messages)
    .values({
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      leadId: conversation.leadId,
      direction: 'out',
      author: 'ai',
      ...input,
    })
    .returning();
  if (input.status === 'sent') {
    await tx
      .update(conversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(conversations.id, conversation.id));
  }
  return message!;
}

/**
 * Flag a conversation for a human and pause the AI on it. Phase 7 builds handoffs on these flags;
 * Phase 3 only records them. At most one open flag per reason and conversation.
 */
export async function createEscalation(
  tx: DbExecutor,
  conversation: Conversation,
  input: {
    reason: EscalationReason;
    messageId?: string | null;
    aiRunId?: string | null;
    actor: Actor;
  },
): Promise<ConversationEscalation | null> {
  const [existing] = await tx
    .select({ id: conversationEscalations.id })
    .from(conversationEscalations)
    .where(
      and(
        eq(conversationEscalations.conversationId, conversation.id),
        eq(conversationEscalations.reason, input.reason),
        eq(conversationEscalations.status, 'open'),
      ),
    )
    .limit(1);
  await tx
    .update(conversations)
    .set({ aiPaused: true })
    .where(eq(conversations.id, conversation.id));
  if (existing) return null;
  const [escalation] = await tx
    .insert(conversationEscalations)
    .values({
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      leadId: conversation.leadId,
      reason: input.reason,
      messageId: input.messageId ?? null,
      aiRunId: input.aiRunId ?? null,
      createdByType: input.actor.type === 'ai' ? 'ai' : 'system',
    })
    .returning();
  await recordLeadHistory(tx, {
    organizationId: conversation.organizationId,
    leadId: conversation.leadId,
    type: 'escalation.flagged',
    actor: input.actor,
    payload: {
      conversationId: conversation.id,
      escalationId: escalation!.id,
      reason: input.reason,
    },
  });
  return escalation!;
}

// ---------------------------------------------------------------------------------------------
// Staff side
// ---------------------------------------------------------------------------------------------

export async function findConversation(
  db: DbExecutor,
  organizationId: string,
  conversationId: string,
  options: { forUpdate?: boolean } = {},
): Promise<Conversation> {
  const query = db
    .select()
    .from(conversations)
    .where(
      and(eq(conversations.id, conversationId), eq(conversations.organizationId, organizationId)),
    );
  const [conversation] = await (options.forUpdate ? query.for('update') : query);
  if (!conversation) throw Errors.notFound('Conversation not found');
  return conversation;
}

/** Conversations of a lead with message and open-flag counts. Newest first. */
export async function listLeadConversations(db: Database, organizationId: string, leadId: string) {
  await findLead(db, organizationId, leadId);
  return db
    .select({
      id: conversations.id,
      channel: conversations.channel,
      status: conversations.status,
      aiPaused: conversations.aiPaused,
      lastMessageAt: conversations.lastMessageAt,
      createdAt: conversations.createdAt,
      // Correlated subqueries with explicit aliases: unqualified columns would bind to the inner table.
      messageCount: sql<number>`(select count(*)::int from messages m where m.conversation_id = "conversations"."id")`,
      openEscalations: sql<number>`(select count(*)::int from conversation_escalations e where e.conversation_id = "conversations"."id" and e.status = 'open')`,
    })
    .from(conversations)
    .where(and(eq(conversations.organizationId, organizationId), eq(conversations.leadId, leadId)))
    .orderBy(desc(conversations.createdAt));
}

/**
 * Everything staff need to review a conversation: transcript (including blocked drafts),
 * AI run metadata and escalation flags. Never includes prompt text or the access token.
 */
export async function getConversationDetail(
  db: Database,
  organizationId: string,
  conversationId: string,
) {
  const conversation = await findConversation(db, organizationId, conversationId);
  const [transcript, runs, escalations] = await Promise.all([
    db
      .select({
        id: messages.id,
        direction: messages.direction,
        author: messages.author,
        status: messages.status,
        body: messages.body,
        aiRunId: messages.aiRunId,
        promptId: messages.promptId,
        promptVersion: messages.promptVersion,
        guardrail: messages.guardrail,
        handledAt: messages.handledAt,
        createdAt: messages.createdAt,
      })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversation.id),
          eq(messages.organizationId, organizationId),
        ),
      )
      .orderBy(asc(messages.id)),
    db
      .select({
        id: aiRuns.id,
        parentRunId: aiRuns.parentRunId,
        purpose: aiRuns.purpose,
        status: aiRuns.status,
        reason: aiRuns.reason,
        provider: aiRuns.provider,
        model: aiRuns.model,
        promptId: aiRuns.promptId,
        promptVersion: aiRuns.promptVersion,
        stopReason: aiRuns.stopReason,
        inputTokens: aiRuns.inputTokens,
        outputTokens: aiRuns.outputTokens,
        cacheReadTokens: aiRuns.cacheReadTokens,
        cacheWriteTokens: aiRuns.cacheWriteTokens,
        costMicroUsd: aiRuns.costMicroUsd,
        latencyMs: aiRuns.latencyMs,
        toolCalls: aiRuns.toolCalls,
        flags: aiRuns.flags,
        errorCode: aiRuns.errorCode,
        createdAt: aiRuns.createdAt,
      })
      .from(aiRuns)
      .where(
        and(eq(aiRuns.conversationId, conversation.id), eq(aiRuns.organizationId, organizationId)),
      )
      .orderBy(asc(aiRuns.id)),
    db
      .select({
        id: conversationEscalations.id,
        reason: conversationEscalations.reason,
        status: conversationEscalations.status,
        messageId: conversationEscalations.messageId,
        aiRunId: conversationEscalations.aiRunId,
        createdByType: conversationEscalations.createdByType,
        resolvedByUserId: conversationEscalations.resolvedByUserId,
        resolvedByName: users.name,
        resolvedAt: conversationEscalations.resolvedAt,
        createdAt: conversationEscalations.createdAt,
      })
      .from(conversationEscalations)
      .leftJoin(users, eq(users.id, conversationEscalations.resolvedByUserId))
      .where(
        and(
          eq(conversationEscalations.conversationId, conversation.id),
          eq(conversationEscalations.organizationId, organizationId),
        ),
      )
      .orderBy(desc(conversationEscalations.createdAt)),
  ]);
  const { accessTokenHash: _hash, processingUntil: _lease, ...safe } = conversation;
  return { conversation: safe, messages: transcript, aiRuns: runs, escalations };
}

/** Staff pause or resume the AI on a conversation. Audited. */
export async function setConversationAiPaused(
  db: Database,
  organizationId: string,
  conversationId: string,
  paused: boolean,
  actor: Actor,
): Promise<Conversation> {
  return db.transaction(async (tx) => {
    const conversation = await findConversation(tx, organizationId, conversationId, {
      forUpdate: true,
    });
    if (!paused && conversation.status !== 'active') {
      throw Errors.conflict('This conversation is closed');
    }
    if (conversation.aiPaused === paused) return conversation;
    const [updated] = await tx
      .update(conversations)
      .set({ aiPaused: paused })
      .where(eq(conversations.id, conversation.id))
      .returning();
    await recordLeadHistory(tx, {
      organizationId,
      leadId: conversation.leadId,
      type: paused ? 'conversation.ai_paused' : 'conversation.ai_resumed',
      actor,
      payload: { conversationId: conversation.id },
    });
    return updated!;
  });
}

/** Staff mark an escalation flag as handled. Does not resume the AI (that is a separate step). */
export async function resolveEscalation(
  db: Database,
  organizationId: string,
  escalationId: string,
  actor: Actor & { type: 'user' },
): Promise<ConversationEscalation> {
  return db.transaction(async (tx) => {
    const [escalation] = await tx
      .select()
      .from(conversationEscalations)
      .where(
        and(
          eq(conversationEscalations.id, escalationId),
          eq(conversationEscalations.organizationId, organizationId),
        ),
      )
      .for('update');
    if (!escalation) throw Errors.notFound('Escalation not found');
    if (escalation.status === 'resolved') return escalation;
    const [updated] = await tx
      .update(conversationEscalations)
      .set({ status: 'resolved', resolvedByUserId: actor.userId, resolvedAt: new Date() })
      .where(eq(conversationEscalations.id, escalation.id))
      .returning();
    await recordLeadHistory(tx, {
      organizationId,
      leadId: escalation.leadId,
      type: 'escalation.resolved',
      actor,
      payload: {
        conversationId: escalation.conversationId,
        escalationId: escalation.id,
        reason: escalation.reason,
      },
    });
    return updated!;
  });
}

/** SQL condition: the lead has at least one open escalation flag (for the lead list filter). */
export function leadHasOpenEscalation(leadIdColumn: AnyColumn): SQL {
  const column = sql.raw(
    `"${getTableName((leadIdColumn as AnyPgColumn).table)}"."${leadIdColumn.name}"`,
  );
  return sql`exists (select 1 from conversation_escalations e where e.lead_id = ${column} and e.status = 'open')`;
}

// ---------------------------------------------------------------------------------------------
// Lead lifecycle hooks (called by the leads module)
// ---------------------------------------------------------------------------------------------

/** Erasure: delete message text and close the lead's conversations. Run metadata stays. */
export async function eraseLeadConversations(
  tx: DbExecutor,
  organizationId: string,
  leadId: string,
): Promise<void> {
  await tx
    .update(messages)
    .set({ body: null })
    .where(and(eq(messages.organizationId, organizationId), eq(messages.leadId, leadId)));
  await tx
    .update(conversations)
    .set({ status: 'closed', aiPaused: true, closedReason: 'lead_erased' })
    .where(and(eq(conversations.organizationId, organizationId), eq(conversations.leadId, leadId)));
}

/** Data-subject export: the lead's conversations and messages. */
export async function exportLeadConversations(
  db: DbExecutor,
  organizationId: string,
  leadId: string,
) {
  const rows = await db
    .select({
      id: conversations.id,
      channel: conversations.channel,
      status: conversations.status,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(and(eq(conversations.organizationId, organizationId), eq(conversations.leadId, leadId)))
    .orderBy(asc(conversations.createdAt));
  const transcript = rows.length
    ? await db
        .select({
          conversationId: messages.conversationId,
          author: messages.author,
          status: messages.status,
          body: messages.body,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .where(
          and(
            eq(messages.organizationId, organizationId),
            inArray(
              messages.conversationId,
              rows.map((r) => r.id),
            ),
          ),
        )
        .orderBy(asc(messages.id))
    : [];
  return rows.map((conversation) => ({
    ...conversation,
    messages: transcript
      .filter((m) => m.conversationId === conversation.id)
      .map(({ conversationId: _id, ...m }) => m),
  }));
}

/** Merge: conversations, messages and flags of the source lead follow it to the target. */
export async function moveLeadConversations(
  tx: DbExecutor,
  organizationId: string,
  sourceLeadId: string,
  targetLeadId: string,
): Promise<void> {
  for (const table of [conversations, messages, conversationEscalations]) {
    await tx
      .update(table)
      .set({ leadId: targetLeadId })
      .where(and(eq(table.organizationId, organizationId), eq(table.leadId, sourceLeadId)));
  }
}
