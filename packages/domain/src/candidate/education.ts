import type { EducationId, EvidenceId } from '../types/ids.js';

/**
 * Formal academic degree, diploma, bootcamp, or vocational education record.
 */
export interface EducationRecord {
  readonly id: EducationId;
  readonly institution: string;
  readonly degree: string;
  readonly fieldOfStudy: string;
  /** ISO date string in YYYY-MM or YYYY-MM-DD format. */
  readonly startDate?: string;
  /** ISO date string in YYYY-MM or YYYY-MM-DD format. */
  readonly endDate?: string;
  readonly isCompleted: boolean;
  readonly gpa?: string;
  readonly honors: readonly string[];
  readonly relevantCoursework: readonly string[];
  readonly activities: readonly string[];
  /** References to diploma or transcript evidence verifying this record. */
  readonly evidenceRefs: readonly EvidenceId[];
}
