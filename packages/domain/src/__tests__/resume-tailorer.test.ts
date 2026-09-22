import { describe, it, expect } from 'vitest';
import {
  tailorCandidateResume,
  createEmptyProfile,
  createProfileId,
  createExperienceId,
  createProjectId,
  createSkillId,
  createEvidenceId,
  createJobPostingId,
  createRequirementId,
  normalizeSkillName,
  buildEvidenceGraph,
  type JobPosting,
  type CandidateProfile,
  type Evidence,
} from '../index.js';

describe('Dynamic Resume Section & Bullet Selector Suite (Phase 12)', () => {
  const sampleJob: JobPosting = {
    id: createJobPostingId('job_senior_react'),
    url: 'https://careers.example.com/senior-frontend',
    title: 'Senior Frontend Engineer',
    companyName: 'Acme SaaS',
    location: 'Remote',
    workplaceType: 'remote',
    employmentType: 'full_time',
    parsedAt: '2026-03-20T10:00:00Z',
    rawDescription: 'We are seeking a Senior Frontend Engineer proficient in React, TypeScript, and Next.js. Experience with Tailwind CSS is a plus.',
    metadata: {},
    requirements: [
      {
        id: createRequirementId('req_react'),
        rawText: 'Strong proficiency in React and TypeScript',
        normalizedSkillOrCompetency: 'react',
        category: 'technical_skill',
        importance: 'required',
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId('req_nextjs'),
        rawText: 'Production experience with Next.js architecture',
        normalizedSkillOrCompetency: 'nextjs',
        category: 'technical_skill',
        importance: 'required',
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId('req_tailwind'),
        rawText: 'Familiarity with Tailwind CSS or modern CSS paradigms',
        normalizedSkillOrCompetency: 'tailwind css',
        category: 'technical_skill',
        importance: 'preferred',
        isRequired: false,
        matchedEvidenceIds: [],
      },
    ],
  };

  const exp1Id = createExperienceId('exp_legacy_java');
  const exp2Id = createExperienceId('exp_modern_react');
  const ev1Id = createEvidenceId('ev_react_perf');

  const sampleProfile: CandidateProfile = {
    ...createEmptyProfile(createProfileId('prof_alex')),
    identity: {
      legalFirstName: 'Alex',
      legalLastName: 'Morgan',
      email: 'alex.morgan@example.com',
      phone: '+1 555-0199',
      location: { city: 'Seattle', stateOrProvince: 'WA', country: 'USA' },
      workAuthorization: { isAuthorizedInCountry: true, requiresSponsorship: false, authorizedCountries: ['USA'] },
    },
    professional: {
      headline: 'Full Stack Engineer',
      summary: 'Passionate developer building modern web apps.',
      currentTitle: 'Senior Frontend Engineer',
      totalYearsOfExperience: 6,
      primaryRoles: ['Frontend Engineer'],
      targetRoles: ['Senior Frontend Engineer'],
      preferredLocations: ['Remote'],
      workplacePreference: 'remote',
      isOpenToRelocation: false,
    },
    skills: [
      { id: createSkillId(), name: 'React', normalizedName: normalizeSkillName('React'), category: 'framework', proficiency: 'expert', yearsOfExperience: 5, evidenceRefs: [] },
      { id: createSkillId(), name: 'TypeScript', normalizedName: normalizeSkillName('TypeScript'), category: 'language', proficiency: 'expert', yearsOfExperience: 5, evidenceRefs: [] },
      { id: createSkillId(), name: 'Next.js', normalizedName: normalizeSkillName('Next.js'), category: 'framework', proficiency: 'advanced', yearsOfExperience: 4, evidenceRefs: [] },
      { id: createSkillId(), name: 'Tailwind CSS', normalizedName: normalizeSkillName('Tailwind CSS'), category: 'framework', proficiency: 'advanced', yearsOfExperience: 3, evidenceRefs: [] },
      { id: createSkillId(), name: 'PostgreSQL', normalizedName: normalizeSkillName('PostgreSQL'), category: 'database', proficiency: 'intermediate', yearsOfExperience: 3, evidenceRefs: [] },
      { id: createSkillId(), name: 'Docker', normalizedName: normalizeSkillName('Docker'), category: 'cloud_infrastructure', proficiency: 'intermediate', yearsOfExperience: 3, evidenceRefs: [] },
    ],
    experiences: [
      {
        id: exp1Id,
        company: 'Legacy Enterprise Corp',
        title: 'Backend Developer',
        employmentType: 'full_time',
        location: 'Seattle, WA',
        isRemote: false,
        startDate: '2019-01',
        endDate: '2021-06',
        isCurrent: false,
        description: 'Maintained monolithic backend systems.',
        highlights: [
          'Maintained SQL database schemas and stored procedures.',
          'Resolved legacy defect tickets in sprint cycles.',
        ],
        technologiesUsed: ['Java', 'Spring', 'SQL'],
        evidenceRefs: [],
      },
      {
        id: exp2Id,
        company: 'Modern Cloud Inc',
        title: 'Frontend Lead',
        employmentType: 'full_time',
        location: 'Remote',
        isRemote: true,
        startDate: '2021-07',
        isCurrent: true,
        description: 'Led architecture of customer-facing React portal.',
        highlights: [
          'Migrated legacy dashboard to React and Next.js, reducing LCP by 45%.',
          'Wrote unit and component integration tests achieving 90% code coverage.',
          'Architected responsive UI components using Tailwind CSS and TypeScript.',
        ],
        technologiesUsed: ['React', 'Next.js', 'TypeScript', 'Tailwind CSS'],
        evidenceRefs: [ev1Id],
      },
    ],
    projects: [
      {
        id: createProjectId('proj_showcase'),
        title: 'NextJS Analytics Platform',
        description: 'Open source dashboard demonstrating Next.js SSR.',
        role: 'Creator',
        technologiesUsed: ['Next.js', 'React', 'Tailwind CSS'],
        highlights: [
          'Built high-performance dashboard with React server components serving 50k monthly active users.',
        ],
        evidenceRefs: [],
      },
    ],
  };

  const sampleEvidence: Evidence[] = [
    {
      id: ev1Id,
      source: {
        type: 'resume_bullet',
        sourceId: exp2Id,
        metadata: { company: 'Modern Cloud Inc', title: 'Frontend Lead', bulletIndex: '0' },
      },
      description: 'Frontend Lead at Modern Cloud Inc: Migrated legacy dashboard to React and Next.js, reducing LCP by 45%.',
      textSnippet: 'Migrated legacy dashboard to React and Next.js, reducing LCP by 45%.',
      verificationStatus: 'verified',
      confidenceScore: 0.95,
      createdAt: '2026-03-20T10:00:00Z',
      tags: ['React', 'Next.js'],
    },
  ];

  const graph = buildEvidenceGraph(sampleEvidence, []);

  it('partitions skills into matched required, matched preferred, and additional skills', () => {
    const tailored = tailorCandidateResume(sampleJob, sampleProfile, graph);

    expect(tailored.skills.matchedRequired).toContain('React');
    expect(tailored.skills.matchedRequired).toContain('Next.js');
    expect(tailored.skills.matchedPreferred).toContain('Tailwind CSS');
    expect(tailored.skills.additionalSkills).toContain('PostgreSQL');
    expect(tailored.skills.additionalSkills).toContain('Docker');
  });

  it('ranks high-relevance experience above low-relevance experience', () => {
    const tailored = tailorCandidateResume(sampleJob, sampleProfile, graph);

    expect(tailored.experiences).toHaveLength(2);
    expect(tailored.experiences[0]!.company).toBe('Modern Cloud Inc');
    expect(tailored.experiences[0]!.relevanceScore).toBeGreaterThan(tailored.experiences[1]!.relevanceScore);
    expect(tailored.experiences[1]!.company).toBe('Legacy Enterprise Corp');
  });

  it('ranks matching accomplishment bullets first and links source evidence', () => {
    const tailored = tailorCandidateResume(sampleJob, sampleProfile, graph);
    const modernExp = tailored.experiences[0]!;

    expect(modernExp.rankedHighlights[0]!.text).toContain('Migrated legacy dashboard to React and Next.js');
    expect(modernExp.rankedHighlights[0]!.matchedRequirements.length).toBeGreaterThan(0);
    expect(modernExp.rankedHighlights[0]!.sourceEvidenceId).toBe(ev1Id);
    expect(modernExp.rankedHighlights[0]!.confidenceScore).toBe(0.95);
  });

  it('synthesizes an evidence-grounded executive summary with verified metrics', () => {
    const tailored = tailorCandidateResume(sampleJob, sampleProfile, graph);

    expect(tailored.tailoredSummary).toContain('Senior Frontend Engineer');
    expect(tailored.tailoredSummary).toContain('Acme SaaS');
    expect(tailored.tailoredSummary).toContain('React');
    expect(tailored.tailoredSummary).toContain('reducing LCP by 45%');
  });

  it('honors configuration options for max bullets and projects', () => {
    const tailored = tailorCandidateResume(sampleJob, sampleProfile, graph, {
      maxBulletsPerItem: 1,
      maxProjects: 1,
    });

    expect(tailored.experiences[0]!.rankedHighlights).toHaveLength(1);
    expect(tailored.projects).toHaveLength(1);
  });
});
