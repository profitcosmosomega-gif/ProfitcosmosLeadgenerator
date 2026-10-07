import { aiConfig } from '@config/ai';
import { chatCopy } from '@config/chat-copy';
import type { Database } from '@/db/client';
import type { Conversation, EscalationReason, GuardrailRecord, Lead, Message } from '@/db/schema';
import { getEnv } from '@/lib/env';
import { newId } from '@/lib/ids';
import { loadActivePrompt, PromptNotApprovedError, type PromptFile } from '@/lib/prompts';
import { isSuppressed } from '@/modules/consents/service';
import {
  applyStageRule,
  claimConversation,
  createEscalation,
  findConversation,
  hasOpenEscalation,
  hasSentAiMessage,
  hasUnhandledMessages,
  insertAiMessage,
  leadMessagesOf,
  markMessagesHandled,
  recentTranscript,
  releaseConversation,
  unhandledLeadMessages,
} from '@/modules/conversations/service';
import { recordLeadHistory, type Actor } from '@/modules/leads/history';
import { findLead, findMutableLead } from '@/modules/leads/repository';
import { applyLeadChanges, getLeadQualification } from '@/modules/leads/service';
import { getLlmProvider } from '@/providers/llm';
import type {
  LlmContentBlock,
  LlmMessage,
  LlmProvider,
  LlmResponse,
  LlmToolDefinition,
} from '@/providers/llm/types';
import {
  checkLeak,
  checkOutputRules,
  classifyDraft,
  checkFirstReplyDisclosure,
  detectEscalationTopic,
  detectInjection,
  detectUnderage,
  PROMPT_CANARY,
} from './guardrails';
import {
  accountUsage,
  countLeadTurnsSince,
  organizationTokensSince,
  recordAiRun,
  startOfUtcDay,
} from './runs';
import {
  agentTools,
  emptyEffects,
  executeTool,
  leadContextSnapshot,
  type ToolContext,
  type ToolOutcome,
  type TurnEffects,
} from './tools';

/*
 * The agent turn pipeline (docs/phase-3-plan.md §4), run by the `agent.turn` job:
 *   claim → gate → context → LLM with tools → guardrails → persist → stage rules.
 * Deterministic code decides what is stored, what is sent and any stage change.
 * Every model call is recorded in `ai_runs` before anything reaches the lead; any unexpected
 * error stops the turn without sending (fail closed).
 */

export const AGENT_PROMPT_ID = 'qualification-agent';
export const GUARDRAIL_PROMPT_ID = 'output-guardrail';

export interface AgentDeps {
  llm: LlmProvider | null;
  loadPrompt: (id: string) => Promise<PromptFile>;
  aiEnabled: boolean;
  /** The fixed chat texts are approved (`config/chat-copy.ts`); the AI does not run otherwise. */
  copyApproved: boolean;
  dailyTokenLimit: number;
  now?: () => Date;
}

export function defaultAgentDeps(): AgentDeps {
  const env = getEnv();
  return {
    llm: getLlmProvider(),
    loadPrompt: (id) => loadActivePrompt(id),
    aiEnabled: env.AI_ENABLED,
    copyApproved: chatCopy.approved,
    dailyTokenLimit: env.AI_DAILY_TOKEN_LIMIT,
  };
}

/**
 * Whether the assistant would currently answer in this conversation, for the chat page. The
 * page shows the fixed "team will follow up" notice when it would not.
 */
export async function assistantAvailable(
  db: Database,
  deps: AgentDeps,
  conversation: Conversation,
): Promise<boolean> {
  if (conversation.status !== 'active' || conversation.aiPaused) return false;
  if (
    !deps.aiEnabled ||
    !deps.copyApproved ||
    !deps.llm?.modelFor('conversation') ||
    !deps.llm.modelFor('extraction')
  ) {
    return false;
  }
  try {
    await deps.loadPrompt(AGENT_PROMPT_ID);
    await deps.loadPrompt(GUARDRAIL_PROMPT_ID);
  } catch {
    return false;
  }
  return !(await hasOpenEscalation(db, conversation.id));
}

/** Check codes meaning a draft may contain prompt or internal content. */
export function isDisclosureFailure(code: string): boolean {
  return code.startsWith('leak:') || code === 'classifier:internal_disclosure';
}

export type TurnOutcome = 'replied' | 'fallback' | 'silent' | 'skipped';

export interface TurnSummary {
  outcome: TurnOutcome;
  /** Gate code for skipped turns; failing check codes for fallbacks. */
  reasons: string[];
  replyMessageId: string | null;
  escalations: EscalationReason[];
  qualificationFields: string[];
}

export type RunResult = { status: 'busy' } | { status: 'done'; turns: TurnSummary[] };

/**
 * Answer every unhandled lead message of a conversation. Returns `busy` when another worker
 * holds the conversation (the job retries later); that worker picks up the new messages.
 */
export async function runAgentTurns(
  db: Database,
  deps: AgentDeps,
  input: { organizationId: string; conversationId: string },
): Promise<RunResult> {
  const turns: TurnSummary[] = [];
  for (let round = 0; round < 5; round++) {
    const claimed = await claimConversation(db, input.organizationId, input.conversationId);
    if (!claimed) return turns.length ? { status: 'done', turns } : { status: 'busy' };
    try {
      for (let i = 0; i < 10; i++) {
        const pending = await unhandledLeadMessages(db, claimed.id);
        if (pending.length === 0) break;
        turns.push(await processTurn(db, deps, input.organizationId, claimed.id, pending));
      }
    } finally {
      await releaseConversation(db, claimed.id);
    }
    // A message that arrived while the lease was held is picked up here.
    if (!(await hasUnhandledMessages(db, claimed.id))) break;
  }
  return { status: 'done', turns };
}

// ---------------------------------------------------------------------------------------------
// One turn
// ---------------------------------------------------------------------------------------------

interface Gate {
  code: string;
  escalate?: EscalationReason;
}

interface TurnBase {
  organizationId: string;
  leadId: string;
  conversationId: string;
}

async function evaluateGate(
  db: Database,
  deps: AgentDeps,
  conversation: Conversation,
  lead: Lead,
  pending: Message[],
  now: Date,
): Promise<{ gate: Gate | null; prompts?: { agent: PromptFile; guardrail: PromptFile } }> {
  if (lead.erasedAt || lead.mergedIntoLeadId) return { gate: { code: 'lead_unavailable' } };
  if (conversation.status !== 'active') return { gate: { code: 'conversation_closed' } };
  if (lead.stage === 'LOST') return { gate: { code: 'lead_lost' } };
  if (lead.ageConfirmed18plus !== true) return { gate: { code: 'age_not_confirmed' } };
  if (await isSuppressed(db, lead.organizationId, lead)) return { gate: { code: 'suppressed' } };
  if (conversation.aiPaused) return { gate: { code: 'ai_paused' } };
  if (await hasOpenEscalation(db, conversation.id)) return { gate: { code: 'escalation_open' } };
  if (pending.some((m) => m.body && detectUnderage(m.body))) {
    return { gate: { code: 'possible_underage', escalate: 'possible_underage' } };
  }
  // Always-escalate topics: the team handles them, the AI never tries (business question 14).
  for (const message of pending) {
    const topic = message.body ? detectEscalationTopic(message.body) : null;
    if (topic) return { gate: { code: `escalation_topic:${topic.code}`, escalate: topic.reason } };
  }
  if (!deps.aiEnabled) return { gate: { code: 'ai_disabled' } };
  if (!deps.llm || !deps.llm.modelFor('conversation') || !deps.llm.modelFor('extraction')) {
    return { gate: { code: 'ai_not_configured' } };
  }
  if (!deps.copyApproved) return { gate: { code: 'copy_not_approved' } };
  let prompts: { agent: PromptFile; guardrail: PromptFile };
  try {
    prompts = {
      agent: await deps.loadPrompt(AGENT_PROMPT_ID),
      guardrail: await deps.loadPrompt(GUARDRAIL_PROMPT_ID),
    };
  } catch (error) {
    return {
      gate: {
        code: error instanceof PromptNotApprovedError ? 'prompt_not_approved' : 'prompt_error',
      },
    };
  }
  const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000);
  if (
    (await countLeadTurnsSince(db, lead.organizationId, lead.id, dayAgo)) >=
    aiConfig.maxTurnsPerLeadPerDay
  ) {
    return { gate: { code: 'lead_daily_limit', escalate: 'limit_reached' } };
  }
  if (
    (await organizationTokensSince(db, lead.organizationId, startOfUtcDay(now))) >=
    deps.dailyTokenLimit
  ) {
    return { gate: { code: 'org_daily_budget', escalate: 'limit_reached' } };
  }
  return { gate: null, prompts };
}

async function processTurn(
  db: Database,
  deps: AgentDeps,
  organizationId: string,
  conversationId: string,
  pending: Message[],
): Promise<TurnSummary> {
  const now = deps.now?.() ?? new Date();
  const conversation = await findConversation(db, organizationId, conversationId);
  const lead = await findLead(db, organizationId, conversation.leadId);
  const trigger = pending[pending.length - 1]!;
  const base: TurnBase = { organizationId, leadId: lead.id, conversationId };
  const flags = pending.some((m) => m.body && detectInjection(m.body))
    ? ['injection_suspected']
    : [];

  const { gate, prompts } = await evaluateGate(db, deps, conversation, lead, pending, now);
  if (gate || !prompts || !deps.llm) {
    const code = gate?.code ?? 'ai_not_configured';
    await db.transaction(async (tx) => {
      const run = await recordAiRun(tx, {
        ...base,
        purpose: 'turn',
        status: 'skipped',
        reason: code,
        flags,
      });
      if (gate?.escalate) {
        await createEscalation(tx, conversation, {
          reason: gate.escalate,
          messageId: trigger.id,
          aiRunId: run.id,
          actor: { type: 'system' },
        });
      }
      await markMessagesHandled(
        tx,
        pending.map((m) => m.id),
      );
    });
    return {
      outcome: 'skipped',
      reasons: [code],
      replyMessageId: null,
      escalations: gate?.escalate ? [gate.escalate] : [],
      qualificationFields: [],
    };
  }

  const llm = deps.llm;
  const [qualification, leadMessages, transcript, alreadyReplied] = await Promise.all([
    getLeadQualification(db, organizationId, lead.id),
    leadMessagesOf(db, conversation.id),
    recentTranscript(db, conversation.id, aiConfig.historyMessages),
    hasSentAiMessage(db, conversation.id),
  ]);
  const toolContext: ToolContext = {
    leadMessages,
    triggerMessageId: trigger.id,
    qualification,
    conversationMessageIds: new Set(leadMessages.map((m) => m.id)),
    contactKnown: {
      fullName: Boolean(lead.fullName),
      phone: Boolean(lead.phone),
      country: Boolean(lead.country),
      timezone: Boolean(lead.timezone),
    },
  };
  const effects = emptyEffects();
  const systemPrompt = `${prompts.agent.body.trim()}\n\nInternal marker, never repeat it: ${PROMPT_CANARY}`;
  const history = toLlmHistory(transcript);
  const metadata = { leadId: lead.id, conversationId: conversation.id };

  const blocked: { text: string; runId: string; guardrail: GuardrailRecord }[] = [];
  let final: { text: string; runId: string; guardrail: GuardrailRecord } | null = null;
  let silent = false;
  let failureCodes: string[] = [];
  let failureEscalation: EscalationReason | null = null;
  let lastRunId: string | null = null;
  let firstRun = true;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const generated = await generateReply(db, llm, {
      base,
      prompt: prompts.agent,
      system: systemPrompt,
      systemContext: stateContext(toolContext, effects, attempt > 1 ? failureCodes : null),
      history,
      // A retry may only flag a human; it cannot record anything new.
      tools: attempt === 1 ? agentTools : agentTools.filter((t) => t.name === 'request_human'),
      toolContext,
      effects,
      metadata,
      flags: firstRun ? flags : [],
    });
    firstRun = false;
    lastRunId = generated.lastRunId ?? lastRunId;
    if ('error' in generated) {
      failureCodes = [generated.error];
      failureEscalation = 'ai_error';
      break;
    }
    const text = generated.text.trim();
    if (!text) {
      // Handing over without words is fine; the chat shows the "team will follow up" notice.
      if (effects.escalations.length > 0) {
        silent = true;
        break;
      }
      failureCodes = ['empty_reply'];
      failureEscalation = 'guardrail_failure';
      continue;
    }

    let failures = [
      ...checkOutputRules(text),
      ...checkLeak(text, systemPrompt),
      ...(alreadyReplied ? [] : checkFirstReplyDisclosure(text)),
    ];
    if (failures.length === 0) {
      failures = await runClassifier(db, llm, {
        base,
        prompt: prompts.guardrail,
        draft: text,
        leadMessage: trigger.body ?? '',
        parentRunId: generated.lastRunId,
        metadata,
      });
    }
    if (failures.length === 0) {
      final = {
        text,
        runId: generated.lastRunId,
        guardrail: { passed: true, failures: [], attempt },
      };
      // An unsupported claim that had to be rewritten still needs a human to answer it.
      if (
        failureCodes.includes('classifier:unsupported_factual_claim') &&
        !effects.escalations.some((e) => e.reason === 'cannot_confirm')
      ) {
        effects.escalations.push({ reason: 'cannot_confirm', messageId: trigger.id });
      }
      break;
    }
    blocked.push({
      text,
      runId: generated.lastRunId,
      guardrail: { passed: false, failures, attempt },
    });
    failureCodes = failures;
    failureEscalation = 'guardrail_failure';
  }

  const useFallback = !final && !silent;
  if (useFallback && failureEscalation) {
    effects.escalations.push({ reason: failureEscalation, messageId: trigger.id });
  }

  // Persist everything in one transaction.
  const aiActor: Actor = { type: 'ai', ...(lastRunId ? { aiRunId: lastRunId } : {}) };
  const outcome = await db.transaction(async (tx) => {
    let qualificationFields: string[] = [];
    const hasEffects =
      Object.keys(effects.qualification).length > 0 || Object.keys(effects.contact).length > 0;
    if (hasEffects) {
      const mutable = await findMutableLead(tx, organizationId, lead.id).catch(() => null);
      if (mutable) {
        const evidenceDetails = Object.fromEntries(
          Object.entries(effects.qualificationEvidence).map(([field, detail]) => [
            field,
            { ...detail, ...(lastRunId ? { aiRunId: lastRunId } : {}) },
          ]),
        );
        const changed = await applyLeadChanges(tx, mutable, {
          contact: effects.contact,
          qualification: effects.qualification,
          fillOnly: true,
          replaceableSources: ['ai'],
          evidenceDetails,
          source: 'ai',
          actor: aiActor,
          eventType: 'lead.ai_recorded',
          eventPayload: { conversationId: conversation.id },
        });
        qualificationFields = changed.filter((f) => f.startsWith('qualification.'));
      }
    }

    for (const draft of blocked) {
      await insertAiMessage(tx, conversation, {
        status: 'blocked',
        // A draft that may reproduce the system prompt is not stored, only its check codes.
        body: draft.guardrail.failures.some(isDisclosureFailure) ? null : draft.text,
        aiRunId: draft.runId,
        promptId: prompts.agent.meta.id,
        promptVersion: prompts.agent.meta.version,
        guardrail: draft.guardrail,
      });
    }

    let reply: Message | null = null;
    if (final) {
      reply = await insertAiMessage(tx, conversation, {
        status: 'sent',
        body: final.text,
        aiRunId: final.runId,
        promptId: prompts.agent.meta.id,
        promptVersion: prompts.agent.meta.version,
        guardrail: final.guardrail,
      });
    } else if (useFallback) {
      reply = await insertAiMessage(tx, conversation, {
        status: 'sent',
        body: chatCopy.fallbackReply,
        aiRunId: lastRunId,
        promptId: 'chat-copy',
        promptVersion: chatCopy.version,
        guardrail: {
          passed: false,
          failures: failureCodes,
          attempt: blocked.length,
          fallback: true,
        },
      });
    }
    if (reply) {
      await recordLeadHistory(tx, {
        organizationId,
        leadId: lead.id,
        type: 'ai.replied',
        actor: aiActor,
        payload: {
          conversationId: conversation.id,
          messageId: reply.id,
          aiRunId: reply.aiRunId,
          fallback: useFallback,
          blockedDrafts: blocked.length,
        },
      });
    }

    for (const escalation of effects.escalations) {
      await createEscalation(tx, conversation, {
        reason: escalation.reason,
        messageId: escalation.messageId,
        aiRunId: lastRunId,
        actor: aiActor,
      });
    }
    await markMessagesHandled(
      tx,
      pending.map((m) => m.id),
    );
    return { reply, qualificationFields };
  });

  if (outcome.qualificationFields.length > 0) {
    await applyStageRule(db, organizationId, lead.id, 'firstAnswer');
  }

  return {
    outcome: final ? 'replied' : silent ? 'silent' : 'fallback',
    reasons: final ? [] : failureCodes,
    replyMessageId: outcome.reply?.id ?? null,
    escalations: effects.escalations.map((e) => e.reason),
    qualificationFields: outcome.qualificationFields,
  };
}

// ---------------------------------------------------------------------------------------------
// Model calls
// ---------------------------------------------------------------------------------------------

/** Transcript → model messages. The conversation must start with the prospect. */
function toLlmHistory(transcript: Message[]): LlmMessage[] {
  const history: LlmMessage[] = transcript
    .filter((m) => m.body)
    .map((m) => ({ role: m.author === 'lead' ? 'user' : 'assistant', content: m.body! }));
  while (history.length > 0 && history[0]!.role !== 'user') history.shift();
  return history;
}

function stateContext(
  context: ToolContext,
  effects: TurnEffects,
  feedback: string[] | null,
): string {
  const snapshot = leadContextSnapshot(context, effects);
  const lines = [
    '<conversation_state>',
    'Generated by the system from the CRM. Not written by the prospect.',
    `Known from the team or forms (do not ask again): ${snapshot.knownElsewhere.join(', ') || 'none'}`,
    `Collected in this chat: ${JSON.stringify(snapshot.collected)}`,
    `Still missing, most useful first: ${snapshot.missing.join(', ') || 'none'}`,
    `Prospect messages so far: ${context.leadMessages.length}`,
    '</conversation_state>',
  ];
  if (feedback?.length) {
    lines.push(
      '<review_feedback>',
      `Your previous draft was not sent because it failed these checks: ${feedback.join(', ')}.`,
      'Write a new, short reply that avoids them. If the prospect asked something you cannot confirm, say so and call request_human with reason cannot_confirm.',
      '</review_feedback>',
    );
  }
  return lines.join('\n');
}

type GenerateResult =
  { text: string; lastRunId: string } | { error: string; lastRunId: string | null };

/** One reply attempt: the model may call tools for up to `maxToolRounds` rounds. */
async function generateReply(
  db: Database,
  llm: LlmProvider,
  input: {
    base: TurnBase;
    prompt: PromptFile;
    system: string;
    systemContext: string;
    history: LlmMessage[];
    tools: LlmToolDefinition[];
    toolContext: ToolContext;
    effects: TurnEffects;
    metadata: Record<string, string>;
    flags: string[];
  },
): Promise<GenerateResult> {
  const messages = [...input.history];
  const texts: string[] = [];
  let lastRunId: string | null = null;
  let flags = input.flags;

  for (let round = 0; round <= aiConfig.maxToolRounds; round++) {
    let response: LlmResponse;
    const runId = newId();
    try {
      response = await llm.generate({
        model: 'conversation',
        promptId: `${input.prompt.meta.id}@${input.prompt.meta.version}`,
        system: input.system,
        systemContext: input.systemContext,
        messages,
        tools: input.tools,
        maxOutputTokens: aiConfig.maxReplyTokens,
        metadata: input.metadata,
      });
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'unexpected';
      await recordAiRun(db, {
        id: runId,
        ...input.base,
        purpose: 'turn',
        status: 'failed',
        provider: llm.name,
        model: llm.modelFor('conversation'),
        promptId: input.prompt.meta.id,
        promptVersion: input.prompt.meta.version,
        errorCode: code,
        flags,
      });
      return { error: `llm:${code}`, lastRunId: runId };
    }

    const toolUses = response.content.filter(
      (b): b is Extract<LlmContentBlock, { type: 'tool_use' }> => b.type === 'tool_use',
    );
    const offered = new Set(input.tools.map((t) => t.name));
    const runMeta = {
      id: runId,
      ...input.base,
      purpose: 'turn' as const,
      provider: llm.name,
      model: response.model,
      promptId: input.prompt.meta.id,
      promptVersion: input.prompt.meta.version,
      stopReason: response.stopReason,
      latencyMs: response.latencyMs,
      flags,
    };
    let outcomes: ToolOutcome[];
    let usage: ReturnType<typeof accountUsage>;
    try {
      usage = accountUsage(response.model, response.usage);
      outcomes = toolUses.map((use) =>
        offered.has(use.name)
          ? executeTool(use.name, use.input, input.toolContext, input.effects)
          : {
              record: { name: use.name, outcome: 'unknown_tool' as const, code: 'not_offered' },
              result: JSON.stringify({ status: 'rejected', reason: 'unknown_tool' }),
              isError: true,
            },
      );
    } catch {
      // Unexpected accounting or tool error: record the call without usage and stop (fail closed).
      await recordAiRun(db, { ...runMeta, status: 'failed', errorCode: 'internal' });
      return { error: 'internal', lastRunId: runId };
    }
    await recordAiRun(db, {
      ...runMeta,
      status: 'succeeded',
      ...usage,
      toolCalls: outcomes.map((o) => o.record),
    });
    lastRunId = runId;
    flags = [];

    for (const block of response.content) {
      if (block.type === 'text' && block.text.trim()) texts.push(block.text.trim());
    }

    if (response.stopReason === 'end_turn') return { text: texts.join('\n\n'), lastRunId };
    if (response.stopReason !== 'tool_use' || toolUses.length === 0) {
      return { error: `stop:${response.stopReason}`, lastRunId };
    }
    messages.push({ role: 'assistant', content: response.content });
    messages.push({
      role: 'user',
      content: toolUses.map((use, i) => ({
        type: 'tool_result' as const,
        toolUseId: use.id,
        content: outcomes[i]!.result,
        ...(outcomes[i]!.isError ? { isError: true } : {}),
      })),
    });
  }
  return { error: 'tool_rounds_exceeded', lastRunId };
}

async function runClassifier(
  db: Database,
  llm: LlmProvider,
  input: {
    base: TurnBase;
    prompt: PromptFile;
    draft: string;
    leadMessage: string;
    parentRunId: string;
    metadata: Record<string, string>;
  },
): Promise<string[]> {
  const outcome = await classifyDraft(llm, input.prompt, {
    draft: input.draft,
    leadMessage: input.leadMessage,
    metadata: input.metadata,
  });
  const response = outcome.response;
  let failures = outcome.failures;
  let errorCode = outcome.errorCode;
  let usage: ReturnType<typeof accountUsage> | null = null;
  if (response) {
    try {
      usage = accountUsage(response.model, response.usage);
    } catch {
      failures = ['classifier:internal'];
      errorCode = 'internal';
    }
  }
  const invalid = failures.some((f) => /^classifier:(invalid|error|internal)$/.test(f));
  await recordAiRun(db, {
    ...input.base,
    parentRunId: input.parentRunId,
    purpose: 'guardrail',
    status: invalid ? 'failed' : failures.length ? 'blocked' : 'succeeded',
    reason: failures.length ? failures.join(',').slice(0, 200) : null,
    provider: llm.name,
    model: response?.model ?? llm.modelFor('extraction'),
    promptId: input.prompt.meta.id,
    promptVersion: input.prompt.meta.version,
    stopReason: response?.stopReason ?? null,
    ...(usage ?? {}),
    latencyMs: response?.latencyMs ?? null,
    toolCalls: response
      ? response.content
          .filter((b) => b.type === 'tool_use')
          .map((b) => ({
            name: b.type === 'tool_use' ? b.name : 'unknown',
            outcome: invalid ? ('invalid' as const) : ('accepted' as const),
          }))
      : [],
    errorCode,
  });
  return failures;
}
