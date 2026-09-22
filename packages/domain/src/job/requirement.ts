import type { RequirementId, EvidenceId } from '../types/ids.js';

/**
 * Functional taxonomy of job requirements.
 */
export type RequirementCategory =
  | 'technical_skill'
  | 'soft_skill'
  | 'domain_knowledge'
  | 'education_credential'
  | 'certification'
  | 'experience_level'
  | 'legal_authorization'
  | 'language';

/**
 * Importance tier assigned to an individual requirement.
 */
export type Importance =
  | 'required'
  | 'strongly_preferred'
  | 'preferred'
  | 'nice_to_have';

/**
 * Normalized qualification, skill, or credential extracted from a job posting.
 */
export interface Requirement {
  readonly id: RequirementId;
  /** Exact snippet extracted verbatim from the job description. */
  readonly rawText: string;
  /** Normalized canonical competency for semantic lookup (e.g. 'TypeScript', 'Kubernetes'). */
  readonly normalizedSkillOrCompetency: string;
  readonly category: RequirementCategory;
  readonly importance: Importance;
  /** Minimum years of experience explicitly demanded by this requirement, if specified. */
  readonly yearsRequired?: number;
  /** Convenient helper: true if importance is 'required' or 'strongly_preferred'. */
  readonly isRequired: boolean;
  /** IDs of candidate evidence nodes matching this requirement. */
  readonly matchedEvidenceIds: readonly EvidenceId[];
}

/**
 * Checks whether a requirement is strictly non-negotiable ('required').
 */
export function isStrictlyRequired(req: Requirement): boolean {
  return req.importance === 'required';
}
