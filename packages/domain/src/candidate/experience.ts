import type { ExperienceId, EvidenceId } from '../types/ids.js';

/**
 * Standard employment contractual relationship categories.
 */
export type EmploymentType =
  | 'full_time'
  | 'part_time'
  | 'contract'
  | 'internship'
  | 'freelance'
  | 'self_employed';

/**
 * Historical professional employment record linked to concrete evidence bullets.
 */
export interface WorkExperience {
  readonly id: ExperienceId;
  readonly company: string;
  readonly title: string;
  readonly employmentType: EmploymentType;
  readonly location: string;
  readonly isRemote: boolean;
  /** ISO date string in YYYY-MM or YYYY-MM-DD format. */
  readonly startDate: string;
  /** ISO date string in YYYY-MM or YYYY-MM-DD format; undefined if currently active. */
  readonly endDate?: string;
  readonly isCurrent: boolean;
  readonly description: string;
  /** Individual verifiable accomplishment bullets. */
  readonly highlights: readonly string[];
  /** Technology stack and methodologies utilized in this position. */
  readonly technologiesUsed: readonly string[];
  /** Verifiable evidence references backing the claims in this experience entry. */
  readonly evidenceRefs: readonly EvidenceId[];
}
