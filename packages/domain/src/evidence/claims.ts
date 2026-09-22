/**
 * @fileoverview Candidate claim derivation and graph linking engine.
 *
 * Enforces the core zero-hallucination invariant (ADR-0004): High-level qualification
 * claims must be strictly derived from and substantiated by atomic Evidence nodes.
 * Claims lacking backing evidence are flagged or assigned zero confidence.
 */

import type { ClaimId, EvidenceId } from '../types/ids.js';
import { createClaimId } from '../types/ids.js';
import type { Evidence } from './evidence.js';
import type { CandidateClaim, ClaimType } from './candidate-claim.js';

/** Regular expression identifying quantified metric achievements (percentages, dollar amounts, throughput). */
const QUANTIFIED_METRIC_REGEX = /(?:\d+%\s*|\$\d+[\d,.]*(?:k|m|b)?|\b\d+x\b|\b\d+\+?\s*(?:users|clients|qps|ms|requests|engineers|microservices|queries|deployments|customers)\b)/i;

/** Impact action verbs indicating significant engineering or business achievements. */
const IMPACT_VERB_REGEX = /^(?:reduced|increased|scaled|optimized|architected|spearheaded|delivered|automated|migrated|refactored|designed|built|developed|launched)\b/i;

/** Leadership keywords in titles or highlights. */
const LEADERSHIP_KEYWORD_REGEX = /\b(led|mentored|managed|spearheaded|coached|directed|guided\s+team)\b/i;

/**
 * Calculates a deterministic confidence score for a claim given its supporting evidence nodes.
 *
 * Scoring model:
 * - 0 supporting evidence: 0.0 (unbacked assertion / potential hallucination).
 * - 1 supporting evidence: base 0.75.
 * - Multi-source corroborate (distinct employers/projects): +0.15 boost up to 0.95.
 * - Quantified metrics present in evidence: +0.05 boost.
 * - Inferred/unverified evidence reduces confidence by 0.15.
 */
export function calculateClaimConfidence(
  evidenceList: readonly Evidence[]
): number {
  if (evidenceList.length === 0) {
    return 0.0;
  }

  let score = 0.75;

  // Multi-source corroboration check
  const sourceIds = new Set(evidenceList.map((e) => e.source.sourceId));
  if (sourceIds.size > 1) {
    score += 0.15;
  }

  // Bonus for quantified metrics
  const hasMetrics = evidenceList.some((e) => QUANTIFIED_METRIC_REGEX.test(e.textSnippet));
  if (hasMetrics) {
    score += 0.05;
  }

  // Penalty if any supporting evidence is not verified
  const hasUnverified = evidenceList.some((e) => e.verificationStatus !== 'verified');
  if (hasUnverified) {
    score -= 0.15;
  }

  return Math.min(Math.max(score, 0.1), 1.0);
}

/**
 * Derives verified CandidateClaim assertions from a collection of atomic Evidence nodes.
 *
 * Produces:
 * 1. Skill proficiency claims backed by all evidence mentioning that technology.
 * 2. High-impact achievement claims for quantified bullets.
 * 3. Formal credential claims backed by diploma/certification nodes.
 * 4. Leadership capability claims for management or mentoring accomplishments.
 *
 * @param evidenceList Collection of atomic evidence items from decomposed profile/resume.
 * @returns Array of substantiated CandidateClaim records with explicit evidence links.
 */
export function deriveClaimsFromEvidence(evidenceList: readonly Evidence[]): CandidateClaim[] {
  const claims: CandidateClaim[] = [];
  const now = new Date().toISOString();

  // 1. Group evidence by technology tags for Skill Proficiency claims
  const skillEvidenceMap = new Map<string, EvidenceId[]>();

  for (const ev of evidenceList) {
    for (const tag of ev.tags) {
      if (tag === 'education' || tag.length < 2) continue;
      const existing = skillEvidenceMap.get(tag) || [];
      existing.push(ev.id);
      skillEvidenceMap.set(tag, existing);
    }
  }

  for (const [skill, evIds] of skillEvidenceMap.entries()) {
    // Only generate skill claims for technical keywords with at least 1 evidence item
    const matchingEvidence = evidenceList.filter((e) => evIds.includes(e.id));
    const confidence = calculateClaimConfidence(matchingEvidence);
    const sourceCount = new Set(matchingEvidence.map((e) => e.source.sourceId)).size;

    const statement = sourceCount > 1
      ? `Proven production proficiency in ${skill}, demonstrated across ${sourceCount} separate roles/projects.`
      : `Demonstrated technical competency in ${skill} through practical project/work experience.`;

    claims.push({
      id: createClaimId(),
      statement,
      claimType: 'skill_proficiency',
      supportedByEvidenceIds: evIds,
      confidence,
      tags: [skill],
      createdAt: now,
    });
  }

  // 2. Derive Achievement and Leadership claims from individual bullet evidence
  for (const ev of evidenceList) {
    // Credential claims from diplomas
    if (ev.source.type === 'diploma' || ev.source.type === 'third_party_credential') {
      claims.push({
        id: createClaimId(),
        statement: `Holds verified credential: ${ev.description}`,
        claimType: 'credential',
        supportedByEvidenceIds: [ev.id],
        confidence: ev.confidenceScore,
        tags: [...ev.tags],
        createdAt: now,
      });
      continue;
    }

    // High-impact achievement claims from quantified metrics or strong action verbs
    const isQuantified = QUANTIFIED_METRIC_REGEX.test(ev.textSnippet);
    const isImpactAction = IMPACT_VERB_REGEX.test(ev.textSnippet);

    if (isQuantified || isImpactAction) {
      const company = ev.source.metadata?.company || ev.source.metadata?.title || 'Production';
      claims.push({
        id: createClaimId(),
        statement: `Demonstrated accomplishment at ${company}: ${ev.textSnippet}`,
        claimType: 'achievement',
        supportedByEvidenceIds: [ev.id],
        confidence: calculateClaimConfidence([ev]),
        tags: [...ev.tags],
        createdAt: now,
      });
    }

    // Leadership claims
    if (LEADERSHIP_KEYWORD_REGEX.test(ev.textSnippet) || (ev.source.metadata?.title && /\b(lead|manager|director|head|principal|staff)\b/i.test(ev.source.metadata.title))) {
      claims.push({
        id: createClaimId(),
        statement: `Leadership & mentoring contribution: ${ev.textSnippet}`,
        claimType: 'leadership',
        supportedByEvidenceIds: [ev.id],
        confidence: calculateClaimConfidence([ev]),
        tags: ['leadership', ...ev.tags],
        createdAt: now,
      });
    }
  }

  return claims;
}

/**
 * Validates and updates a claim against a set of evidence nodes, recalculating confidence
 * and detecting dangling or missing references.
 *
 * @param claim The claim to evaluate.
 * @param evidenceMap Lookup map of known evidence nodes.
 * @returns Updated claim with recalculated confidence and valid evidence links.
 */
export function refreshClaimEvidenceLinks(
  claim: CandidateClaim,
  evidenceMap: ReadonlyMap<EvidenceId, Evidence>
): CandidateClaim {
  const validEvIds: EvidenceId[] = [];
  const validEvidence: Evidence[] = [];

  for (const id of claim.supportedByEvidenceIds) {
    const ev = evidenceMap.get(id);
    if (ev) {
      validEvIds.push(id);
      validEvidence.push(ev);
    }
  }

  const confidence = calculateClaimConfidence(validEvidence);

  return {
    ...claim,
    supportedByEvidenceIds: validEvIds,
    confidence,
  };
}
