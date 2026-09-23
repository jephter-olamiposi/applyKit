/**
 * @fileoverview Deterministic Requirement Matching Engine.
 *
 * Evaluates candidate alignment against job requirements across multiple verification tiers:
 * exact skill matches, synonymous technical competencies, evidence-backed claims, and
 * experience seniority calculations. Enforces zero-hallucination grounding by weighting
 * substantiated evidence over unbacked profile assertions.
 */

import type { RequirementId, EvidenceId, ClaimId } from '../types/ids.js';
import type { Requirement } from './requirement.js';
import type { CandidateProfile } from '../candidate/profile.js';
import type { EvidenceGraph } from '../evidence/evidence-graph.js';
import { normalizeSkillName } from '../candidate/skill.js';
import { areCompetenciesEquivalent, normalizeCompetencyToken } from './synonyms.js';

/**
 * Verification tier representing the grounding depth of a requirement match.
 */
export type MatchTier =
  | 'exact_evidence'
  | 'exact_skill'
  | 'synonym_evidence'
  | 'synonym_skill'
  | 'claim_match'
  | 'unmatched';

/**
 * Individual requirement evaluation outcome.
 */
export interface RequirementMatch {
  readonly requirementId: RequirementId;
  readonly isMatched: boolean;
  /**
   * Grounded confidence score:
   * 1.0 = Direct skill match with verified evidence snippet
   * 0.85 = Synonymous competency with verified evidence snippet
   * 0.75 = Supported by candidate claim
   * 0.65 = Skill claimed in profile without linked document evidence
   * 0.0 = Unmatched
   */
  readonly confidenceScore: number;
  readonly matchedEvidenceIds: readonly EvidenceId[];
  readonly matchedClaimIds: readonly ClaimId[];
  readonly matchedCompetency?: string;
  readonly matchTier: MatchTier;
  readonly candidateYears?: number;
  readonly yearsShortfall?: number;
  readonly rationale: string;
}

/**
 * Comprehensive match matrix summarizing candidate alignment against a job posting.
 */
export interface JobMatchMatrix {
  readonly totalRequirements: number;
  readonly requiredCount: number;
  readonly requiredMetCount: number;
  readonly preferredCount: number;
  readonly preferredMetCount: number;
  /** Composite score normalized to 0 - 100. */
  readonly overallMatchScore: number;
  readonly matches: readonly RequirementMatch[];
  readonly missingRequiredRequirements: readonly Requirement[];
  readonly hardGapsCount: number;
  readonly softGapsCount: number;
  readonly experienceShortfallsCount: number;
}

/**
 * Evaluates candidate alignment against job requirements using multi-tier deterministic matching.
 *
 * Scoring Rationale:
 * - Mandatory requirements ('required', 'strongly_preferred') carry 75% weight in the composite score.
 * - Nice-to-have or preferred qualifications carry 25% weight.
 * - Verified evidence nodes yield maximum confidence; unbacked claims or years shortfalls incur deductions.
 *
 * @param requirements Extracted job requirements to test.
 * @param profile Candidate profile aggregate containing skills and experiences.
 * @param graph Optional EvidenceGraph for claim and document snippet verification.
 * @returns Comprehensive job match matrix.
 */
export function evaluateJobRequirements(
  requirements: readonly Requirement[],
  profile: CandidateProfile,
  graph?: EvidenceGraph
): JobMatchMatrix {
  if (requirements.length === 0) {
    return {
      totalRequirements: 0,
      requiredCount: 0,
      requiredMetCount: 0,
      preferredCount: 0,
      preferredMetCount: 0,
      overallMatchScore: 100,
      matches: [],
      missingRequiredRequirements: [],
      hardGapsCount: 0,
      softGapsCount: 0,
      experienceShortfallsCount: 0,
    };
  }

  const matches: RequirementMatch[] = [];
  const missingRequired: Requirement[] = [];

  let requiredCount = 0;
  let requiredMetCount = 0;
  let preferredCount = 0;
  let preferredMetCount = 0;
  let hardGapsCount = 0;
  let softGapsCount = 0;
  let experienceShortfallsCount = 0;

  for (const req of requirements) {
    const isReq = req.importance === 'required' || req.importance === 'strongly_preferred';
    if (isReq) {
      requiredCount++;
    } else {
      preferredCount++;
    }

    const normTarget = normalizeSkillName(req.normalizedSkillOrCompetency);

    // Tier 1 & 2: Skill matching (Exact and Synonyms)
    let matchedSkill = profile.skills.find((s) => {
      const rawKey = normalizeSkillName(s.name);
      const normKey = normalizeSkillName(s.normalizedName);
      return rawKey === normTarget || normKey === normTarget;
    });

    let isSynonym = false;
    if (!matchedSkill) {
      matchedSkill = profile.skills.find((s) =>
        areCompetenciesEquivalent(s.name, req.normalizedSkillOrCompetency) ||
        areCompetenciesEquivalent(s.normalizedName, req.normalizedSkillOrCompetency)
      );
      if (matchedSkill) {
        isSynonym = true;
      }
    }

    // Tier 2.5: Skill containment within requirement text (e.g. "Node.js" inside "Proven experience in Node.js development")
    if (!matchedSkill) {
      const reqRawToken = normalizeCompetencyToken(req.rawText);
      const reqNormToken = normalizeCompetencyToken(req.normalizedSkillOrCompetency);
      matchedSkill = profile.skills.find((s) => {
        const sToken = normalizeCompetencyToken(s.name);
        if (sToken.length < 3) return false;
        const escaped = sToken.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = new RegExp(`(^|\\s)${escaped}(\\s|$)`, 'i');
        return pattern.test(reqRawToken) || pattern.test(reqNormToken);
      });
      if (matchedSkill) {
        isSynonym = false;
      }
    }

    // Tier 3: Graph claims matching
    const matchedClaims = graph
      ? graph.claims.filter((c) => {
          if (c.supportedByEvidenceIds.length === 0) return false;
          const normToken = normalizeCompetencyToken(req.normalizedSkillOrCompetency);
          const hasTag = c.tags.some((t) => areCompetenciesEquivalent(t, normToken));
          const hasInStatement = normalizeCompetencyToken(c.statement).includes(normToken);
          return hasTag || hasInStatement;
        })
      : [];

    // Evaluate years of experience shortfall if requirement demands a minimum
    let candidateYears: number | undefined;
    let yearsShortfall: number | undefined;

    if (matchedSkill && matchedSkill.yearsOfExperience !== undefined) {
      candidateYears = matchedSkill.yearsOfExperience;
    }

    if (req.yearsRequired !== undefined && req.yearsRequired > 0) {
      const actualYears = candidateYears ?? 0;
      if (actualYears < req.yearsRequired) {
        yearsShortfall = req.yearsRequired - actualYears;
        experienceShortfallsCount++;
      }
    }

    // Determine match classification and confidence
    if (matchedSkill) {
      if (isReq) requiredMetCount++;
      else preferredMetCount++;

      const hasEvidence = matchedSkill.evidenceRefs.length > 0;
      let matchTier: MatchTier;
      let baseConfidence: number;

      if (!isSynonym) {
        matchTier = hasEvidence ? 'exact_evidence' : 'exact_skill';
        baseConfidence = hasEvidence ? 1.0 : 0.65;
      } else {
        matchTier = hasEvidence ? 'synonym_evidence' : 'synonym_skill';
        baseConfidence = hasEvidence ? 0.85 : 0.60;
      }

      // Seniority penalty: missing years reduces confidence score proportionally
      if (yearsShortfall && yearsShortfall > 0) {
        baseConfidence = Math.max(0.4, Number((baseConfidence - 0.15).toFixed(2)));
      }

      matches.push({
        requirementId: req.id,
        isMatched: true,
        confidenceScore: baseConfidence,
        matchedEvidenceIds: matchedSkill.evidenceRefs,
        matchedClaimIds: matchedClaims.map((c) => c.id),
        matchedCompetency: matchedSkill.name,
        matchTier,
        candidateYears,
        yearsShortfall,
        rationale: isSynonym
          ? `Matched via synonym '${matchedSkill.name}' for '${req.normalizedSkillOrCompetency}'${
              hasEvidence ? ' with verified evidence' : ' (unbacked)'
            }`
          : `Direct match on '${matchedSkill.name}'${
              hasEvidence ? ' with verified evidence' : ' (unbacked)'
            }`,
      });
    } else if (matchedClaims.length > 0) {
      if (isReq) requiredMetCount++;
      else preferredMetCount++;

      const evidenceIds = matchedClaims.flatMap((c) => c.supportedByEvidenceIds);
      matches.push({
        requirementId: req.id,
        isMatched: true,
        confidenceScore: 0.75,
        matchedEvidenceIds: evidenceIds,
        matchedClaimIds: matchedClaims.map((c) => c.id),
        matchedCompetency: req.normalizedSkillOrCompetency,
        matchTier: 'claim_match',
        candidateYears,
        yearsShortfall,
        rationale: `Substantiated by ${matchedClaims.length} candidate claim(s)`,
      });
    } else {
      if (isReq) {
        missingRequired.push(req);
        hardGapsCount++;
      } else {
        softGapsCount++;
      }

      matches.push({
        requirementId: req.id,
        isMatched: false,
        confidenceScore: 0.0,
        matchedEvidenceIds: [],
        matchedClaimIds: [],
        matchTier: 'unmatched',
        rationale: `No corresponding skill or claim found for: ${req.normalizedSkillOrCompetency}`,
      });
    }
  }

  // Weighting: 75% required qualifications, 25% preferred qualifications
  const requiredWeight = 0.75;
  const preferredWeight = 0.25;

  const reqRatio = requiredCount > 0 ? requiredMetCount / requiredCount : 1.0;
  const prefRatio = preferredCount > 0 ? preferredMetCount / preferredCount : 1.0;

  const overallMatchScore = Math.round(
    (reqRatio * requiredWeight + prefRatio * preferredWeight) * 100
  );

  return {
    totalRequirements: requirements.length,
    requiredCount,
    requiredMetCount,
    preferredCount,
    preferredMetCount,
    overallMatchScore,
    matches,
    missingRequiredRequirements: missingRequired,
    hardGapsCount,
    softGapsCount,
    experienceShortfallsCount,
  };
}
