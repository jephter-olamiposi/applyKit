import type { SkillId, EvidenceId } from '../types/ids.js';

/**
 * Technical, organizational, and domain skill taxonomies.
 */
export type SkillCategory =
  | 'language'
  | 'framework'
  | 'library'
  | 'database'
  | 'cloud_infrastructure'
  | 'devops_tool'
  | 'architecture_pattern'
  | 'testing_qa'
  | 'methodology'
  | 'soft_skill'
  | 'domain_expertise';

/**
 * Assessed level of skill mastery.
 */
export type SkillProficiency =
  | 'beginner'
  | 'intermediate'
  | 'advanced'
  | 'expert';

/**
 * A discrete technical capability or qualification held by the candidate.
 */
export interface CandidateSkill {
  readonly id: SkillId;
  readonly name: string;
  /** Normalized lowercase alphanumeric key for semantic matching (e.g. 'typescript', 'react', 'postgresql'). */
  readonly normalizedName: string;
  readonly category: SkillCategory;
  readonly proficiency: SkillProficiency;
  readonly yearsOfExperience?: number;
  readonly lastUsedYear?: number;
  /** References to supporting evidence proving practical usage of this skill. */
  readonly evidenceRefs: readonly EvidenceId[];
}

/**
 * Normalizes a raw skill string for canonical indexing and deterministic matching.
 * Strips punctuation (dots, hyphens, underscores) and whitespace, converting to lowercase.
 *
 * Example: "Node.js" -> "nodejs", "React-Native" -> "reactnative".
 */
export function normalizeSkillName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/[.\-_]/g, '')
    .replace(/\s+/g, '');
}
