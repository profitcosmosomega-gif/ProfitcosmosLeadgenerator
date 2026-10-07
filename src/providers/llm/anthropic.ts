import Anthropic from '@anthropic-ai/sdk';
import {
  LlmProviderError,
  type LlmContentBlock,
  type LlmMessage,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from './types';

/**
 * Anthropic Claude implementation of `LlmProvider`.
 *
 * - Model ids come from configuration (`LLM_MODEL_CONVERSATION` / `LLM_MODEL_EXTRACTION`).
 * - The stable system prompt is marked for prompt caching; per-turn context follows it.
 * - Reasoning blocks are passed back verbatim as opaque blocks within a turn.
 * - Errors are mapped to codes; vendor error messages are not propagated (they may echo content).
 */
export class AnthropicLlmProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    private readonly options: {
      apiKey: string;
      models: { conversation?: string; extraction?: string };
      timeoutMs?: number;
    },
  ) {
    this.client = new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? 60_000,
      maxRetries: 2,
    });
  }

  modelFor(slot: LlmRequest['model']): string | null {
    return this.options.models[slot] ?? null;
  }

  async generate(request: LlmRequest): Promise<LlmResponse> {
    const model = this.modelFor(request.model);
    if (!model) throw new LlmProviderError('not_configured');

    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: request.system, cache_control: { type: 'ephemeral' } },
    ];
    if (request.systemContext) system.push({ type: 'text', text: request.systemContext });

    const started = performance.now();
    let response: Anthropic.Message;
    try {
      response = await this.client.messages.create({
        model,
        max_tokens: request.maxOutputTokens,
        system,
        messages: request.messages.map(toParam),
        ...(request.tools?.length
          ? {
              tools: request.tools.map((tool) => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
              })),
            }
          : {}),
      });
    } catch (error) {
      throw mapError(error);
    }
    const latencyMs = Math.round(performance.now() - started);

    return {
      content: response.content.map(fromBlock),
      stopReason: mapStopReason(response.stop_reason),
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      },
      model: response.model,
      latencyMs,
    };
  }
}

function toParam(message: LlmMessage): Anthropic.MessageParam {
  if (typeof message.content === 'string') return { role: message.role, content: message.content };
  return {
    role: message.role,
    content: message.content.map((block): Anthropic.ContentBlockParam => {
      switch (block.type) {
        case 'text':
          return { type: 'text', text: block.text };
        case 'tool_use':
          return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
        case 'tool_result':
          return {
            type: 'tool_result',
            tool_use_id: block.toolUseId,
            content: block.content,
            ...(block.isError ? { is_error: true } : {}),
          };
        case 'opaque':
          return block.raw as Anthropic.ContentBlockParam;
      }
    }),
  };
}

function fromBlock(block: Anthropic.ContentBlock): LlmContentBlock {
  if (block.type === 'text') return { type: 'text', text: block.text };
  if (block.type === 'tool_use') {
    return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
  }
  return { type: 'opaque', raw: block };
}

function mapStopReason(reason: Anthropic.StopReason | null): LlmResponse['stopReason'] {
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'end_turn';
    case 'tool_use':
      return 'tool_use';
    case 'max_tokens':
    case 'model_context_window_exceeded':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

function mapError(error: unknown): LlmProviderError {
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new LlmProviderError('timeout');
  if (error instanceof Anthropic.APIConnectionError) return new LlmProviderError('connection');
  if (error instanceof Anthropic.RateLimitError) return new LlmProviderError('rate_limited', 429);
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError
  ) {
    return new LlmProviderError('auth', error.status);
  }
  if (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.NotFoundError) {
    return new LlmProviderError('bad_request', error.status);
  }
  if (error instanceof Anthropic.APIError) {
    return new LlmProviderError(
      error.status === 529 ? 'overloaded' : 'provider_error',
      error.status,
    );
  }
  return new LlmProviderError('provider_error');
}
