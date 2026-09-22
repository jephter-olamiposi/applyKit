import type { EvidenceId } from '../types/ids.js';
import type { EvidenceSource } from './evidence-source.js';

/**
 * Trust level status for an individual evidence snippet.
 */
export type VerificationStatus = 'unverified' | 'verified' | 'inferred';

/**
 * Atomic unit of verified candidate experience, document snippet, or project achievement.
 * Forms the foundational layer of the EvidenceGraph.
 */
export interface Evidence {
  readonly id: EvidenceId;
  readonly source: EvidenceSource;
  /** Human-readable explanation of what capability or fact this evidence establishes. */
  readonly description: string;
  /** Exact unembellished text snippet extracted from the source document or artifact. */
  readonly textSnippet: string;
  readonly verificationStatus: VerificationStatus;
  /** Confidence score between 0.0 (weak conjecture) and 1.0 (authoritative proof). */
  readonly confidenceScore: number;
  readonly createdAt: string;
  readonly tags: readonly string[];
}
