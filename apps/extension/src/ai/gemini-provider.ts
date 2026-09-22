/**
 * @fileoverview Google Gemini generateContent API Provider.
 *
 * Implements native JSON mode via generationConfig.responseMimeType = "application/json".
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

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export class GeminiProvider extends BaseHttpProvider {
  readonly id = 'gemini';
  readonly displayName = 'Google Gemini (1.5 Flash / Pro)';
  readonly capabilities: AIProviderCapabilities = {
    supportsStreaming: true,
    supportsJsonSchema: true,
    maxContextTokens: 1000000,
    isLocal: false,
  };

  constructor(
    apiKey: string,
    modelName = 'gemini-1.5-flash',
    timeoutMs = 30000,
    customFetch: typeof fetch = fetch
  ) {
    super(apiKey, modelName, timeoutMs, customFetch);
  }

  async complete<T = unknown>(request: AIRequest): Promise<AIResponse<T>> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;

    const body: Record<string, unknown> = {
      contents: [
        {
          role: 'user',
          parts: [{ text: request.prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: request.temperature ?? 0.1,
        maxOutputTokens: request.maxTokens ?? 2500,
      },
    };

    if (request.systemPrompt) {
      body.systemInstruction = {
        parts: [{ text: request.systemPrompt }],
      };
    }

    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Google Gemini API request failed (${res.status}): ${errorBody}`);
    }

    const data = (await res.json()) as GeminiGenerateContentResponse;
    const candidate = data.candidates?.[0];
    const rawText = candidate?.content?.parts?.[0]?.text || '';

    const finishReason: FinishReason =
      candidate?.finishReason === 'STOP'
        ? 'stop'
        : candidate?.finishReason === 'MAX_TOKENS'
        ? 'length'
        : candidate?.finishReason === 'SAFETY'
        ? 'content_filter'
        : 'unknown';

    const usage: TokenUsage | undefined = data.usageMetadata
      ? {
          promptTokens: data.usageMetadata.promptTokenCount ?? 0,
          completionTokens: data.usageMetadata.candidatesTokenCount ?? 0,
          totalTokens: data.usageMetadata.totalTokenCount ?? 0,
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
