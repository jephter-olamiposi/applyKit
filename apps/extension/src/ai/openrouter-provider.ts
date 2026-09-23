/**
 * @fileoverview OpenRouter Multi-Model Gateway Provider.
 *
 * Implements OpenRouter chat completions with OpenAI-compatible payload schemas.
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

interface OpenRouterResponse {
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

export class OpenRouterProvider extends BaseHttpProvider {
  readonly id = 'openrouter';
  readonly displayName = 'OpenRouter (Llama 3.3 / Mistral / Claude)';
  readonly capabilities: AIProviderCapabilities = {
    supportsStreaming: true,
    supportsJsonSchema: true,
    maxContextTokens: 128000,
    isLocal: false,
  };

  constructor(
    apiKey: string,
    modelName = 'meta-llama/llama-3.3-70b-instruct',
    timeoutMs = 30000,
    customFetch?: typeof fetch
  ) {
    super(apiKey, modelName, timeoutMs, customFetch);
  }

  async complete<T = unknown>(request: AIRequest): Promise<AIResponse<T>> {
    const url = 'https://openrouter.ai/api/v1/chat/completions';

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
        'HTTP-Referer': 'https://applykit.local',
        'X-Title': 'ApplyKit Job Application Copilot',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`OpenRouter API request failed (${res.status}): ${errorBody}`);
    }

    const data = (await res.json()) as OpenRouterResponse;
    const choice = data.choices?.[0];
    const rawText = choice?.message?.content || '';

    const finishReason: FinishReason =
      choice?.finish_reason === 'stop'
        ? 'stop'
        : choice?.finish_reason === 'length'
        ? 'length'
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
