/**
 * @fileoverview Gap Analysis Reporter and Categorization Engine.
 *
 * Performs objective qualification gap analysis by comparing job requirements against
 * candidate skills, experience years, and EvidenceGraph backing. Categorizes shortfalls
 * by severity to give candidates honest, actionable guidance before application submission.
 */

import type { RequirementId } from '../types/ids.js';
import type { Requirement } from './requirement.js';
import type { RequirementMatch } from './matching.js';
import type { CandidateProfile } from '../candidate/profile.js';
import type { EvidenceGraph } from '../evidence/evidence-graph.js';
import { areCompetenciesEquivalent } from './synonyms.js';

/**
 * Impact level of an identified qualification gap.
 */
export type GapSeverity = 'critical' | 'moderate' | 'minor';

/**
 * Taxonomy of qualification gaps.
 */
export type GapCategory =
  | 'hard_gap'
  | 'soft_gap'
  | 'experience_shortfall'
  | 'unsubstantiated_claim';

/**
 * Detailed discrepancy report for a specific job requirement.
 */
export interface RequirementGap {
  readonly requirementId: RequirementId;
  readonly category: GapCategory;
  readonly severity: GapSeverity;
  readonly rawRequirementText: string;
  readonly competency: string;
  readonly candidateYears?: number;
  readonly requiredYears?: number;
  readonly explanation: string;
  readonly recommendation: string;
}

/**
 * Comprehensive qualification gap report.
 */
export interface GapAnalysisReport {
  readonly totalGaps: number;
  readonly criticalGapsCount: number;
  readonly moderateGapsCount: number;
  readonly minorGapsCount: number;
  readonly gaps: readonly RequirementGap[];
  readonly summary: string;
}

/**
 * Evaluates requirements and match outcomes to produce an actionable gap analysis report.
 *
 * Grounding Invariant: The system will never assume or invent qualifications to mask gaps.
 * Every gap represents a genuine divergence between stated employer criteria and candidate records.
 *
 * @param requirements Job requirements evaluated.
 * @param matches Individual requirement evaluation results from matching engine.
 * @param profile Candidate's verified profile aggregate.
 * @param graph Optional evidence graph verifying whether claims have supporting document snippets.
 * @returns Structured gap analysis report.
 */
export function analyzeQualificationGaps(
  requirements: readonly Requirement[],
  matches: readonly RequirementMatch[],
  profile: CandidateProfile,
  graph?: EvidenceGraph
): GapAnalysisReport {
  const matchMap = new Map<RequirementId, RequirementMatch>(
    matches.map((m) => [m.requirementId, m])
  );

  const gaps: RequirementGap[] = [];

  for (const req of requirements) {
    const match = matchMap.get(req.id);
    const isMandatory = req.importance === 'required';
    const isStronglyPreferred = req.importance === 'strongly_preferred';
    const isHighPriority = isMandatory || isStronglyPreferred;

    // Case 1: Unmatched requirement (Complete omission)
    if (!match || !match.isMatched) {
      if (isHighPriority) {
        gaps.push({
          requirementId: req.id,
          category: 'hard_gap',
          severity: isMandatory ? 'critical' : 'moderate',
          rawRequirementText: req.rawText,
          competency: req.normalizedSkillOrCompetency,
          explanation: `Mandatory qualification '${req.normalizedSkillOrCompetency}' is not listed in your verified skills or claims.`,
          recommendation: `Add relevant experience or evidence demonstrating ${req.normalizedSkillOrCompetency}, or address this gap directly in your cover letter.`,
        });
      } else {
        gaps.push({
          requirementId: req.id,
          category: 'soft_gap',
          severity: 'minor',
          rawRequirementText: req.rawText,
          competency: req.normalizedSkillOrCompetency,
          explanation: `Preferred qualification '${req.normalizedSkillOrCompetency}' was not found in your profile.`,
          recommendation: `Highlight adjacent technologies or rapid-learning capabilities that compensate for this preference.`,
        });
      }
      continue;
    }

    // Case 2: Candidate matches the skill, but check for Years of Experience Shortfall
    if (req.yearsRequired !== undefined && req.yearsRequired > 0) {
      const candidateSkill = profile.skills.find((s) =>
        areCompetenciesEquivalent(s.name, req.normalizedSkillOrCompetency) ||
        areCompetenciesEquivalent(s.normalizedName, req.normalizedSkillOrCompetency)
      );

      const candidateYears = candidateSkill?.yearsOfExperience ?? 0;

      if (candidateYears < req.yearsRequired) {
        const diff = req.yearsRequired - candidateYears;
        const severity: GapSeverity = isMandatory && diff >= 2 ? 'critical' : isHighPriority ? 'moderate' : 'minor';

        gaps.push({
          requirementId: req.id,
          category: 'experience_shortfall',
          severity,
          rawRequirementText: req.rawText,
          competency: req.normalizedSkillOrCompetency,
          candidateYears,
          requiredYears: req.yearsRequired,
          explanation: `Role requires ${req.yearsRequired} years of ${req.normalizedSkillOrCompetency}, but your profile records ${candidateYears} years.`,
          recommendation: `Emphasize depth, velocity, or high-impact accomplishments with ${req.normalizedSkillOrCompetency} to offset the ${diff}-year seniority gap.`,
        });
      }
    }

    // Case 3: Matched in profile skills, but zero evidence in EvidenceGraph (Unsubstantiated Claim)
    const hasEvidence = match.matchedEvidenceIds.length > 0;
    if (!hasEvidence) {
      // Check if evidence graph exists and is checked
      const severity: GapSeverity = isMandatory ? 'moderate' : 'minor';

      gaps.push({
        requirementId: req.id,
        category: 'unsubstantiated_claim',
        severity,
        rawRequirementText: req.rawText,
        competency: req.normalizedSkillOrCompetency,
        explanation: `Skill '${req.normalizedSkillOrCompetency}' is listed in your profile but lacks linked resume or document evidence.`,
        recommendation: `Link specific project bullet points or past roles to '${req.normalizedSkillOrCompetency}' to raise confidence to 100%.`,
      });
    }
  }

  const criticalGapsCount = gaps.filter((g) => g.severity === 'critical').length;
  const moderateGapsCount = gaps.filter((g) => g.severity === 'moderate').length;
  const minorGapsCount = gaps.filter((g) => g.severity === 'minor').length;

  let summary = 'Profile matches all required qualifications with verified evidence.';
  if (criticalGapsCount > 0) {
    summary = `Identified ${criticalGapsCount} critical qualification gap(s) on required criteria that may affect application viability.`;
  } else if (moderateGapsCount > 0) {
    summary = `Profile covers core requirements, with ${moderateGapsCount} moderate gap(s) or shortfalls worth addressing.`;
  } else if (minorGapsCount > 0) {
    summary = `Strong overall match. ${minorGapsCount} minor preference gap(s) detected.`;
  }

  return {
    totalGaps: gaps.length,
    criticalGapsCount,
    moderateGapsCount,
    minorGapsCount,
    gaps,
    summary,
  };
}
