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
    modelName = 'gpt-4o-mini',
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
      temperature: request.temperature ?? 0.1,
      max_tokens: request.maxTokens ?? 2000,
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
