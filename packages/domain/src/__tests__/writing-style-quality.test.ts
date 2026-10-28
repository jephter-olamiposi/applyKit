/**
 * @fileoverview Unit tests for Human-Sounding Answer Sanitization and Writing Quality.
 *
 * Verifies that ApplyKit's deterministic humanizer eliminates robotic LLM clichés,
 * conversational throat-clearing, corporate jargon, and AI formatting artifacts.
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeHumanText,
  applyWritingQualityPassSync,
  DEFAULT_WRITING_STYLE,
  withAiProposedFieldAnswers,
  generateDryRunPlan,
  createEmptyProfile,
} from '../index.js';
import type { ApplicationForm } from '../index.js';
import { createFieldId, createProfileId } from '../types/ids.js';

describe('sanitizeHumanText & Anti-AI Post-Processing Guardrails', () => {
  it('strips conversational preambles and throat-clearing openings', () => {
    const inputs = [
      'Certainly! I have managed Kafka clusters in production for three years.',
      'Sure! I have worked with Kubernetes on AWS EKS.',
      'Sure thing! We scaled our Redis cluster to handle 50k ops/sec.',
      'Of course! I have designed event-driven microservices.',
      "Here is my experience: I've built low-latency financial systems.",
      "Here's an overview: I've worked extensively with PostgreSQL.",
      'I\'d be happy to explain: We tuned our JVM memory pool.',
    ];

    for (const input of inputs) {
      const cleaned = sanitizeHumanText(input);
      expect(cleaned).not.toMatch(/^(Certainly!|Sure!|Sure thing!|Of course!|Here is|Here's an|I'd be happy to)/i);
      expect(cleaned.length).toBeGreaterThan(15);
      // First character should be capitalized
      expect(cleaned.charAt(0)).toBe(cleaned.charAt(0).toUpperCase());
    }
  });

  it('strips introductory self-aggrandizing clauses', () => {
    const input = 'As an experienced senior software engineer, I designed the fault-tolerant ingestion pipeline.';
    const cleaned = sanitizeHumanText(input);
    expect(cleaned).not.toMatch(/As an experienced senior software engineer/i);
    expect(cleaned).toBe('I designed the fault-tolerant ingestion pipeline.');
  });

  it('strips modern LLM tropes and buzzwords (delve, testament, seamless integration, tapestry)', () => {
    const input = 'I delve into database internals as a testament to our relentless dedication to seamless integration.';
    const cleaned = sanitizeHumanText(input);
    expect(cleaned.toLowerCase()).not.toContain('delve');
    expect(cleaned.toLowerCase()).not.toContain('testament');
    expect(cleaned.toLowerCase()).not.toContain('seamless integration');
  });

  it('strips robotic conclusions and sycophantic email sign-offs in form fields', () => {
    const input =
      'I optimized our message queues to absorb spikes. In conclusion, I look forward to discussing this opportunity.';
    const cleaned = sanitizeHumanText(input);
    expect(cleaned.toLowerCase()).not.toContain('in conclusion');
    expect(cleaned.toLowerCase()).not.toContain('i look forward to discussing');
    expect(cleaned).toContain('I optimized our message queues to absorb spikes.');
  });

  it('cleans up markdown bullet points, headings, and stylistic em-dashes', () => {
    const input = '### Architecture\n- Built high-throughput gRPC services—reducing p99 latency to 12ms.';
    const cleaned = sanitizeHumanText(input);
    expect(cleaned).not.toContain('###');
    expect(cleaned).not.toContain('- Built');
    expect(cleaned).not.toContain('—');
    expect(cleaned).toContain('Built high-throughput gRPC services');
  });

  it('collapses multiple whitespace and fixes orphan punctuation cleanly', () => {
    const input = 'Certainly! ,  I built the data layer .';
    const cleaned = sanitizeHumanText(input);
    expect(cleaned).toBe('I built the data layer.');
  });
});

describe('applyWritingQualityPassSync', () => {
  it('validates authentic human engineering text successfully', () => {
    const text =
      "I've worked with Go and Kubernetes in production for the past three years. We ran into partition rebalance lag under traffic spikes, so I tuned consumer batch fetch limits and backoff intervals.";
    const result = applyWritingQualityPassSync(text, DEFAULT_WRITING_STYLE);

    expect(result.passedQualityCheck).toBe(true);
    expect(result.violations.length).toBe(0);
    expect(result.cleanedText).toContain('Kubernetes in production');
  });

  it('flags forbidden corporate cliché patterns if uncleaned text contains them', () => {
    const text = 'I am passionate about leveraging cutting edge technologies to drive results.';
    const result = applyWritingQualityPassSync(text, DEFAULT_WRITING_STYLE);

    // Sanitization should strip the patterns
    expect(result.cleanedText).not.toContain('passionate about leveraging');
    expect(result.cleanedText).not.toContain('cutting edge technologies');
  });
});

describe('withAiProposedFieldAnswers integration with sanitizeHumanText', () => {
  it('automatically sanitizes AI-proposed text and textarea answers before staging in dry-run plan', () => {
    const minimalProfile = createEmptyProfile(createProfileId('p1'));

    const textareaFieldId = createFieldId('custom-q1');
    const form: ApplicationForm = {
      id: 'form-1',
      url: 'https://careers.example.com/apply',
      detectedAts: 'generic',
      isMultiStep: false,
      inspectedAt: '2026-01-01T00:00:00Z',
      fields: [
        {
          id: textareaFieldId,
          selector: 'textarea[name="experience_kafka"]',
          fieldType: 'textarea',
          label: 'What is your experience with Apache Kafka?',
          isRequired: true,
          confidenceScore: 0.9,
        },
      ],
    };

    const initialPlan = generateDryRunPlan(form, minimalProfile);

    const rawAiAnswer =
      'Certainly! I have used Apache Kafka for three years in production—managing high-throughput topics and dead-letter queues.';

    const updatedPlan = withAiProposedFieldAnswers(initialPlan, form, [
      {
        fieldId: textareaFieldId,
        answerText: rawAiAnswer,
        confidence: 0.95,
        supportingClaimIds: [],
      },
    ]);

    const stagedAction = updatedPlan.actions.find((a) => a.fieldId === textareaFieldId);
    expect(stagedAction).toBeDefined();
    // Staged value should have preamble "Certainly!" stripped and em-dash normalized
    expect(stagedAction?.action.value).not.toMatch(/^Certainly!/i);
    expect(stagedAction?.action.value).not.toContain('—');
    expect(stagedAction?.action.value).toContain('I have used Apache Kafka for three years in production');
  });
});
