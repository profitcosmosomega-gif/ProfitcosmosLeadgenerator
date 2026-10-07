import { getEnv } from '@/lib/env';
import { AnthropicLlmProvider } from './anthropic';
import type { LlmProvider } from './types';

const globalForLlm = globalThis as unknown as { __pcLlm?: LlmProvider | null };

/**
 * The configured LLM provider, or null when the AI is switched off (`AI_ENABLED=false`) or not
 * configured (no API key). Callers must treat null as "do not call any model".
 */
export function getLlmProvider(): LlmProvider | null {
  const env = getEnv();
  if (!env.AI_ENABLED || !env.ANTHROPIC_API_KEY) return null;
  globalForLlm.__pcLlm ??= new AnthropicLlmProvider({
    apiKey: env.ANTHROPIC_API_KEY,
    models: {
      conversation: env.LLM_MODEL_CONVERSATION,
      extraction: env.LLM_MODEL_EXTRACTION,
    },
  });
  return globalForLlm.__pcLlm;
}

export type { LlmProvider } from './types';
