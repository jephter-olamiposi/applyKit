/**
 * @fileoverview Central AI Gateway, Rate Limiter, and Token Tracker.
 *
 * Coordinates provider dispatch, enforces client-side rate limits to prevent runaway
 * API charges, tracks token usage metrics, and enforces the Service Worker boundary (ADR-0002).
 */

import type {
  AIProvider,
  AIProviderName,
  AIRequest,
  AIResponse,
  TokenUsage,
} from '@applykit/domain';
import { OpenAIProvider } from './openai-provider.js';
import { AnthropicProvider } from './anthropic-provider.js';
import { GeminiProvider } from './gemini-provider.js';
import { OpenRouterProvider } from './openrouter-provider.js';

const STORAGE_KEYS = {
  PROVIDER_KEYS: 'applykit_secure_provider_keys',
  ACTIVE_PROVIDER: 'applykit_active_ai_provider',
  TOKEN_METRICS: 'applykit_ai_token_metrics',
} as const;

export type TokenMetricsMap = Record<AIProviderName, TokenUsage>;

const EMPTY_METRICS: TokenMetricsMap = {
  openai: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  anthropic: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  gemini: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  openrouter: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
};

export class AIGateway {
  private readonly requestTimestamps: number[] = [];
  private readonly maxRequestsPerMinute = 20;

  constructor(
    private readonly customStorage?: {
      get: (keys: string | string[]) => Promise<Record<string, unknown>>;
      set: (items: Record<string, unknown>) => Promise<void>;
    }
  ) {}

  private getStorage(): {
    get: (keys: string | string[]) => Promise<Record<string, unknown>>;
    set: (items: Record<string, unknown>) => Promise<void>;
  } {
    if (this.customStorage) {
      return this.customStorage;
    }
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return {
        get: (keys) => chrome.storage.local.get(keys),
        set: (items) => chrome.storage.local.set(items),
      };
    }
    // In-memory fallback for test harnesses without chrome.storage
    const mem = new Map<string, unknown>();
    return {
      get: async (keys) => {
        const result: Record<string, unknown> = {};
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) {
          result[k] = mem.get(k);
        }
        return result;
      },
      set: async (items) => {
        for (const [k, v] of Object.entries(items)) {
          mem.set(k, v);
        }
      },
    };
  }

  /**
   * Enforces sliding-window rate limiting to prevent accidental spam or excessive billing.
   */
  private checkRateLimit(): void {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Filter out timestamps older than 60 seconds
    while (this.requestTimestamps.length > 0 && (this.requestTimestamps[0] ?? 0) < oneMinuteAgo) {
      this.requestTimestamps.shift();
    }

    if (this.requestTimestamps.length >= this.maxRequestsPerMinute) {
      throw new Error(
        `Rate limit reached: Maximum ${this.maxRequestsPerMinute} requests per minute to prevent unexpected API costs. Please wait a moment.`
      );
    }

    this.requestTimestamps.push(now);
  }

  /**
   * Resolves the configured secret key for a given provider.
   */
  async getApiKey(provider: AIProviderName): Promise<string | null> {
    const storage = this.getStorage();
    const result = await storage.get(STORAGE_KEYS.PROVIDER_KEYS);
    const keys = (result[STORAGE_KEYS.PROVIDER_KEYS] as Record<string, string>) || {};
    const key = keys[provider]?.trim();
    return key && key.length > 0 ? key : null;
  }

  /**
   * Instantiates an AIProvider implementation.
   */
  createProvider(
    provider: AIProviderName,
    apiKey: string,
    modelName?: string,
    customFetch?: typeof fetch
  ): AIProvider {
    switch (provider) {
      case 'openai':
        return new OpenAIProvider(apiKey, modelName || 'gpt-4o-mini', 30000, customFetch);
      case 'anthropic':
        return new AnthropicProvider(apiKey, modelName || 'claude-3-5-haiku-20241022', 30000, customFetch);
      case 'gemini':
        return new GeminiProvider(apiKey, modelName || 'gemini-3.7-flash', 30000, customFetch);
      case 'openrouter':
        return new OpenRouterProvider(apiKey, modelName || 'meta-llama/llama-3.3-70b-instruct', 30000, customFetch);
    }
  }

  /**
   * Selects an available provider based on preferred selection or configured keys.
   */
  async resolveActiveProvider(
    preferred?: AIProviderName,
    customFetch?: typeof fetch
  ): Promise<{ provider: AIProvider; name: AIProviderName }> {
    const storage = this.getStorage();
    const result = await storage.get([STORAGE_KEYS.PROVIDER_KEYS, STORAGE_KEYS.ACTIVE_PROVIDER]);
    const keys = (result[STORAGE_KEYS.PROVIDER_KEYS] as Record<string, string>) || {};
    const storedActive = result[STORAGE_KEYS.ACTIVE_PROVIDER] as AIProviderName | undefined;

    const candidateProviders: AIProviderName[] = [
      preferred,
      storedActive,
      'gemini',
      'openai',
      'anthropic',
      'openrouter',
    ].filter(Boolean) as AIProviderName[];

    // Find the first provider with a non-empty key
    for (const name of candidateProviders) {
      const key = keys[name]?.trim();
      if (key && key.length > 0) {
        return {
          provider: this.createProvider(name, key, undefined, customFetch),
          name,
        };
      }
    }

    throw new Error(
      'No AI provider configured. Please configure an API key (Gemini, OpenAI, Anthropic, or OpenRouter) in Extension Settings.'
    );
  }

  /**
   * Records token consumption for audit and budgeting.
   */
  private async recordTokenUsage(provider: AIProviderName, usage?: TokenUsage): Promise<void> {
    if (!usage) return;

    const storage = this.getStorage();
    const result = await storage.get(STORAGE_KEYS.TOKEN_METRICS);
    const metrics: TokenMetricsMap = {
      ...EMPTY_METRICS,
      ...((result[STORAGE_KEYS.TOKEN_METRICS] as TokenMetricsMap) || {}),
    };

    const current = metrics[provider] || { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    metrics[provider] = {
      promptTokens: current.promptTokens + usage.promptTokens,
      completionTokens: current.completionTokens + usage.completionTokens,
      totalTokens: current.totalTokens + usage.totalTokens,
    };

    await storage.set({ [STORAGE_KEYS.TOKEN_METRICS]: metrics });
  }

  /**
   * Dispatches a scoped AI request through the active or specified provider.
   */
  async executeRequest<T = unknown>(
    request: AIRequest,
    preferredProvider?: AIProviderName,
    customFetch?: typeof fetch
  ): Promise<AIResponse<T>> {
    this.checkRateLimit();

    const { provider, name } = await this.resolveActiveProvider(preferredProvider, customFetch);
    const response = await provider.complete<T>(request);

    if (response.usage) {
      await this.recordTokenUsage(name, response.usage);
    }

    return response;
  }

  /**
   * Retrieves cumulative token usage metrics across all providers.
   */
  async getTokenMetrics(): Promise<TokenMetricsMap> {
    const storage = this.getStorage();
    const result = await storage.get(STORAGE_KEYS.TOKEN_METRICS);
    return {
      ...EMPTY_METRICS,
      ...((result[STORAGE_KEYS.TOKEN_METRICS] as TokenMetricsMap) || {}),
    };
  }

  /**
   * Resets all accumulated token consumption metrics.
   */
  async resetTokenMetrics(): Promise<void> {
    const storage = this.getStorage();
    await storage.set({ [STORAGE_KEYS.TOKEN_METRICS]: EMPTY_METRICS });
  }
}
