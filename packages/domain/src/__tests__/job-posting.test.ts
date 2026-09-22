import { describe, it, expect } from 'vitest';
import {
  createJobPostingId,
  createRequirementId,
  createEvidenceId,
  createSkillId,
  createEmptyProfile,
  evaluateJobRequirements,
  isStrictlyRequired,
  type Requirement,
  type JobPosting,
} from '../index.js';

describe('JobPosting & Requirement System', () => {
  const ev1 = createEvidenceId('ev_ts');

  const req1: Requirement = {
    id: createRequirementId('req_1'),
    rawText: '5+ years experience building large-scale web apps in TypeScript',
    normalizedSkillOrCompetency: 'TypeScript',
    category: 'technical_skill',
    importance: 'required',
    yearsRequired: 5,
    isRequired: true,
    matchedEvidenceIds: [],
  };

  const req2: Requirement = {
    id: createRequirementId('req_2'),
    rawText: 'Experience with GraphQL APIs is preferred',
    normalizedSkillOrCompetency: 'GraphQL',
    category: 'technical_skill',
    importance: 'preferred',
    isRequired: false,
    matchedEvidenceIds: [],
  };

  const req3: Requirement = {
    id: createRequirementId('req_3'),
    rawText: 'Hands-on experience with Kubernetes in production',
    normalizedSkillOrCompetency: 'Kubernetes',
    category: 'cloud_infrastructure' as any,
    importance: 'required',
    isRequired: true,
    matchedEvidenceIds: [],
  };

  const sampleJob: JobPosting = {
    id: createJobPostingId('job_01'),
    url: 'https://careers.example.com/senior-engineer',
    title: 'Senior Full Stack Engineer',
    companyName: 'Acme Corp',
    location: 'Remote, US',
    workplaceType: 'remote',
    employmentType: 'full_time',
    rawDescription: 'Job description text...',
    parsedAt: new Date().toISOString(),
    requirements: [req1, req2, req3],
    metadata: { ats: 'greenhouse' },
  };

  it('correctly identifies strictly required requirements', () => {
    expect(isStrictlyRequired(req1)).toBe(true);
    expect(isStrictlyRequired(req2)).toBe(false);
  });

  it('evaluates requirement matching with scores and identifies gaps', () => {
    const profile = {
      ...createEmptyProfile(),
      skills: [
        {
          id: createSkillId(),
          name: 'TypeScript',
          normalizedName: 'typescript',
          category: 'language' as const,
          proficiency: 'expert' as const,
          yearsOfExperience: 6,
          evidenceRefs: [ev1],
        },
      ],
    };

    const matchMatrix = evaluateJobRequirements(sampleJob.requirements, profile);

    expect(matchMatrix.totalRequirements).toBe(3);
    expect(matchMatrix.requiredCount).toBe(2);
    expect(matchMatrix.requiredMetCount).toBe(1); // TypeScript met, Kubernetes missing
    expect(matchMatrix.missingRequiredRequirements).toHaveLength(1);
    expect(matchMatrix.missingRequiredRequirements[0]?.normalizedSkillOrCompetency).toBe('Kubernetes');
    expect(matchMatrix.overallMatchScore).toBeGreaterThan(0);
    expect(matchMatrix.overallMatchScore).toBeLessThan(100);
  });
});
