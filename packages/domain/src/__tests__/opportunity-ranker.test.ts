/**
 * @fileoverview Unit tests for Expected-Value Tiered Opportunity Ranker (SKILL.md Phase 2).
 */

import { describe, it, expect } from 'vitest';
import { rankPipelineOpportunities } from '../job/opportunity-ranker.js';
import { createEmptyProfile } from '../candidate/profile.js';
import { createProfileId } from '../types/ids.js';
import { createApplicationRecord, type ApplicationRecord } from '../application/record.js';

describe('Expected-Value Opportunity Ranker Suite (Phase 2: Verify)', () => {
  const sampleProfile = {
    ...createEmptyProfile(createProfileId('prof_ranker_test')),
    savedAnswers: [
      {
        id: 'ans_salary' as any,
        canonicalKey: 'expected_salary',
        promptPatterns: ['expected salary'],
        answerText: '$140,000 USD',
        category: 'salary_expectations' as const,
        tags: ['compensation'],
        evidenceRefs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };

  const createMockApp = (id: string, title: string, notes: string): ApplicationRecord =>
    createApplicationRecord({
      id: id as any,
      candidateProfileId: 'prof_ranker_test' as any,
      jobPostingId: `job_${id}` as any,
      jobTitle: title,
      companyName: 'Acme',
      jobPostingUrl: 'https://example.com/job',
      notes,
    });

  it('partitions applications into 4 canonical tiers based on expected value and eligibility', () => {
    const apps: ApplicationRecord[] = [
      createMockApp('1', 'Staff Systems Engineer', 'salary: $160,000; status: open'),
      createMockApp('2', 'Senior Backend Engineer', 'salary: $150,000; status: open'),
      createMockApp('3', 'Lead Engineer (Timezone Overlap)', 'timezone overlap conditional: 4 hours CET overlap required'),
      createMockApp('4', 'Underpaid Engineer', 'salary: $90,000; status: open'),
      createMockApp('5', 'Blocked Engineer', 'BLOCKED: Geography gate failed. Must be based in United States.'),
    ];

    const matchScores = {
      '1': 92, // Tier 1: Open, Comp > 140k, Match >= 80%
      '2': 72, // Tier 2: Open, Comp > 140k, Match < 80%
      '3': 85, // Tier 3: Conditional overlap
      '4': 88, // Tier 4: Below floor ($90k < $140k)
      '5': 95, // Tier 4: Blocked by 5-gate screening
    };

    const result = rankPipelineOpportunities(apps, sampleProfile, { matchScores });

    expect(result.totalRanked).toBe(5);

    // Tier 1: High EV
    expect(result.tier1HighEv.length).toBe(1);
    expect(result.tier1HighEv[0]?.application.id).toBe('1');
    expect(result.tier1HighEv[0]?.matchScore).toBe(92);

    // Tier 2: Competitive Match
    expect(result.tier2Competitive.length).toBe(1);
    expect(result.tier2Competitive[0]?.application.id).toBe('2');

    // Tier 3: Conditional Overlap
    expect(result.tier3Conditional.length).toBe(1);
    expect(result.tier3Conditional[0]?.application.id).toBe('3');

    // Tier 4: Low or Blocked
    expect(result.tier4LowOrBlocked.length).toBe(2);
    expect(result.tier4LowOrBlocked.some((item) => item.application.id === '4')).toBe(true);
    expect(result.tier4LowOrBlocked.some((item) => item.application.id === '5')).toBe(true);
  });
});
