import { describe, it, expect } from 'vitest';
import { parsePlainTextResume } from '../evidence/parser.js';
import { createProfileFromParsedResume } from '../evidence/decomposer.js';
import { deriveClaimsFromEvidence } from '../evidence/claims.js';
import { buildEvidenceGraph } from '../evidence/evidence-graph.js';
import { evaluateJobRequirements, computeExperienceYears } from '../job/matching.js';
import { createRequirementId } from '../types/ids.js';
import type { Requirement, RequirementCategory, Importance } from '../job/requirement.js';

const RESUME = `Boluwatife Olaifa
Lagos, Nigeria | bolu@example.com

EXPERIENCE
Senior Backend Engineer, Kuda Lite (Lagos) | Jan 2023 - Present
- Built a double-entry ledger service in Go and PostgreSQL handling 1.2M transactions per day
- Cut payout reconciliation time from 6 hours to 40 minutes by moving batch jobs to Kafka consumers
Backend Engineer, CareLink Health | Mar 2020 - Dec 2022
- Designed REST and gRPC APIs in Go for appointment booking used by 40 clinics
- Migrated services from Heroku to AWS ECS, reducing hosting costs by 35%

SKILLS
Go, PostgreSQL, Kafka, gRPC, AWS
`;

function req(rawText: string, key: string, category: RequirementCategory, importance: Importance = 'required', yearsRequired?: number): Requirement {
  return {
    id: createRequirementId(),
    rawText,
    normalizedSkillOrCompetency: key,
    category,
    importance,
    isRequired: importance === 'required',
    matchedEvidenceIds: [],
    ...(yearsRequired !== undefined ? { yearsRequired } : {}),
  };
}

function setup() {
  const { profile, evidence } = createProfileFromParsedResume(parsePlainTextResume(RESUME));
  const claims = deriveClaimsFromEvidence(evidence);
  return { profile: { ...profile, claims }, graph: buildEvidenceGraph(evidence, claims) };
}

describe('Matching against a real backend resume', () => {
  it('counts years from dated roles, merging overlaps', () => {
    const { profile } = setup();
    const years = computeExperienceYears(profile.experiences, new Date(Date.UTC(2026, 0, 1)));
    expect(years).toBeGreaterThan(5.5);
    expect(years).toBeLessThan(6.5);
  });

  it('meets "5+ years of backend experience" from work history', () => {
    const { profile, graph } = setup();
    const r = req('5+ years of backend engineering experience', '5+ years of backend engineering experience', 'experience_level', 'required', 5);
    const m = evaluateJobRequirements([r], profile, graph);
    expect(m.matches[0]?.isMatched).toBe(true);
  });

  it('recognizes Go inside a sentence and payments work as fintech', () => {
    const { profile, graph } = setup();
    const go = req('Strong Go experience in production', 'Strong Go experience in production', 'technical_skill');
    const fintech = req('Experience building payment or fintech systems', 'payment or fintech systems', 'domain_knowledge');
    const m = evaluateJobRequirements([go, fintech], profile, graph);
    expect(m.matches.map((x) => x.isMatched)).toEqual([true, true]);
    expect(m.matches[1]?.matchedEvidenceIds.length).toBeGreaterThan(0);
  });

  it('reports the missing half of a two-part requirement', () => {
    const { profile, graph } = setup();
    const r = req('Familiarity with Kubernetes and AWS', 'Kubernetes', 'technical_skill');
    const m = evaluateJobRequirements([r], profile, graph);
    expect(m.matches[0]?.missingParts).toEqual(['Kubernetes']);
  });

  it('still reports a real gap', () => {
    const { profile, graph } = setup();
    const r = req('Experience with PCI DSS', 'PCI DSS', 'certification', 'preferred');
    expect(evaluateJobRequirements([r], profile, graph).matches[0]?.isMatched).toBe(false);
  });
});
