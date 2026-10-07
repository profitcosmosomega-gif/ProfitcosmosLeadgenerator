import type { LlmContentBlock, LlmProvider, LlmRequest, LlmResponse } from './types';

/**
 * A step returns the model's response for one request. It receives the request so scripted
 * evals can assert on what the pipeline sent (tools offered, context, history).
 */
export type ScriptedStep =
  | (Partial<LlmResponse> & { content: LlmContentBlock[] })
  | ((request: LlmRequest) => Partial<LlmResponse> & { content: LlmContentBlock[] })
  | Error;

/**
 * Deterministic `LlmProvider` for tests and scripted evaluations. Each slot plays its own
 * queue of steps in order; running out of steps throws, so a test notices unexpected calls.
 */
export class ScriptedLlmProvider implements LlmProvider {
  readonly name = 'scripted';
  readonly requests: LlmRequest[] = [];
  private readonly queues: Record<LlmRequest['model'], ScriptedStep[]>;

  constructor(script: { conversation?: ScriptedStep[]; extraction?: ScriptedStep[] }) {
    this.queues = {
      conversation: [...(script.conversation ?? [])],
      extraction: [...(script.extraction ?? [])],
    };
  }

  modelFor(slot: LlmRequest['model']): string {
    return `scripted-${slot}`;
  }

  remaining(slot: LlmRequest['model']): number {
    return this.queues[slot].length;
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    this.requests.push(request);
    const step = this.queues[request.model].shift();
    if (!step) throw new Error(`ScriptedLlmProvider: no scripted ${request.model} response left`);
    if (step instanceof Error) throw step;
    const result = typeof step === 'function' ? step(request) : step;
    const hasToolUse = result.content.some((block) => block.type === 'tool_use');
    return {
      stopReason: hasToolUse ? 'tool_use' : 'end_turn',
      usage: { inputTokens: 100, outputTokens: 20 },
      model: this.modelFor(request.model),
      latencyMs: 1,
      ...result,
    };
  }
}

/** Helpers to build scripted responses. */
export const say = (text: string): ScriptedStep => ({ content: [{ type: 'text', text }] });

export const callTool = (name: string, input: unknown, text?: string): ScriptedStep => ({
  content: [
    ...(text ? [{ type: 'text' as const, text }] : []),
    {
      type: 'tool_use',
      id: `toolu_${name}_${Math.random().toString(36).slice(2, 10)}`,
      name,
      input,
    },
  ],
});
