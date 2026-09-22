import type { ClaimId, EvidenceId } from '../types/ids.js';

/**
 * Functional categories of assertions made regarding a candidate's background.
 */
export type ClaimType =
  | 'skill_proficiency'
  | 'years_experience'
  | 'achievement'
  | 'leadership'
  | 'credential'
  | 'domain_knowledge';

/**
 * High-level assertion of qualification or capability backed by one or more Evidence nodes.
 *
 * Invariant: A claim cannot be treated as valid or used to satisfy job requirements unless it is
 * substantiated by verified evidence references.
 */
export interface CandidateClaim {
  readonly id: ClaimId;
  /** Explicit statement of capability, e.g. "Over 5 years of TypeScript production experience". */
  readonly statement: string;
  readonly claimType: ClaimType;
  /** Evidence node IDs that directly substantiate this claim. */
  readonly supportedByEvidenceIds: readonly EvidenceId[];
  /** Optional evidence node IDs that contradict or place bounds on this claim. */
  readonly contestedByEvidenceIds?: readonly EvidenceId[];
  /** Confidence score from 0.0 to 1.0. */
  readonly confidence: number;
  readonly tags: readonly string[];
  readonly createdAt: string;
}

/**
 * Evaluates whether a claim is sufficiently substantiated by underlying evidence.
 * Requires at least one supporting evidence reference and a confidence score >= 0.7.
 */
export function isClaimSubstantiated(claim: CandidateClaim): boolean {
  return claim.supportedByEvidenceIds.length > 0 && claim.confidence >= 0.7;
}
