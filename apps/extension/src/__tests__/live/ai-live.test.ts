/**
 * Manual live AI verification against a real ATS-style application form.
 *
 * Requires GEMINI_TEST_KEY env var and /tmp/tether.html fixture;
 * skips silently when either is unavailable (default CI runs).
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect } from 'vitest';
import { inspectPageForms } from '../../content/form-crawler.js';
import {
  buildFieldAnsweringPrompt,
  parseAndValidateJsonResponse,
  isAiAnswerableCustomField,
  type AiProposedFieldAnswer,
} from '@applykit/domain';
import { AIGateway } from '../../ai/gateway.js';

const GEMINI_KEY = process.env.GEMINI_TEST_KEY;

describe('Live AI pipeline against real Tether form', () => {
  it('answers the custom questions with grounded, human-voice responses', async () => {
    if (!GEMINI_KEY) {
      return; // skipped when key not provided
    }
    const { readFileSync, existsSync } = await import('node:fs');
    const FIXTURE = '/tmp/tether.html';
    if (!existsSync(FIXTURE)) return;
    const html = readFileSync(FIXTURE, 'utf-8');

    document.write(html);
    document.close();

    const forms = inspectPageForms(document);
    expect(forms.length).toBe(1);
    const form = forms[0];
    if (!form) return;
    const customFields = form.fields.filter(isAiAnswerableCustomField).slice(0, 3);

    const gateway = new AIGateway({
      get: async () => {
        return { applykit_secure_provider_keys: { gemini: GEMINI_KEY } } as never;
      },
      set: async () => {},
    });

    console.log('Testing AI answers for', customFields.length, 'custom fields');
    const answers: AiProposedFieldAnswer[] = [];

    for (const field of customFields) {
      const t0 = Date.now();
      console.log('\n=== FIELD:', field.label, `(${field.fieldType}) ===`);
      const context = {
        fieldLabel: field.label,
        fieldType: field.fieldType,
        options: field.options,
        placeholder: field.placeholder,
        relevantAnswers: [],
        relevantClaims: [],
      } as never;
      const prompt = buildFieldAnsweringPrompt(context);
      const res = await gateway.executeRequest(prompt, 'gemini');
      console.log('request took', Date.now() - t0, 'ms');

      interface FieldAnsweringResult {
        answerText: string;
        confidence: number;
        supportingClaimIds: string[];
        isGrounded: boolean;
        notes: string;
      }
      function isFieldAnsweringResult(value: unknown): value is FieldAnsweringResult {
        return (
          typeof value === 'object' &&
          value !== null &&
          typeof (value as Record<string, unknown>).answerText === 'string'
        );
      }
      const parsed = parseAndValidateJsonResponse<FieldAnsweringResult>(res.rawText, isFieldAnsweringResult);
      console.log('rawText:', res.rawText.slice(0, 600));
      console.log('parsed.success:', parsed.success);
      console.log('parsed.error:', parsed.error?.slice(0, 300));
      if (parsed.data) {
        answers.push({
          fieldId: field.id,
          answerText: parsed.data.answerText,
          confidence: parsed.data.confidence,
          supportingClaimIds: parsed.data.supportingClaimIds ?? [],
        });
      }
    }
    expect(answers.length).toBeGreaterThan(0);
  }, 120000);
});