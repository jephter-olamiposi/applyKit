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
