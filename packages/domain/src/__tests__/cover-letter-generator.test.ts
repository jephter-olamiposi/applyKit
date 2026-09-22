import { describe, it, expect } from 'vitest';
import {
  generateGroundedCoverLetter,
  createEmptyProfile,
  createProfileId,
  createExperienceId,
  createSkillId,
  createEvidenceId,
  createJobPostingId,
  createRequirementId,
  buildEvidenceGraph,
  type JobPosting,
  type CandidateProfile,
  type Evidence,
} from '../index.js';

describe('Evidence-Grounded Cover Letter Generator Suite (Phase 12)', () => {
  const sampleJob: JobPosting = {
    id: createJobPostingId('job_cloud_arch'),
    url: 'https://careers.example.com/cloud-architect',
    title: 'Cloud Systems Architect',
    companyName: 'CloudScale Technologies',
    location: 'Remote',
    workplaceType: 'remote',
    employmentType: 'full_time',
    parsedAt: '2026-03-20T10:00:00Z',
    rawDescription: 'Seeking an experienced Cloud Architect to optimize AWS and Kubernetes infrastructure.',
    metadata: {},
    requirements: [
      {
        id: createRequirementId('req_aws'),
        rawText: '5+ years designing resilient AWS architectures',
        normalizedSkillOrCompetency: 'aws',
        category: 'technical_skill',
        importance: 'required',
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId('req_k8s'),
        rawText: 'Production Kubernetes cluster management',
        normalizedSkillOrCompetency: 'kubernetes',
        category: 'technical_skill',
        importance: 'required',
        isRequired: true,
        matchedEvidenceIds: [],
      },
    ],
  };

  const expId = createExperienceId('exp_cloud');
  const ev1Id = createEvidenceId('ev_aws_scale');
  const ev2Id = createEvidenceId('ev_k8s_uptime');

  const sampleProfile: CandidateProfile = {
    ...createEmptyProfile(createProfileId('prof_taylor')),
    identity: {
      legalFirstName: 'Taylor',
      legalLastName: 'Swift',
      preferredName: 'Taylor',
      email: 'taylor@example.com',
      phone: '+1 555-0188',
      location: { city: 'San Francisco', stateOrProvince: 'CA', country: 'USA' },
      workAuthorization: { isAuthorizedInCountry: true, requiresSponsorship: false, authorizedCountries: ['USA'] },
    },
    professional: {
      headline: 'Principal Infrastructure Architect',
      summary: 'Specializing in cloud resilience and container orchestration.',
      currentTitle: 'Lead Cloud Engineer',
      totalYearsOfExperience: 8,
      primaryRoles: ['Cloud Architect'],
      targetRoles: ['Cloud Systems Architect'],
      preferredLocations: ['Remote'],
      workplacePreference: 'remote',
      isOpenToRelocation: false,
    },
    skills: [
      { id: createSkillId(), name: 'AWS', normalizedName: 'aws', category: 'cloud_infrastructure', proficiency: 'expert', yearsOfExperience: 7, evidenceRefs: [] },
      { id: createSkillId(), name: 'Kubernetes', normalizedName: 'kubernetes', category: 'cloud_infrastructure', proficiency: 'expert', yearsOfExperience: 6, evidenceRefs: [] },
      { id: createSkillId(), name: 'Terraform', normalizedName: 'terraform', category: 'cloud_infrastructure', proficiency: 'advanced', yearsOfExperience: 5, evidenceRefs: [] },
    ],
    experiences: [
      {
        id: expId,
        company: 'Apex Infrastructure Group',
        title: 'Lead Cloud Engineer',
        employmentType: 'full_time',
        location: 'San Francisco, CA',
        isRemote: true,
        startDate: '2020-01',
        isCurrent: true,
        description: 'Led multi-region cloud migrations.',
        highlights: [
          'Architected multi-region AWS infrastructure supporting 10M+ daily active sessions with 99.995% availability.',
          'Automated Kubernetes cluster deployments with Terraform reducing provisioning time from 4 hours to 12 minutes.',
        ],
        technologiesUsed: ['AWS', 'Kubernetes', 'Terraform'],
        evidenceRefs: [ev1Id, ev2Id],
      },
    ],
    projects: [],
  };

  const sampleEvidence: Evidence[] = [
    {
      id: ev1Id,
      source: {
        type: 'resume_bullet',
        sourceId: expId,
        metadata: { company: 'Apex Infrastructure Group', title: 'Lead Cloud Engineer', bulletIndex: '0' },
      },
      description: 'Architected multi-region AWS infrastructure supporting 10M+ daily active sessions with 99.995% availability.',
      textSnippet: 'Architected multi-region AWS infrastructure supporting 10M+ daily active sessions with 99.995% availability.',
      verificationStatus: 'verified',
      confidenceScore: 0.95,
      createdAt: '2026-03-20T10:00:00Z',
      tags: ['AWS', 'Scale'],
    },
    {
      id: ev2Id,
      source: {
        type: 'resume_bullet',
        sourceId: expId,
        metadata: { company: 'Apex Infrastructure Group', title: 'Lead Cloud Engineer', bulletIndex: '1' },
      },
      description: 'Automated Kubernetes cluster deployments with Terraform reducing provisioning time from 4 hours to 12 minutes.',
      textSnippet: 'Automated Kubernetes cluster deployments with Terraform reducing provisioning time from 4 hours to 12 minutes.',
      verificationStatus: 'verified',
      confidenceScore: 0.95,
      createdAt: '2026-03-20T10:00:00Z',
      tags: ['Kubernetes', 'Terraform'],
    },
  ];

  const graph = buildEvidenceGraph(sampleEvidence, []);

  it('constructs an authentic opening paragraph tailored to target role and company', () => {
    const coverLetter = generateGroundedCoverLetter(sampleJob, sampleProfile, graph);

    expect(coverLetter.targetJobTitle).toBe('Cloud Systems Architect');
    expect(coverLetter.companyName).toBe('CloudScale Technologies');
    expect(coverLetter.candidateName).toBe('Taylor Swift');
    expect(coverLetter.openingParagraph).toContain('Cloud Systems Architect');
    expect(coverLetter.openingParagraph).toContain('CloudScale Technologies');
    expect(coverLetter.openingParagraph).toContain('AWS');
  });

  it('incorporates verified evidence accomplishments into body paragraphs with citations', () => {
    const coverLetter = generateGroundedCoverLetter(sampleJob, sampleProfile, graph);

    expect(coverLetter.bodyParagraphs.length).toBeGreaterThanOrEqual(1);
    expect(coverLetter.allCitations.length).toBeGreaterThanOrEqual(1);

    // Citations must link to verified evidence IDs
    const citationIds = coverLetter.allCitations.map((c) => c.evidenceId);
    expect(citationIds).toContain(ev1Id);

    // Text includes the verifiable accomplishment
    expect(coverLetter.fullText).toContain('10M+ daily active sessions');
  });

  it('includes closing paragraph and recipient customization', () => {
    const coverLetter = generateGroundedCoverLetter(sampleJob, sampleProfile, graph, {
      recipient: 'Dr. Sarah Connor, VP of Engineering',
    });

    expect(coverLetter.fullText).toContain('Dear Dr. Sarah Connor, VP of Engineering,');
    expect(coverLetter.closingParagraph).toContain('Sincerely,');
    expect(coverLetter.closingParagraph).toContain('Taylor Swift');
  });
});
