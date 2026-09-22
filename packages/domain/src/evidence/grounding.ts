/**
 * @fileoverview Evidence graph grounding auditor.
 *
 * Implements strict zero-hallucination verification (ADR-0004). Audits the relationship
 * between CandidateClaims and backing Evidence nodes, detecting unbacked assertions,
 * broken graph references, and low-confidence claims before any application material is generated.
 */

import type { ClaimId, EvidenceId } from '../types/ids.js';
import type { CandidateClaim } from './candidate-claim.js';
import { isClaimSubstantiated } from './candidate-claim.js';
import type { EvidenceGraph } from './evidence-graph.js';

/**
 * Broken reference finding where a claim points to an evidence ID missing from the graph.
 */
export interface BrokenReferenceFinding {
  readonly claimId: ClaimId;
  readonly missingEvidenceId: EvidenceId;
}

/**
 * Comprehensive verification audit report analyzing graph substantiation integrity.
 */
export interface GroundingAuditReport {
  readonly totalClaims: number;
  readonly totalEvidenceNodes: number;
  readonly substantiatedClaimsCount: number;
  /** Claims with zero supporting evidence (potential hallucinations). */
  readonly unbackedClaims: readonly CandidateClaim[];
  /** Claims with supporting evidence but confidence below the 0.7 threshold. */
  readonly lowConfidenceClaims: readonly CandidateClaim[];
  /** References to evidence IDs that do not exist in the graph. */
  readonly brokenReferences: readonly BrokenReferenceFinding[];
  /** Evidence nodes not currently cited by any claim. */
  readonly orphanEvidenceCount: number;
  /** Ratio of substantiated claims to total claims (0.0 to 1.0). */
  readonly groundingScore: number;
  /** Whether the graph has zero unbacked claims, zero broken references, and groundingScore >= 0.8. */
  readonly isPristine: boolean;
  /** Human-readable warning messages for candidate review. */
  readonly warnings: readonly string[];
}

/**
 * Audits an EvidenceGraph to verify that all claims are legitimately substantiated by concrete evidence.
 *
 * Invariant: Rejects any unbacked claims. If any claim references non-existent evidence IDs or has
 * zero supporting evidence, the graph is marked as not pristine and warnings are produced.
 *
 * @param graph The indexed EvidenceGraph containing evidence nodes and candidate claims.
 * @returns Detailed audit report covering substantiation, orphans, broken links, and overall score.
 */
export function auditEvidenceGraphGrounding(graph: EvidenceGraph): GroundingAuditReport {
  const totalClaims = graph.claims.length;
  const totalEvidenceNodes = graph.evidenceMap.size;

  const unbackedClaims: CandidateClaim[] = [];
  const lowConfidenceClaims: CandidateClaim[] = [];
  const brokenReferences: BrokenReferenceFinding[] = [];
  const warnings: string[] = [];
  const referencedEvidenceIds = new Set<EvidenceId>();

  let substantiatedCount = 0;

  for (const claim of graph.claims) {
    if (claim.supportedByEvidenceIds.length === 0) {
      unbackedClaims.push(claim);
      warnings.push(`Claim "${claim.statement.slice(0, 60)}..." has zero supporting evidence.`);
      continue;
    }

    let hasBrokenRef = false;
    for (const evId of claim.supportedByEvidenceIds) {
      if (!graph.evidenceMap.has(evId)) {
        brokenReferences.push({ claimId: claim.id, missingEvidenceId: evId });
        hasBrokenRef = true;
      } else {
        referencedEvidenceIds.add(evId);
      }
    }

    if (hasBrokenRef) {
      warnings.push(`Claim "${claim.statement.slice(0, 60)}..." references non-existent evidence.`);
    }

    if (isClaimSubstantiated(claim)) {
      substantiatedCount++;
    } else {
      lowConfidenceClaims.push(claim);
      warnings.push(
        `Claim "${claim.statement.slice(0, 60)}..." has low confidence (${claim.confidence.toFixed(2)}).`
      );
    }
  }

  // Count orphan evidence nodes
  let orphanEvidenceCount = 0;
  for (const evId of graph.evidenceMap.keys()) {
    if (!referencedEvidenceIds.has(evId)) {
      orphanEvidenceCount++;
    }
  }

  const groundingScore = totalClaims > 0 ? substantiatedCount / totalClaims : 1.0;
  const isPristine =
    totalClaims > 0 &&
    unbackedClaims.length === 0 &&
    brokenReferences.length === 0 &&
    groundingScore >= 0.8;

  return {
    totalClaims,
    totalEvidenceNodes,
    substantiatedClaimsCount: substantiatedCount,
    unbackedClaims,
    lowConfidenceClaims,
    brokenReferences,
    orphanEvidenceCount,
    groundingScore,
    isPristine,
    warnings,
  };
}
