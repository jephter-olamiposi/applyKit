import { describe, it, expect } from 'vitest';
import {
  wrapUntrustedContent,
  sanitizePromptInput,
  buildHardenedSystemPrompt,
  type AIProvider,
  type AIRequest,
  type AIResponse,
  type JobExtractionContext,
  type FieldAnsweringContext,
} from '../index.js';

describe('AI Provider Abstraction & Scoped Contexts', () => {
  it('sanitizes script and iframe tags from untrusted prompt input', () => {
    const maliciousInput = 'Senior Engineer <script>alert("hacked")</script> <iframe src="evil.com"></iframe> Required';
    const cleaned = sanitizePromptInput(maliciousInput);

    expect(cleaned).not.toContain('<script>');
    expect(cleaned).not.toContain('evil.com');
    expect(cleaned).toContain('Senior Engineer');
    expect(cleaned).toContain('Required');
  });

  it('wraps untrusted data inside explicit XML delimiters', () => {
    const input = 'We are looking for a Senior Go Engineer.';
    const wrapped = wrapUntrustedContent(input, 'untrusted_job_content');

    expect(wrapped).toContain('<untrusted_job_content>');
    expect(wrapped).toContain('We are looking for a Senior Go Engineer.');
    expect(wrapped).toContain('</untrusted_job_content>');
  });

  it('builds a hardened system prompt with anti-injection safety directives', () => {
    const basePrompt = 'Extract required skills as a JSON array.';
    const hardened = buildHardenedSystemPrompt(basePrompt);

    expect(hardened).toContain('Extract required skills as a JSON array.');
    expect(hardened).toContain('CRITICAL SAFETY DIRECTIVE:');
    expect(hardened).toContain('untrusted_*');
    expect(hardened).toContain('strictly valid JSON');
  });

  it('implements AIProvider contract cleanly', async () => {
    // Test that a compliant provider can be implemented and typed
    const mockProvider: AIProvider = {
      id: 'mock-provider',
      displayName: 'Mock Provider for Testing',
      capabilities: {
        supportsStreaming: false,
        supportsJsonSchema: true,
        maxContextTokens: 8192,
        isLocal: true,
      },
      async complete<T = unknown>(request: AIRequest): Promise<AIResponse<T>> {
        return {
          rawText: '{"skills":["TypeScript"]}',
          parsed: { skills: ['TypeScript'] } as T,
          finishReason: 'stop',
          usage: {
            promptTokens: 120,
            completionTokens: 15,
            totalTokens: 135,
          },
        };
      },
    };

    const extractionContext: JobExtractionContext = {
      rawHtmlOrText: '<div>Senior TypeScript Dev wanted</div>',
      pageUrl: 'https://jobs.example.com/123',
    };

    const request: AIRequest<JobExtractionContext> = {
      prompt: 'Extract skills',
      contextType: 'job_extraction',
      contextPayload: extractionContext,
    };

    const response = await mockProvider.complete<{ skills: string[] }>(request);
    expect(response.finishReason).toBe('stop');
    expect(response.parsed?.skills).toEqual(['TypeScript']);
    expect(response.usage?.totalTokens).toBe(135);
  });
});
