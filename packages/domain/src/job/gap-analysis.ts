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

    const label = req.normalizedSkillOrCompetency;

    // Case 1: nothing in the profile or work history supports this requirement.
    if (!match || !match.isMatched) {
      const yearsOnly = req.category === 'experience_level' && req.yearsRequired !== undefined && match?.candidateYears !== undefined;
      if (yearsOnly) {
        const have = match!.candidateYears!;
        const diff = Math.max(0, req.yearsRequired! - have);
        gaps.push({
          requirementId: req.id,
          category: 'experience_shortfall',
          severity: isMandatory && diff >= 2 ? 'critical' : isHighPriority ? 'moderate' : 'minor',
          rawRequirementText: req.rawText,
          competency: label,
          candidateYears: have,
          requiredYears: req.yearsRequired,
          explanation: `They ask for ${req.yearsRequired}+ years. Your dated work history adds up to about ${have}.`,
          recommendation: 'Lead with your most senior, highest-impact work so scope makes up for time.',
        });
      } else if (isHighPriority) {
        gaps.push({
          requirementId: req.id,
          category: 'hard_gap',
          severity: isMandatory ? 'critical' : 'moderate',
          rawRequirementText: req.rawText,
          competency: label,
          explanation: `Nothing in your resume mentions ${label}.`,
          recommendation: `If you have done this, add a bullet that shows it. If not, it is worth one honest line in your cover letter.`,
        });
      } else {
        gaps.push({
          requirementId: req.id,
          category: 'soft_gap',
          severity: 'minor',
          rawRequirementText: req.rawText,
          competency: label,
          explanation: `Nice to have, and not in your resume: ${label}.`,
          recommendation: 'Optional. Mention related work if you have it.',
        });
      }
      continue;
    }

    // Case 2: matched, but fewer years than asked. The matcher derives years from the
    // candidate's dated roles, so use its figure rather than a self-reported skill value.
    if (req.yearsRequired !== undefined && req.yearsRequired > 0) {
      const candidateYears = match.candidateYears ?? 0;
      if (candidateYears < req.yearsRequired) {
        const diff = Math.round((req.yearsRequired - candidateYears) * 10) / 10;
        const severity: GapSeverity = isMandatory && diff >= 2 ? 'critical' : isHighPriority ? 'moderate' : 'minor';
        gaps.push({
          requirementId: req.id,
          category: 'experience_shortfall',
          severity,
          rawRequirementText: req.rawText,
          competency: label,
          candidateYears,
          requiredYears: req.yearsRequired,
          explanation: `They ask for ${req.yearsRequired}+ years of ${label}. Your roles that mention it add up to about ${candidateYears}.`,
          recommendation: `Put your strongest ${label} work first so depth makes up for the ${diff}-year difference.`,
        });
      }
    }

    // Case 3: matched only through the skills list, with no bullet that shows the work.
    const hasEvidence = match.matchedEvidenceIds.length > 0;
    if (!hasEvidence && req.category !== 'experience_level') {
      gaps.push({
        requirementId: req.id,
        category: 'unsubstantiated_claim',
        severity: isMandatory ? 'moderate' : 'minor',
        rawRequirementText: req.rawText,
        competency: label,
        explanation: `${label} is in your skills list, but no bullet shows you using it.`,
        recommendation: `Add one bullet that shows ${label} in real work. Recruiters look for proof, not a list.`,
      });
    }
  }

  const criticalGapsCount = gaps.filter((g) => g.severity === 'critical').length;
  const moderateGapsCount = gaps.filter((g) => g.severity === 'moderate').length;
  const minorGapsCount = gaps.filter((g) => g.severity === 'minor').length;

  // A years requirement the candidate nearly meets is not "missing", but the screen still
  // lists it as unmet, so the summary names it rather than leaving the counts not adding up.
  const nearYears = gaps.find((g) => g.severity !== 'critical' && g.requiredYears !== undefined && g.candidateYears !== undefined && g.candidateYears < g.requiredYears);
  const nearYearsNote = nearYears
    ? ` You are also close on experience: they ask for ${nearYears.requiredYears}+ years and you have about ${nearYears.candidateYears}.`
    : '';

  let summary = 'You meet every listed requirement, and your resume shows it.';
  if (criticalGapsCount > 0) {
    summary = `${criticalGapsCount} required ${criticalGapsCount === 1 ? 'item is' : 'items are'} missing from your resume.${nearYearsNote}`;
  } else if (nearYears) {
    summary = nearYearsNote.trim();
  } else if (moderateGapsCount > 0) {
    summary = `You cover the core requirements. ${moderateGapsCount} ${moderateGapsCount === 1 ? 'item needs' : 'items need'} stronger proof.`;
  } else if (minorGapsCount > 0) {
    summary = `Only missing ${minorGapsCount} nice-to-have ${minorGapsCount === 1 ? 'item' : 'items'}.`;
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
