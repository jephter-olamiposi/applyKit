import type { EvidenceId } from '../types/ids.js';
import type { Evidence } from './evidence.js';
import type { CandidateClaim } from './candidate-claim.js';

/**
 * Directed relationship graph linking candidate assertions to atomic evidence snippets.
 */
export interface EvidenceGraph {
  readonly evidenceMap: ReadonlyMap<EvidenceId, Evidence>;
  readonly claims: readonly CandidateClaim[];
}

/**
 * Constructs an indexed EvidenceGraph from flat lists of evidence items and claims.
 */
export function buildEvidenceGraph(
  evidenceList: readonly Evidence[],
  claimsList: readonly CandidateClaim[]
): EvidenceGraph {
  const map = new Map<EvidenceId, Evidence>();
  for (const item of evidenceList) {
    map.set(item.id, item);
  }
  return {
    evidenceMap: map,
    claims: claimsList,
  };
}

/**
 * Traverses the graph to retrieve all concrete Evidence records backing a given CandidateClaim.
 */
export function getSupportingEvidenceForClaim(
  graph: EvidenceGraph,
  claim: CandidateClaim
): readonly Evidence[] {
  const results: Evidence[] = [];
  for (const evId of claim.supportedByEvidenceIds) {
    const ev = graph.evidenceMap.get(evId);
    if (ev) {
      results.push(ev);
    }
  }
  return results;
}

/**
 * Identifies any candidate claims that lack supporting evidence references.
 * Used to flag potential hallucinations before materials are presented to the candidate.
 */
export function findUnbackedClaims(
  claims: readonly CandidateClaim[]
): readonly CandidateClaim[] {
  return claims.filter((c) => c.supportedByEvidenceIds.length === 0);
}
