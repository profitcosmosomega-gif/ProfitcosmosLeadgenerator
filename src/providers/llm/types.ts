/*
 * LLM provider contract. Types only in Phase 1 — no implementation, no prompts.
 * The AI qualification agent (Phase 3) depends on this interface, never on a vendor SDK directly.
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

export type LlmContentBlock = LlmTextBlock | LlmToolUseBlock | LlmToolResultBlock;

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
  system: string;
  messages: LlmMessage[];
  tools?: LlmToolDefinition[];
  maxOutputTokens: number;
  temperature?: number;
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
  generate(request: LlmRequest): Promise<LlmResponse>;
}
