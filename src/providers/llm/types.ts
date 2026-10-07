/*
 * LLM provider contract. The AI qualification agent depends on this interface, never on a vendor
 * SDK directly. Implementations: `anthropic.ts` (production) and `scripted.ts` (tests and evals).
 */

export type LlmRole = 'user' | 'assistant';

export interface LlmTextBlock {
  type: 'text';
  text: string;
}

export interface LlmToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

export interface LlmToolResultBlock {
  type: 'tool_result';
  toolUseId: string;
  content: string;
  isError?: boolean;
}

/**
 * Provider-specific block the caller must hand back unchanged on the next request of the same
 * turn (e.g. model reasoning). Never shown, stored or logged.
 */
export interface LlmOpaqueBlock {
  type: 'opaque';
  raw: unknown;
}

export type LlmContentBlock = LlmTextBlock | LlmToolUseBlock | LlmToolResultBlock | LlmOpaqueBlock;

export interface LlmMessage {
  role: LlmRole;
  content: string | LlmContentBlock[];
}

export interface LlmToolDefinition {
  name: string;
  description: string;
  /** JSON Schema for the tool input (generated from a Zod schema by the caller). */
  inputSchema: Record<string, unknown>;
}

export interface LlmRequest {
  /** Logical model slot; mapped to a concrete model id by configuration. */
  model: 'conversation' | 'extraction';
  /** Versioned prompt id from config/prompts (e.g. "qualification-agent@0.1.0"). */
  promptId: string;
  /** Stable part of the system prompt (cacheable), then per-turn context. */
  system: string;
  systemContext?: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  maxOutputTokens: number;
  /** Correlates the call with ai_runs / lead records for auditing. */
  metadata?: { leadId?: string; conversationId?: string; requestId?: string };
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface LlmResponse {
  content: LlmContentBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'refusal' | 'other';
  usage: LlmUsage;
  /** Concrete model id that served the request. */
  model: string;
  latencyMs: number;
}

export interface LlmProvider {
  readonly name: string;
  /** Concrete model id configured for a slot, or null when not configured. */
  modelFor(slot: LlmRequest['model']): string | null;
  generate(request: LlmRequest): Promise<LlmResponse>;
}

export type LlmErrorCode =
  | 'not_configured'
  | 'rate_limited'
  | 'overloaded'
  | 'timeout'
  | 'connection'
  | 'bad_request'
  | 'auth'
  | 'provider_error';

/** Provider failure. Carries a code only: vendor messages may echo request content. */
export class LlmProviderError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    readonly status?: number,
  ) {
    super(`LLM provider error: ${code}`);
    this.name = 'LlmProviderError';
  }
}
