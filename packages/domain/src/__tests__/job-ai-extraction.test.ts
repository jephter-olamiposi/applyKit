/**
 * @fileoverview Tests for structured LLM job-extraction validation and normalization
 * and the degenerate-posting predicate driving the fallback path.
 */

import { describe, it, expect } from 'vitest';
import {
  isAiJobExtractionResult,
  jobPostingFromAiExtraction,
  type AiJobExtractionResult,
} from '../ai/job-extraction.js';
import { isDegenerateJobPosting, type JobPosting } from '../job/job-posting.js';
import { createJobPostingId, createRequirementId } from '../types/ids.js';

const VALID_RESULT: AiJobExtractionResult = {
  title: 'Senior Platform Engineer',
  companyName: 'Acme Cloud',
  location: 'New York, NY',
  workplaceType: 'hybrid',
  employmentType: 'full_time',
  salaryRange: { min: 150000, max: 190000, currency: 'USD', period: 'yearly' },
  responsibilities: ['Design scalable ingestion pipelines.'],
  requirements: [
    {
      text: '5+ years with distributed systems',
      category: 'experience_level',
      importance: 'required',
      minYears: 5,
    },
    {
      text: 'Go or Rust',
      category: 'technical_skill',
      importance: 'preferred',
      minYears: null,
    },
  ],
};

describe('isAiJobExtractionResult', () => {
  it('accepts a complete valid extraction payload', () => {
    expect(isAiJobExtractionResult(VALID_RESULT)).toBe(true);
  });

  it('rejects payloads with out-of-schema category or importance values', () => {
    const bad = {
      ...VALID_RESULT,
      requirements: [{ text: 'x', category: 'not_a_category', importance: 'required', minYears: null }],
    };
    expect(isAiJobExtractionResult(bad)).toBe(false);
  });

  it('rejects non-object values and missing required fields', () => {
    expect(isAiJobExtractionResult(null)).toBe(false);
    expect(isAiJobExtractionResult('text')).toBe(false);
    expect(isAiJobExtractionResult({ ...VALID_RESULT, title: 42 })).toBe(false);
  });

  it('rejects unsupported workplace or employment types', () => {
    expect(isAiJobExtractionResult({ ...VALID_RESULT, workplaceType: 'space' })).toBe(false);
    expect(isAiJobExtractionResult({ ...VALID_RESULT, employmentType: 'gig' })).toBe(false);
  });
});

describe('jobPostingFromAiExtraction', () => {
  it('normalizes validated LLM output into a canonical JobPosting', () => {
    const posting = jobPostingFromAiExtraction(VALID_RESULT, 'https://acme.example/role/1', 'raw text');

    expect(posting.id).toMatch(/^job_/);
    expect(posting.url).toBe('https://acme.example/role/1');
    expect(posting.title).toBe('Senior Platform Engineer');
    expect(posting.companyName).toBe('Acme Cloud');
    expect(posting.workplaceType).toBe('hybrid');
    expect(posting.employmentType).toBe('full_time');
    expect(posting.salaryRange).toEqual({ min: 150000, max: 190000, currency: 'USD', period: 'annual' });
    expect(posting.metadata.adapter).toBe('ai_extraction');

    const [required, preferred] = posting.requirements;
    expect(required?.rawText).toBe('5+ years with distributed systems');
    expect(required?.category).toBe('experience_level');
    expect(required?.importance).toBe('required');
    expect(required?.isRequired).toBe(true);
    expect(required?.yearsRequired).toBe(5);
    expect(required?.id).toMatch(/^req_/);
    expect(preferred?.importance).toBe('preferred');
    expect(preferred?.isRequired).toBe(false);
  });

  it('derives rawDescription from requirements and responsibilities', () => {
    const posting = jobPostingFromAiExtraction(VALID_RESULT, 'https://acme.example/role/1', 'raw text');
    expect(posting.rawDescription).toContain('5+ years with distributed systems');
    expect(posting.rawDescription).toContain('Design scalable ingestion pipelines.');
  });

  it('omits salary normalized only to hourly or annual periods', () => {
    const monthly = jobPostingFromAiExtraction(
      { ...VALID_RESULT, salaryRange: { min: 8000, max: 9000, currency: 'USD', period: 'monthly' } },
      'https://x.example/role',
      'raw'
    );
    expect(monthly.salaryRange).toBeUndefined();
  });
});

describe('isDegenerateJobPosting', () => {
  function sampleJob(overrides: Partial<JobPosting>): JobPosting {
    return {
      id: createJobPostingId('job_test'),
      url: 'https://example.com/job',
      title: 'Engineer',
      companyName: 'Example Corp',
      location: '',
      workplaceType: 'onsite',
      employmentType: 'full_time',
      rawDescription: 'A portion of text describing the role responsibilities in detail.',
      parsedAt: new Date().toISOString(),
      requirements: [],
      metadata: {},
      ...overrides,
    };
  }

  it('flags empty titles as degenerate', () => {
    expect(isDegenerateJobPosting(sampleJob({ title: '' }))).toBe(true);
  });

  it('flags unidentified company with no requirements as degenerate', () => {
    expect(isDegenerateJobPosting(sampleJob({ companyName: 'Company' }))).toBe(true);
    expect(isDegenerateJobPosting(sampleJob({ companyName: 'Unknown Company' }))).toBe(true);
  });

  it('flags missing requirements plus near-empty description as degenerate', () => {
    const job = sampleJob({
      companyName: 'Example Corp',
      rawDescription: 'short',
    });
    expect(isDegenerateJobPosting(job)).toBe(true);
  });

  it('recognizes a substantive posting as usable', () => {
    const job = sampleJob({
      requirements: [
        {
          id: createRequirementId('req_x'),
          rawText: 'Experience with Go',
          normalizedSkillOrCompetency: 'Go',
          category: 'technical_skill',
          importance: 'required',
          isRequired: true,
          matchedEvidenceIds: [],
        },
      ],
    });
    expect(isDegenerateJobPosting(job)).toBe(false);
  });
});