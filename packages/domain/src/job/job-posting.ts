import type { JobPostingId } from '../types/ids.js';
import type { Requirement } from './requirement.js';

/**
 * Physical workplace presence expectation.
 */
export type WorkplaceType = 'remote' | 'hybrid' | 'onsite';

/**
 * Standard employment schedule and contract category for a job posting.
 */
export type JobPostingEmploymentType =
  | 'full_time'
  | 'part_time'
  | 'contract'
  | 'internship'
  | 'temporary';

/**
 * Base salary or hourly wage boundaries stated in the job posting.
 */
export interface SalaryRange {
  readonly min: number;
  readonly max: number;
  readonly currency: string;
  readonly period: 'hourly' | 'annual';
}

/**
 * Canonical structured job listing extracted from an employer career page or ATS portal.
 */
export interface JobPosting {
  readonly id: JobPostingId;
  /** Full URL where this job was discovered or applied for. */
  readonly url: string;
  readonly title: string;
  readonly companyName: string;
  readonly location: string;
  readonly workplaceType: WorkplaceType;
  readonly employmentType: JobPostingEmploymentType;
  readonly salaryRange?: SalaryRange;
  /** Complete raw text or sanitized Markdown description extracted from the webpage. */
  readonly rawDescription: string;
  /** ISO timestamp when the job data was parsed. */
  readonly parsedAt: string;
  /** Categorized and prioritized qualification requirements. */
  readonly requirements: readonly Requirement[];
  /** Vendor-specific ATS metadata (e.g. greenhouse_job_id, lever_posting_id). */
  readonly metadata: Readonly<Record<string, string>>;
}

/**
 * Placeholder company label assigned by fallback adapters when no organization could be identified.
 */
const UNKNOWN_COMPANY_HINTS: readonly string[] = ['unknown company', 'company'];

/**
 * Flags a deterministic JobPosting that yielded no usable signal (empty or fallback
 * identifiers with no requirements), used to trigger the LLM extraction fallback.
 */
export function isDegenerateJobPosting(job: JobPosting): boolean {
  const titleEmpty = job.title.trim().length === 0;
  const companyUnidentified = UNKNOWN_COMPANY_HINTS.includes(job.companyName.trim().toLowerCase());
  const noRequirements = job.requirements.length === 0;
  const descriptionEmpty = job.rawDescription.trim().length < 40;
  return titleEmpty || (companyUnidentified && noRequirements) || (noRequirements && descriptionEmpty);
}
