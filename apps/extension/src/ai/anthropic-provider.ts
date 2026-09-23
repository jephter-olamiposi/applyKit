/**
 * @fileoverview Anthropic Claude Messages API Provider.
 *
 * Implements Claude 3.5 Sonnet / Haiku integration.
 * Invariant: Invoked exclusively from Extension Service Worker.
 */

import type {
  AIRequest,
  AIResponse,
  AIProviderCapabilities,
  FinishReason,
  TokenUsage,
} from '@applykit/domain';
import { BaseHttpProvider } from './base-provider.js';

interface AnthropicMessageResponse {
  content: Array<{
    type: string;
    text: string;
  }>;
  stop_reason: string | null;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

export class AnthropicProvider extends BaseHttpProvider {
  readonly id = 'anthropic';
  readonly displayName = 'Anthropic Claude (3.5 Haiku / Sonnet)';
  readonly capabilities: AIProviderCapabilities = {
    supportsStreaming: true,
    supportsJsonSchema: false,
    maxContextTokens: 200000,
    isLocal: false,
  };

  constructor(
    apiKey: string,
    modelName = 'claude-3-5-haiku-20241022',
    timeoutMs = 30000,
    customFetch?: typeof fetch
  ) {
    super(apiKey, modelName, timeoutMs, customFetch);
  }

  async complete<T = unknown>(request: AIRequest): Promise<AIResponse<T>> {
    const url = 'https://api.anthropic.com/v1/messages';

    const body: Record<string, unknown> = {
      model: this.modelName,
      max_tokens: request.maxTokens ?? 2500,
      temperature: request.temperature ?? 0.1,
      messages: [{ role: 'user', content: request.prompt }],
    };

    if (request.systemPrompt) {
      body.system = request.systemPrompt;
    }

    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'dangerously-allow-browser': 'true',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Anthropic API request failed (${res.status}): ${errorBody}`);
    }

    const data = (await res.json()) as AnthropicMessageResponse;
    const textPart = data.content.find((c) => c.type === 'text');
    const rawText = textPart?.text || '';

    const finishReason: FinishReason =
      data.stop_reason === 'end_turn' || data.stop_reason === 'stop_sequence'
        ? 'stop'
        : data.stop_reason === 'max_tokens'
        ? 'length'
        : 'unknown';

    const usage: TokenUsage | undefined = data.usage
      ? {
          promptTokens: data.usage.input_tokens,
          completionTokens: data.usage.output_tokens,
          totalTokens: data.usage.input_tokens + data.usage.output_tokens,
        }
      : undefined;

    const parsed = this.parseJsonResult<T>(rawText);

    return {
      rawText,
      parsed,
      usage,
      finishReason,
    };
  }
}
