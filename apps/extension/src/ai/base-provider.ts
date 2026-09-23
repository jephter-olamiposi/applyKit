/**
 * @fileoverview Base HTTP Provider for external LLM API integrations.
 *
 * Implements resilient network dispatching with AbortSignal timeouts,
 * exponential backoff retries on transient 5xx/429 errors, and unified error mapping.
 *
 * Security Invariant (ADR-0002): All HTTP dispatches execute exclusively within
 * the Extension Service Worker background context. Content scripts never invoke these methods.
 */

import type { AIProvider, AIRequest, AIResponse, FinishReason, TokenUsage, AIProviderCapabilities } from '@applykit/domain';
import { parseAndValidateJsonResponse } from '@applykit/domain';

export abstract class BaseHttpProvider implements AIProvider {
  abstract readonly id: string;
  abstract readonly displayName: string;
  abstract readonly capabilities: AIProviderCapabilities;

  constructor(
    protected readonly apiKey: string,
    protected readonly modelName: string,
    protected readonly timeoutMs: number = 30000,
    protected readonly customFetch?: typeof fetch
  ) {}

  abstract complete<T = unknown>(request: AIRequest): Promise<AIResponse<T>>;

  /**
   * Executes an HTTP request with timeout protection and retry on rate limits or transient errors.
   */
  protected async fetchWithRetry(
    url: string,
    options: RequestInit,
    maxRetries = 2
  ): Promise<Response> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await (this.customFetch
          ? this.customFetch(url, { ...options, signal: controller.signal })
          : globalThis.fetch(url, { ...options, signal: controller.signal }));

        clearTimeout(timer);

        // Success or non-retryable client error (e.g. 400, 401, 403)
        if (response.ok || (response.status >= 400 && response.status < 429)) {
          return response;
        }

        // On 429 Quota/Rate Limit Exhaustion, capture error and break early for model fallback
        if (response.status === 429) {
          const bodyText = await response.text().catch(() => '');
          lastError = new Error(`Rate limit or quota exceeded (HTTP 429): ${bodyText || response.statusText}`);
          break;
        }

        // Retryable: 5xx Server Error
        if (response.status >= 500) {
          const bodyText = await response.text().catch(() => '');
          lastError = new Error(`Server error (HTTP ${response.status}): ${bodyText || response.statusText}`);
          if (attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }
          break;
        }

        return response;
      } catch (err) {
        clearTimeout(timer);
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt), 4000);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }

    throw lastError ?? new Error(`Network dispatch failed after ${maxRetries} retries.`);
  }

  /**
   * Parses structured JSON from raw LLM completion output.
   */
  protected parseJsonResult<T>(rawText: string): T | undefined {
    const result = parseAndValidateJsonResponse<T>(rawText);
    return result.data;
  }
}
