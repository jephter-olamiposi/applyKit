/**
 * @fileoverview Expected-Value Tiered Opportunity Ranker based on SKILL.md Phase 2.
 *
 * Implements the sorting directive:
 * "Sort survivors by expected value: OPEN with pay above floor and a strong stack match,
 * then OPEN with partial match, then CONDITIONAL, then below floor."
 */

import type { ApplicationRecord } from '../application/record.js';
import type { CandidateProfile } from '../candidate/profile.js';

/**
 * Expected-value priority tier for an opportunity.
 */
export type OpportunityTierCategory =
  | 'tier1_high_ev'
  | 'tier2_competitive'
  | 'tier3_conditional'
  | 'tier4_low_or_blocked';

/**
 * An individual evaluated and ranked opportunity item.
 */
export interface RankedOpportunityItem {
  readonly application: ApplicationRecord;
  readonly tier: OpportunityTierCategory;
  readonly tierLabel: string;
  readonly matchScore: number;
  readonly isAboveFloor: boolean;
  readonly reasons: readonly string[];
}

/**
 * Partitioned opportunity tiers ready for batch candidate review and execution.
 */
export interface RankedOpportunityTiers {
  readonly tier1HighEv: readonly RankedOpportunityItem[];
  readonly tier2Competitive: readonly RankedOpportunityItem[];
  readonly tier3Conditional: readonly RankedOpportunityItem[];
  readonly tier4LowOrBlocked: readonly RankedOpportunityItem[];
  readonly totalRanked: number;
}

/**
 * Options for ranking pipeline opportunities.
 */
export interface OpportunityRankingOptions {
  /** Optional pre-computed match scores map keyed by jobPostingId or applicationId. */
  readonly matchScores?: Readonly<Record<string, number>>;
  /** Custom compensation floor in USD or local currency. */
  readonly compensationFloor?: number;
}

/**
 * Evaluates and partitions a collection of applications into canonical expected-value tiers.
 *
 * @param applications Candidate application records.
 * @param profile Verified candidate profile.
 * @param options Ranking options and match scores.
 * @returns RankedOpportunityTiers partitioned by expected value.
 */
export function rankPipelineOpportunities(
  applications: readonly ApplicationRecord[],
  profile: CandidateProfile,
  options?: OpportunityRankingOptions
): RankedOpportunityTiers {
  const tier1: RankedOpportunityItem[] = [];
  const tier2: RankedOpportunityItem[] = [];
  const tier3: RankedOpportunityItem[] = [];
  const tier4: RankedOpportunityItem[] = [];

  const defaultCompFloor = options?.compensationFloor ?? parseCompensationFloor(profile);

  for (const app of applications) {
    const reasons: string[] = [];
    const notesLower = (app.notes || '').toLowerCase();
    const isBlocked = notesLower.includes('blocked') || notesLower.includes('ineligible') || app.currentStatus === 'failed';
    const isConditional = notesLower.includes('conditional') || notesLower.includes('timezone overlap');

    const score = options?.matchScores?.[app.jobPostingId] ?? options?.matchScores?.[app.id] ?? 75;

    // Check compensation floor
    const statedComp = parseExtractedComp(app.notes);
    const isAboveFloor = statedComp === null || defaultCompFloor === null || statedComp >= defaultCompFloor;

    if (!isAboveFloor) {
      reasons.push(`Compensation (${statedComp}) below floor threshold (${defaultCompFloor}).`);
    }

    if (isBlocked) {
      reasons.push('Disqualified by 5-gate eligibility check.');
      tier4.push({
        application: app,
        tier: 'tier4_low_or_blocked',
        tierLabel: 'Tier 4: Blocked / Low EV',
        matchScore: score,
        isAboveFloor,
        reasons,
      });
      continue;
    }

    if (!isAboveFloor) {
      tier4.push({
        application: app,
        tier: 'tier4_low_or_blocked',
        tierLabel: 'Tier 4: Below Floor Threshold',
        matchScore: score,
        isAboveFloor: false,
        reasons,
      });
      continue;
    }

    if (isConditional) {
      reasons.push('Conditional eligibility: Timezone or core hours overlap confirmation required.');
      tier3.push({
        application: app,
        tier: 'tier3_conditional',
        tierLabel: 'Tier 3: Conditional Overlap',
        matchScore: score,
        isAboveFloor: true,
        reasons,
      });
      continue;
    }

    // High vs Competitive EV based on match score
    if (score >= 80) {
      reasons.push(`Strong qualification fit (${score}%) and verified eligibility above comp floor.`);
      tier1.push({
        application: app,
        tier: 'tier1_high_ev',
        tierLabel: 'Tier 1: High Expected Value',
        matchScore: score,
        isAboveFloor: true,
        reasons,
      });
    } else {
      reasons.push(`Competitive partial match (${score}%) and verified eligibility.`);
      tier2.push({
        application: app,
        tier: 'tier2_competitive',
        tierLabel: 'Tier 2: Competitive Match',
        matchScore: score,
        isAboveFloor: true,
        reasons,
      });
    }
  }

  // Sort within each tier by match score descending
  tier1.sort((a, b) => b.matchScore - a.matchScore);
  tier2.sort((a, b) => b.matchScore - a.matchScore);
  tier3.sort((a, b) => b.matchScore - a.matchScore);

  return {
    tier1HighEv: tier1,
    tier2Competitive: tier2,
    tier3Conditional: tier3,
    tier4LowOrBlocked: tier4,
    totalRanked: applications.length,
  };
}

/**
 * Extracts numeric compensation value from candidate profile or saved answers.
 */
function parseCompensationFloor(profile: CandidateProfile): number | null {
  const ans = profile.savedAnswers.find((a) => a.canonicalKey === 'expected_salary')?.answerText;
  if (!ans) return null;
  const numMatch = ans.match(/(\d[\d,]*)/);
  if (!numMatch || !numMatch[1]) return null;
  return Number(numMatch[1].replace(/,/g, ''));
}

/**
 * Extracts approximate numeric compensation from notes if present.
 */
function parseExtractedComp(notes?: string): number | null {
  if (!notes) return null;
  const compMatch = notes.match(/(?:salary|comp|floor):\s*\$?(\d[\d,]*)/i);
  if (!compMatch || !compMatch[1]) return null;
  return Number(compMatch[1].replace(/,/g, ''));
}
