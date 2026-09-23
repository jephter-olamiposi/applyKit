/**
 * @fileoverview Structured AI Job Extraction schema, validator, and normalization.
 *
 * Maps a validated LLM job-extraction completion into a canonical JobPosting aggregate.
 * Feeds the deterministic-extraction fallback path (Phase 2 conformance).
 */

import type { JobPosting, SalaryRange, WorkplaceType, JobPostingEmploymentType } from '../job/job-posting.js';
import type { RequirementCategory, Importance } from '../job/requirement.js';
import { createJobPostingId, createRequirementId } from '../types/ids.js';

/**
 * A single qualification line returned by the LLM extraction model.
 */
export interface AiJobExtractionRequirement {
  readonly text: string;
  readonly category: RequirementCategory;
  readonly importance: 'required' | 'preferred';
  readonly minYears: number | null;
}

/**
 * Structured job metadata extracted from an untrusted job posting by the LLM.
 */
export interface AiJobExtractionResult {
  readonly title: string;
  readonly companyName: string;
  readonly location: string;
  readonly workplaceType: WorkplaceType;
  readonly employmentType: JobPostingEmploymentType;
  readonly salaryRange: {
    readonly min: number | null;
    readonly max: number | null;
    readonly currency: string;
    readonly period: 'yearly' | 'monthly' | 'hourly';
  } | null;
  readonly responsibilities: readonly string[];
  readonly requirements: readonly AiJobExtractionRequirement[];
}

const VALID_REQUIREMENT_CATEGORIES: readonly string[] = [
  'technical_skill',
  'soft_skill',
  'domain_knowledge',
  'education_credential',
  'certification',
  'experience_level',
  'legal_authorization',
  'language',
];

const VALID_WORKPLACE_TYPES: readonly string[] = ['remote', 'hybrid', 'onsite'];
const VALID_EMPLOYMENT_TYPES: readonly string[] = [
  'full_time',
  'part_time',
  'contract',
  'internship',
  'temporary',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isSalaryRange(value: unknown): value is AiJobExtractionResult['salaryRange'] {
  if (value === null) return true;
  if (!isRecord(value)) return false;
  const cur = value['currency'];
  const period = value['period'];
  return (
    (value['min'] === null || typeof value['min'] === 'number') &&
    (value['max'] === null || typeof value['max'] === 'number') &&
    typeof cur === 'string' &&
    (period === 'yearly' || period === 'monthly' || period === 'hourly')
  );
}

function isRequirementList(value: unknown): value is readonly AiJobExtractionRequirement[] {
  if (!Array.isArray(value)) return false;
  return value.every((item) => {
    if (!isRecord(item)) return false;
    const category = item['category'];
    const importance = item['importance'];
    return (
      typeof item['text'] === 'string' &&
      typeof category === 'string' &&
      VALID_REQUIREMENT_CATEGORIES.includes(category) &&
      (importance === 'required' || importance === 'preferred') &&
      (item['minYears'] === null || typeof item['minYears'] === 'number')
    );
  });
}

/**
 * Structural type guard for LLM job-extraction completions.
 *
 * Untrusted model output is never trusted implicitly; this guard is the
 * validation gate before any LLM-extracted content becomes a JobPosting.
 */
export function isAiJobExtractionResult(value: unknown): value is AiJobExtractionResult {
  if (!isRecord(value)) return false;
  const workplaceType = value['workplaceType'];
  const employmentType = value['employmentType'];
  return (
    typeof value['title'] === 'string' &&
    typeof value['companyName'] === 'string' &&
    typeof value['location'] === 'string' &&
    typeof workplaceType === 'string' &&
    VALID_WORKPLACE_TYPES.includes(workplaceType) &&
    typeof employmentType === 'string' &&
    VALID_EMPLOYMENT_TYPES.includes(employmentType) &&
    isSalaryRange(value['salaryRange']) &&
    isStringArray(value['responsibilities']) &&
    isRequirementList(value['requirements'])
  );
}

const REQUIREMENT_CATEGORY_FALLBACK: RequirementCategory = 'technical_skill';

/**
 * Converts a validated LLM extraction into a canonical JobPosting aggregate.
 *
 * @param parsed Validated structured LLM output.
 * @param url Source URL the job was discovered at.
 * @param rawSource Raw page text used as the description source.
 * @returns Fully-formed JobPosting with generated identifiers.
 */
export function jobPostingFromAiExtraction(
  parsed: AiJobExtractionResult,
  url: string,
  rawSource: string
): JobPosting {
  let salaryRange: SalaryRange | undefined;
  if (parsed.salaryRange && parsed.salaryRange.min && parsed.salaryRange.min > 0) {
    const { min, max, currency, period } = parsed.salaryRange;
    const annualOrHourly = period === 'monthly' ? null : period === 'hourly' ? 'hourly' : 'annual';
    if (annualOrHourly) {
      const resolvedMax = max && max > 0 ? max : min;
      salaryRange = {
        min,
        max: resolvedMax < min ? min : resolvedMax,
        currency: currency || 'USD',
        period: annualOrHourly,
      };
    }
  }

  const requirements = parsed.requirements.map((req) => ({
    id: createRequirementId(),
    rawText: req.text.trim(),
    normalizedSkillOrCompetency: req.text.trim(),
    category: VALID_REQUIREMENT_CATEGORIES.includes(req.category)
      ? (req.category as RequirementCategory)
      : REQUIREMENT_CATEGORY_FALLBACK,
    importance: req.importance === 'required' ? ('required' as Importance) : ('preferred' as Importance),
    ...(typeof req.minYears === 'number' && req.minYears > 0
      ? { yearsRequired: req.minYears }
      : {}),
    isRequired: req.importance === 'required',
    matchedEvidenceIds: [] as const,
  }));

  const requirementText = requirements.map((r) => r.rawText).join('\n');
  const responsibilitiesText = parsed.responsibilities.join('\n');
  const description = [requirementText, responsibilitiesText].filter(Boolean).join('\n\n');

  return {
    id: createJobPostingId(),
    url,
    title: parsed.title,
    companyName: parsed.companyName,
    location: parsed.location,
    workplaceType: parsed.workplaceType,
    employmentType: parsed.employmentType,
    ...(salaryRange ? { salaryRange } : {}),
    rawDescription: description || rawSource,
    parsedAt: new Date().toISOString(),
    requirements,
    metadata: {
      adapter: 'ai_extraction',
      schemaType: 'llm_job_extraction',
    },
  };
}