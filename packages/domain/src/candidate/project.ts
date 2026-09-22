import type { ProjectId, EvidenceId } from '../types/ids.js';

/**
 * Open-source, personal, or client project demonstrating technical competency.
 */
export interface CandidateProject {
  readonly id: ProjectId;
  readonly title: string;
  readonly description: string;
  readonly role?: string;
  /** Live URL or production deployment location. */
  readonly url?: string;
  /** Source code repository location (GitHub, GitLab, etc.). */
  readonly repoUrl?: string;
  /** Concrete technical accomplishments and architectural decisions. */
  readonly highlights: readonly string[];
  readonly technologiesUsed: readonly string[];
  readonly startDate?: string;
  readonly endDate?: string;
  /** Verifiable evidence references backing this project's assertions. */
  readonly evidenceRefs: readonly EvidenceId[];
}
