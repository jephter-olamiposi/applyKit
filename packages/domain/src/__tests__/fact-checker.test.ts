import { describe, it, expect } from 'vitest';
import {
  factCheckTailoredDocument,
  createEmptyProfile,
  createProfileId,
  createExperienceId,
  createEvidenceId,
  buildEvidenceGraph,
  type CandidateProfile,
  type Evidence,
} from '../index.js';

describe('Fact-Checking Verification Pass Suite (Phase 12)', () => {
  const expId = createExperienceId('exp_backend');
  const ev1Id = createEvidenceId('ev_speed');

  const profile: CandidateProfile = {
    ...createEmptyProfile(createProfileId('prof_dev')),
    identity: {
      legalFirstName: 'Jamie',
      legalLastName: 'Reyes',
      email: 'jamie@example.com',
      phone: '+1 555-0144',
      location: { city: 'Austin', stateOrProvince: 'TX', country: 'USA' },
      workAuthorization: { isAuthorizedInCountry: true, requiresSponsorship: false, authorizedCountries: ['USA'] },
    },
    professional: {
      headline: 'Senior Backend Engineer',
      summary: 'Building high throughput APIs.',
      currentTitle: 'Senior Backend Engineer',
      totalYearsOfExperience: 5,
      primaryRoles: ['Backend Engineer'],
      targetRoles: ['Staff Engineer'],
      preferredLocations: ['Remote'],
      workplacePreference: 'remote',
      isOpenToRelocation: false,
    },
    skills: [],
    experiences: [
      {
        id: expId,
        company: 'FastData Co',
        title: 'Senior Backend Engineer',
        employmentType: 'full_time',
        location: 'Austin, TX',
        isRemote: true,
        startDate: '2021-01',
        isCurrent: true,
        description: 'Optimized internal query pipeline.',
        highlights: [
          'Engineered Redis caching layer improving query latency by 40%.',
          'Spearheaded migration to PostgreSQL with zero downtime.',
        ],
        technologiesUsed: ['Redis', 'PostgreSQL', 'Go'],
        evidenceRefs: [ev1Id],
      },
    ],
    projects: [],
  };

  const evidence: Evidence[] = [
    {
      id: ev1Id,
      source: {
        type: 'resume_bullet',
        sourceId: expId,
        metadata: { company: 'FastData Co', title: 'Senior Backend Engineer', bulletIndex: '0' },
      },
      description: 'Senior Backend Engineer at FastData Co: Engineered Redis caching layer improving query latency by 40%.',
      textSnippet: 'Engineered Redis caching layer improving query latency by 40%.',
      verificationStatus: 'verified',
      confidenceScore: 0.95,
      createdAt: '2026-03-20T10:00:00Z',
      tags: ['Redis', 'Performance'],
    },
  ];

  const graph = buildEvidenceGraph(evidence, []);

  it('certifies completely grounded document with verified evidence as pristine', () => {
    const text = `
      Dear Hiring Team at TechCorp,
      I am writing to express my strong enthusiasm for this position.
      In my recent role, I engineered a Redis caching layer improving query latency by 40%.
      I also spearheaded migration to PostgreSQL with zero downtime.
      Thank you for your consideration.
      Sincerely,
      Jamie Reyes
    `;

    const report = factCheckTailoredDocument(text, profile, graph, 'cover_letter');

    expect(report.isPristine).toBe(true);
    expect(report.groundingScore).toBeGreaterThanOrEqual(85);
    expect(report.unbackedStatements).toHaveLength(0);
    expect(report.verifiedStatements.length).toBeGreaterThanOrEqual(2);
  });

  it('flags unbacked metric as critical violation and reduces grounding score', () => {
    const text = `
      Dear Hiring Team,
      I scaled production infrastructure to generate $50M in annual revenue while cutting costs by 95%.
      Sincerely,
      Jamie Reyes
    `;

    const report = factCheckTailoredDocument(text, profile, graph, 'cover_letter');

    expect(report.isPristine).toBe(false);
    expect(report.groundingScore).toBeLessThanOrEqual(50);
    expect(report.unbackedStatements.length).toBeGreaterThanOrEqual(1);

    const criticalUnbacked = report.unbackedStatements.find((u) => u.severity === 'critical');
    expect(criticalUnbacked).toBeDefined();
    expect(criticalUnbacked?.reason).toContain('unverified metric');
    expect(report.recommendations.length).toBeGreaterThan(0);
  });

  it('flags unsubstantiated statements lacking evidence backing', () => {
    const text = `
      Dear Hiring Team,
      I authored a proprietary quantum encryption protocol deployed across 50 international banks.
      Sincerely,
      Jamie Reyes
    `;

    const report = factCheckTailoredDocument(text, profile, graph, 'cover_letter');

    expect(report.isPristine).toBe(false);
    expect(report.unbackedStatements.length).toBeGreaterThan(0);
  });
});
