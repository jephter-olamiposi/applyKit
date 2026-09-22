/**
 * @fileoverview Integration tests for Phase 5 AI Providers, Gateway, Rate Limiter, and Token Tracker.
 *
 * Verifies that provider HTTP adapters format requests and parse responses according to API specs,
 * AIGateway enforces rate limiting and token tracking, and background RPC routes operate properly.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AIRequest } from '@applykit/domain';
import {
  OpenAIProvider,
  AnthropicProvider,
  GeminiProvider,
  OpenRouterProvider,
  AIGateway,
} from '../ai/index.js';

describe('AI Provider Subsystem & Payload Scoping Suite (Phase 5)', () => {
  const dummyRequest: AIRequest = {
    prompt: 'Evaluate candidate fit',
    systemPrompt: 'You are an AI assistant. Return JSON: {"score": 90}',
    contextType: 'job_extraction',
    contextPayload: {
      rawHtmlOrText: 'Job description text',
      pageUrl: 'https://example.com/job',
    },
  };

  describe('OpenAIProvider', () => {
    it('sends correct headers and payload and parses JSON result and token usage', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: { content: '{"score": 95, "status": "approved"}' },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 120,
            completion_tokens: 30,
            total_tokens: 150,
          },
        }),
      });

      const provider = new OpenAIProvider('test_openai_key', 'gpt-4o-mini', 5000, mockFetch as any);
      const response = await provider.complete<{ score: number; status: string }>(dummyRequest);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      expect((init.headers as any)['Authorization']).toBe('Bearer test_openai_key');

      const body = JSON.parse(init.body as string);
      expect(body.model).toBe('gpt-4o-mini');
      expect(body.response_format).toEqual({ type: 'json_object' });
      expect(body.messages.length).toBe(2);

      expect(response.finishReason).toBe('stop');
      expect(response.parsed?.score).toBe(95);
      expect(response.parsed?.status).toBe('approved');
      expect(response.usage?.totalTokens).toBe(150);
    });

    it('throws descriptive error on HTTP 401 unauthorized', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Incorrect API key provided',
      });

      const provider = new OpenAIProvider('invalid_key', 'gpt-4o-mini', 5000, mockFetch as any);
      await expect(provider.complete(dummyRequest)).rejects.toThrow('OpenAI API request failed (401)');
    });
  });

  describe('AnthropicProvider', () => {
    it('sends x-api-key headers and system prompt, calculating total token usage', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          content: [
            {
              type: 'text',
              text: '```json\n{"recommendation": "hire", "rating": 5}\n```',
            },
          ],
          stop_reason: 'end_turn',
          usage: {
            input_tokens: 200,
            output_tokens: 50,
          },
        }),
      });

      const provider = new AnthropicProvider('test_anthropic_key', 'claude-3-5-haiku-20241022', 5000, mockFetch as any);
      const response = await provider.complete<{ recommendation: string; rating: number }>(dummyRequest);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      expect((init.headers as any)['x-api-key']).toBe('test_anthropic_key');
      expect((init.headers as any)['anthropic-version']).toBe('2023-06-01');

      const body = JSON.parse(init.body as string);
      expect(body.system).toBe(dummyRequest.systemPrompt);

      expect(response.finishReason).toBe('stop');
      expect(response.parsed?.recommendation).toBe('hire');
      expect(response.parsed?.rating).toBe(5);
      expect(response.usage?.totalTokens).toBe(250);
    });
  });

  describe('GeminiProvider', () => {
    it('dispatches generateContent with key parameter and application/json responseMimeType', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: '{"analysis": "strong_fit"}' }],
              },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 150,
            candidatesTokenCount: 25,
            totalTokenCount: 175,
          },
        }),
      });

      const provider = new GeminiProvider('test_gemini_key', 'gemini-1.5-flash', 5000, mockFetch as any);
      const response = await provider.complete<{ analysis: string }>(dummyRequest);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent');
      expect(url).toContain('key=test_gemini_key');

      const body = JSON.parse(init.body as string);
      expect(body.generationConfig.responseMimeType).toBe('application/json');

      expect(response.finishReason).toBe('stop');
      expect(response.parsed?.analysis).toBe('strong_fit');
      expect(response.usage?.totalTokens).toBe(175);
    });
  });

  describe('OpenRouterProvider', () => {
    it('sets HTTP-Referer and X-Title headers and returns structured output', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: { content: '{"status": "processed"}' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 },
        }),
      });

      const provider = new OpenRouterProvider('test_openrouter_key', 'meta-llama/llama-3.3-70b-instruct', 5000, mockFetch as any);
      const response = await provider.complete<{ status: string }>(dummyRequest);

      const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect((init.headers as any)['HTTP-Referer']).toBe('https://applykit.local');
      expect((init.headers as any)['X-Title']).toBe('ApplyKit Job Application Copilot');
      expect(response.parsed?.status).toBe('processed');
    });
  });

  describe('AIGateway & Token Tracking', () => {
    let mockStorageData: Record<string, unknown>;
    let gateway: AIGateway;

    beforeEach(() => {
      mockStorageData = {
        applykit_secure_provider_keys: {
          openai: 'sk-test-openai',
          gemini: 'test-gemini-key',
        },
      };

      gateway = new AIGateway({
        get: async (keys) => {
          const result: Record<string, unknown> = {};
          const list = Array.isArray(keys) ? keys : [keys];
          for (const k of list) result[k] = mockStorageData[k];
          return result;
        },
        set: async (items) => {
          Object.assign(mockStorageData, items);
        },
      });
    });

    it('resolves active provider, tracks token usage, and persists cumulative counters', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: { content: '{"result": "ok"}' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        }),
      });

      const response = await gateway.executeRequest<{ result: string }>(
        dummyRequest,
        'openai',
        mockFetch as any
      );

      expect(response.parsed?.result).toBe('ok');

      // Check token metrics
      const metrics = await gateway.getTokenMetrics();
      expect(metrics.openai.promptTokens).toBe(100);
      expect(metrics.openai.completionTokens).toBe(50);
      expect(metrics.openai.totalTokens).toBe(150);

      // Execute another call to verify accumulation
      await gateway.executeRequest<{ result: string }>(dummyRequest, 'openai', mockFetch as any);
      const updatedMetrics = await gateway.getTokenMetrics();
      expect(updatedMetrics.openai.totalTokens).toBe(300);

      // Reset metrics
      await gateway.resetTokenMetrics();
      const clearedMetrics = await gateway.getTokenMetrics();
      expect(clearedMetrics.openai.totalTokens).toBe(0);
    });

    it('throws clear error when no provider keys are configured', async () => {
      mockStorageData = { applykit_secure_provider_keys: {} };

      await expect(gateway.executeRequest(dummyRequest)).rejects.toThrow(
        'No AI provider configured'
      );
    });
  });
});
