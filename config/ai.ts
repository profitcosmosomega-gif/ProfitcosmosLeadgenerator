/*
 * AI qualification agent limits (Phase 3). Code defaults, reviewed with the plan
 * (docs/phase-3-plan.md §8). Model ids and the daily token ceiling come from the environment.
 */

export const aiConfig = {
  /** Longest message a lead can send, in characters. */
  maxLeadMessageChars: 2_000,
  /** Lead messages accepted per conversation; further messages are refused. */
  maxLeadMessagesPerConversation: 40,
  /** AI turns per lead in any rolling 24 hours. */
  maxTurnsPerLeadPerDay: 30,
  /** Public chat messages per IP per minute. */
  publicChatMessagesPerMinute: 10,
  /** Tool-use rounds the model may take inside one turn before the turn fails closed. */
  maxToolRounds: 3,
  /** Messages of history sent to the model. */
  historyMessages: 20,
  /** Output token caps for a reply (two or three sentences) and for a guardrail verdict. */
  maxReplyTokens: 1_000,
  maxGuardrailTokens: 500,
  /** Worker lease on a conversation while a turn runs. */
  turnLeaseSeconds: 120,
} as const;

/**
 * Prices in US dollars per million tokens, for cost accounting in `ai_runs`. Dated model ids
 * (e.g. `claude-haiku-4-5-20251001`) use the price of their alias. A model missing here records
 * cost as null (unknown), never as zero.
 */
export const llmPricing: Record<
  string,
  { input: number; output: number; cacheRead: number; cacheWrite: number }
> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};
