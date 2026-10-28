/**
 * @fileoverview OpenAI Chat Completions Provider.
 *
 * Implements native structured JSON output via response_format: { type: "json_object" }.
 * Exclusively instantiated and invoked inside the Extension Service Worker.
 */

import type {
  AIRequest,
  AIResponse,
  AIProviderCapabilities,
  FinishReason,
  TokenUsage,
} from '@applykit/domain';
import { BaseHttpProvider } from './base-provider.js';

/**
 * Default OpenAI model. gpt-4o-mini is deprecated with removal on January 14, 2027, and
 * OpenAI lists gpt-6-luna as its replacement. Newer models reject a custom temperature and
 * the legacy max_tokens field, so the request uses max_completion_tokens and no sampling
 * overrides.
 */
export const DEFAULT_OPENAI_MODEL = 'gpt-6-luna';

interface OpenAiChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export class OpenAIProvider extends BaseHttpProvider {
  readonly id = 'openai';
  readonly displayName = 'OpenAI (GPT-4o Mini / GPT-4o)';
  readonly capabilities: AIProviderCapabilities = {
    supportsStreaming: true,
    supportsJsonSchema: true,
    maxContextTokens: 128000,
    isLocal: false,
  };

  constructor(
    apiKey: string,
    modelName = DEFAULT_OPENAI_MODEL,
    timeoutMs = 30000,
    customFetch?: typeof fetch
  ) {
    super(apiKey, modelName, timeoutMs, customFetch);
  }

  async complete<T = unknown>(request: AIRequest): Promise<AIResponse<T>> {
    const url = 'https://api.openai.com/v1/chat/completions';

    const messages = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.prompt });

    const body = {
      model: this.modelName,
      messages,
      max_completion_tokens: request.maxTokens ?? 2000,
      response_format: { type: 'json_object' },
    };

    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`OpenAI API request failed (${res.status}): ${errorBody}`);
    }

    const data = (await res.json()) as OpenAiChatCompletionResponse;
    const choice = data.choices[0];
    const rawText = choice?.message?.content || '';

    const finishReason: FinishReason =
      choice?.finish_reason === 'stop'
        ? 'stop'
        : choice?.finish_reason === 'length'
        ? 'length'
        : choice?.finish_reason === 'content_filter'
        ? 'content_filter'
        : 'unknown';

    const usage: TokenUsage | undefined = data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
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
