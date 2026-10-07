import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  escalationTopicRules,
  PUBLIC_PROMPT_PHRASES,
  injectionRule,
  matchRule,
  outputRules,
  underageRule,
  type EscalationTopicRule,
} from '@config/guardrails/rules';
import { aiConfig } from '@config/ai';
import type { PromptFile } from '@/lib/prompts';
import type { LlmProvider, LlmResponse, LlmToolDefinition } from '@/providers/llm/types';
import { toolInputSchema } from './schema';

/*
 * Output guardrails, in order, failing closed:
 *   1. deterministic rule filter (config/guardrails/rules.ts)
 *   2. leak check: canary string and long overlap with the system prompt
 *   3. model classifier (`output-guardrail` prompt, extraction slot)
 * Any error in a check counts as a failure.
 */

/**
 * Random marker placed in the system prompt. A reply that contains it is leaking the prompt.
 * Stable per process so prompt caching keeps working.
 */
export const PROMPT_CANARY = `pc-canary-${randomBytes(6).toString('hex')}`;

export function checkOutputRules(text: string): string[] {
  return outputRules.filter((rule) => matchRule(rule, text)).map((rule) => `rule:${rule.code}`);
}

function normalizeForOverlap(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Fails when the reply contains the canary or reproduces any 60-character run of the prompt. */
export function checkLeak(text: string, systemPrompt: string, canary = PROMPT_CANARY): string[] {
  if (text.includes(canary)) return ['leak:canary'];
  const reply = normalizeForOverlap(text);
  // Sample replies (« … ») and required public wording are meant to be said; they split the
  // prompt so no window spans them.
  let prompt = normalizeForOverlap(systemPrompt.replace(/«[^»]*»/g, '\u0000'));
  for (const phrase of PUBLIC_PROMPT_PHRASES) {
    prompt = prompt.split(normalizeForOverlap(phrase)).join('\u0000');
  }
  const window = 60;
  for (const part of prompt.split('\u0000')) {
    for (let i = 0; i + window <= part.length; i += 20) {
      if (reply.includes(part.slice(i, i + window))) return ['leak:prompt_overlap'];
    }
  }
  return [];
}

export function detectUnderage(text: string): boolean {
  return matchRule(underageRule, text);
}

export function detectInjection(text: string): boolean {
  return matchRule(injectionRule, text);
}

/** First always-escalate topic (business question 14) the message raises, if any. */
export function detectEscalationTopic(text: string): EscalationTopicRule | null {
  return escalationTopicRules.find((rule) => matchRule(rule, text)) ?? null;
}

const AI_DISCLOSURE =
  /\b(?:AI|A\.I\.|IA|I\.A\.)(?![a-z])|artificial intelligence|intelligence artificielle/i;

/**
 * The first reply of a conversation must say it comes from an AI (business question 13). The
 * chat page also shows the full disclosure; this makes sure the assistant says it itself.
 */
export function checkFirstReplyDisclosure(text: string): string[] {
  return AI_DISCLOSURE.test(text) ? [] : ['rule:ai_disclosure_missing'];
}

// ---------------------------------------------------------------------------------------------
// Classifier
// ---------------------------------------------------------------------------------------------

export const verdictSchema = z
  .object({
    personalized_financial_advice: z.boolean(),
    performance_guarantee: z.boolean(),
    unsupported_factual_claim: z.boolean(),
    internal_disclosure: z.boolean(),
    claims_to_be_human: z.boolean(),
    other_unsafe: z.boolean(),
  })
  .strict();

export const verdictTool: LlmToolDefinition = {
  name: 'report_verdict',
  description: 'Report the compliance verdict for the draft reply. Call exactly once.',
  inputSchema: toolInputSchema(verdictSchema),
};

export interface ClassifierOutcome {
  failures: string[];
  response: LlmResponse | null;
  errorCode: string | null;
}

function escapeTags(text: string): string {
  return text.replace(/</g, '‹').replace(/>/g, '›');
}

/**
 * Ask the classifier model for a verdict. Anything other than exactly one valid
 * `report_verdict` call is a failure (`classifier:invalid`).
 */
export async function classifyDraft(
  llm: LlmProvider,
  prompt: PromptFile,
  input: { draft: string; leadMessage: string; metadata: Record<string, string> },
): Promise<ClassifierOutcome> {
  let response: LlmResponse;
  try {
    response = await llm.generate({
      model: 'extraction',
      promptId: `${prompt.meta.id}@${prompt.meta.version}`,
      system: prompt.body,
      messages: [
        {
          role: 'user',
          content:
            `<prospect_message>\n${escapeTags(input.leadMessage)}\n</prospect_message>\n\n` +
            `<draft_reply>\n${escapeTags(input.draft)}\n</draft_reply>`,
        },
      ],
      tools: [verdictTool],
      maxOutputTokens: aiConfig.maxGuardrailTokens,
      metadata: input.metadata,
    });
  } catch (error) {
    return {
      failures: ['classifier:error'],
      response: null,
      errorCode: (error as { code?: string }).code ?? 'unexpected',
    };
  }
  const calls = response.content.filter(
    (block) => block.type === 'tool_use' && block.name === verdictTool.name,
  );
  const parsed =
    calls.length === 1 && calls[0]!.type === 'tool_use'
      ? verdictSchema.safeParse(calls[0]!.input)
      : null;
  if (!parsed?.success) {
    return { failures: ['classifier:invalid'], response, errorCode: null };
  }
  const failures = Object.entries(parsed.data)
    .filter(([, flagged]) => flagged)
    .map(([key]) => `classifier:${key}`);
  return { failures, response, errorCode: null };
}
