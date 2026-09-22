import type { FocusedContext, AIContextType } from './contexts.js';

/**
 * Recognized AI provider identifiers supported by ApplyKit.
 */
export type AIProviderName = 'openai' | 'anthropic' | 'gemini' | 'openrouter';

/**
 * Token consumption metrics for an AI generation request.
 */
export interface TokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/**
 * Model completion termination classification.
 */
export type FinishReason =
  | 'stop'
  | 'length'
  | 'tool_calls'
  | 'content_filter'
  | 'unknown';

/**
 * Structured response payload returned by an AI provider.
 */
export interface AIResponse<T = unknown> {
  readonly rawText: string;
  readonly parsed?: T;
  readonly usage?: TokenUsage;
  readonly finishReason: FinishReason;
}

/**
 * Outbound request payload passed to an AI provider.
 */
export interface AIRequest<TContext extends FocusedContext = FocusedContext> {
  readonly prompt: string;
  readonly systemPrompt?: string;
  readonly contextType: AIContextType;
  readonly contextPayload: TContext;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** JSON schema enforcing structured output validation. */
  readonly jsonSchema?: Readonly<Record<string, unknown>>;
}

/**
 * Functional capabilities and operational constraints of a specific AI provider.
 */
export interface AIProviderCapabilities {
  readonly supportsStreaming: boolean;
  readonly supportsJsonSchema: boolean;
  readonly maxContextTokens: number;
  /** True for local offline engines (Ollama, WebLLM, Chrome Prompt API). */
  readonly isLocal: boolean;
}

/**
 * Common abstraction over cloud and local LLM providers (Anthropic, OpenAI, Gemini, Ollama).
 *
 * Security Invariant: In the Chrome extension runtime, all implementations of AIProvider are strictly
 * instantiated and executed inside the Extension Service Worker background context. API keys never touch
 * content scripts, host web pages, or the DOM.
 */
export interface AIProvider {
  readonly id: string;
  readonly displayName: string;
  readonly capabilities: AIProviderCapabilities;

  /**
   * Dispatches a scoped request to the underlying model.
   */
  complete<T = unknown>(request: AIRequest): Promise<AIResponse<T>>;
}
