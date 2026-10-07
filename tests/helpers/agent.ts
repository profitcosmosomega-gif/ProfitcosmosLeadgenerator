import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { aiRuns, conversationEscalations, messages, type Conversation } from '@/db/schema';
import { loadActivePrompt } from '@/lib/prompts';
import type { AgentDeps } from '@/modules/agent/pipeline';
import { addLeadMessage, startConversation } from '@/modules/conversations/service';
import { captureLead } from '@/modules/leads/capture';
import type { QualificationInput } from '@/modules/leads/schemas';
import { callTool, type ScriptedStep } from '@/providers/llm/scripted';
import type { LlmProvider } from '@/providers/llm/types';

/** Agent dependencies for tests: scripted model, draft prompts allowed (test env only). */
export function testDeps(llm: LlmProvider | null, overrides: Partial<AgentDeps> = {}): AgentDeps {
  return {
    llm,
    loadPrompt: (id) => loadActivePrompt(id, { allowDraft: true }),
    aiEnabled: true,
    copyApproved: true,
    dailyTokenLimit: 10_000_000,
    monthlyBudgetMicroUsd: 1_000_000_000,
    ...overrides,
  };
}

const VERDICT_KEYS = [
  'personalized_financial_advice',
  'performance_guarantee',
  'unsupported_factual_claim',
  'internal_disclosure',
  'claims_to_be_human',
  'other_unsafe',
] as const;

/** Classifier response that passes the draft, or flags the given verdict keys. */
export function verdict(...flagged: (typeof VERDICT_KEYS)[number][]): ScriptedStep {
  return callTool(
    'report_verdict',
    Object.fromEntries(VERDICT_KEYS.map((key) => [key, flagged.includes(key)])),
  );
}

/** First-reply disclosure the prompt asks for (business questions 2 and 13). */
export const INTRO =
  "Hi, I'm the ProfitCosmos Omega AI Assistant. I share educational information, not personalized financial advice, and trading involves risk: results are not guaranteed.";

export const intro = (text: string) => `${INTRO} ${text}`;

let counter = 0;

/** A lead who came in through the chat pre-chat form, with an open conversation. */
export async function startChat(
  organizationId: string,
  options: { email?: string; qualification?: QualificationInput; adult?: boolean } = {},
): Promise<{ leadId: string; conversation: Conversation; accessToken: string }> {
  const db = getDb();
  return db.transaction(async (tx) => {
    const captured = await captureLead(tx, {
      organizationId,
      channel: 'chat',
      contact: {
        email: options.email ?? `chat${++counter}@example.test`,
        ageConfirmed18plus: options.adult ?? true,
      },
      qualification: options.qualification,
      actor: { type: 'lead' },
    });
    const started = await startConversation(tx, {
      organizationId,
      leadId: captured.leadId!,
      channel: 'web',
      actor: { type: 'lead' },
    });
    return { leadId: captured.leadId!, ...started };
  });
}

export function leadSays(conversation: Conversation, text: string) {
  return addLeadMessage(getDb(), { conversation, text });
}

export async function conversationRows(conversationId: string) {
  const db = getDb();
  const [msgs, runs, flags] = await Promise.all([
    db.select().from(messages).where(eq(messages.conversationId, conversationId)),
    db.select().from(aiRuns).where(eq(aiRuns.conversationId, conversationId)),
    db
      .select()
      .from(conversationEscalations)
      .where(eq(conversationEscalations.conversationId, conversationId)),
  ]);
  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
  return { messages: msgs.sort(byId), runs: runs.sort(byId), escalations: flags };
}
