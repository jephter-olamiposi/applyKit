/**
 * @fileoverview Unit Tests for 14-Point Resume Golden Standard & Template Engine (ADR-0026).
 */

import { describe, it, expect } from 'vitest';
import {
  createEmptyProfile,
  createProfileId,
  createExperienceId,
  createProjectId,
  createEducationId,
  createSkillId,
  createRequirementId,
  createJobPostingId,
} from '../index.js';
import type { CandidateProfile } from '../candidate/profile.js';
import type { JobPosting } from '../job/job-posting.js';
import type { TailoredResume } from '../tailoring/tailoring-types.js';
import {
  auditResumeQuality,
  autoFixResumeQualityIssues,
  calculatePagePointBudget,
  normalizeTechOrthography,
} from '../tailoring/resume-rules.js';
import { tailorCandidateResume } from '../tailoring/resume-tailorer.js';

describe('14-Point Resume Golden Standard Audit Engine', () => {
  const mockProfile: CandidateProfile = {
    ...createEmptyProfile(createProfileId('prof_test_1')),
    identity: {
      legalFirstName: 'Alex',
      legalLastName: 'Morgan',
      email: 'alex.morgan@example.com',
      phone: '+1-555-0199',
      location: { city: 'San Francisco', stateOrProvince: 'CA', country: 'USA' },
      workAuthorization: { isAuthorizedInCountry: true, requiresSponsorship: false, authorizedCountries: ['USA'] },
    },
    links: {
      linkedin: 'https://linkedin.com/in/alexmorgan',
      github: 'https://github.com/alexmorgan',
      portfolio: 'https://alexmorgan.dev',
      customLinks: [],
    },
    professional: {
      headline: 'Senior Backend Engineer',
      summary: 'Experienced distributed systems engineer.',
      currentTitle: 'Senior Software Engineer',
      totalYearsOfExperience: 6,
      primaryRoles: ['Backend Engineer'],
      targetRoles: ['Senior Backend Engineer'],
      preferredLocations: ['San Francisco, CA'],
      workplacePreference: 'hybrid',
      isOpenToRelocation: false,
    },
    skills: [
      { id: createSkillId('s1'), name: 'TypeScript', normalizedName: 'typescript', category: 'language', proficiency: 'expert', yearsOfExperience: 5, evidenceRefs: [] },
      { id: createSkillId('s2'), name: 'Node.js', normalizedName: 'nodejs', category: 'framework', proficiency: 'expert', yearsOfExperience: 5, evidenceRefs: [] },
      { id: createSkillId('s3'), name: 'PostgreSQL', normalizedName: 'postgresql', category: 'database', proficiency: 'expert', yearsOfExperience: 4, evidenceRefs: [] },
      { id: createSkillId('s4'), name: 'AWS', normalizedName: 'aws', category: 'cloud_infrastructure', proficiency: 'advanced', yearsOfExperience: 4, evidenceRefs: [] },
      { id: createSkillId('s5'), name: 'Kubernetes', normalizedName: 'kubernetes', category: 'devops_tool', proficiency: 'advanced', yearsOfExperience: 3, evidenceRefs: [] },
    ],
    experiences: [
      {
        id: createExperienceId('exp_1'),
        company: 'Stripe',
        title: 'Senior Software Engineer',
        employmentType: 'full_time',
        location: 'San Francisco, CA',
        isRemote: true,
        description: 'Core billing and payments infrastructure.',
        startDate: '2021-03',
        isCurrent: true,
        technologiesUsed: ['TypeScript', 'Node.js', 'PostgreSQL', 'AWS'],
        highlights: [
          'Architected high-throughput payment ingestion pipeline handling 15M+ daily transactions with 99.999% uptime.',
          'Optimized database queries in PostgreSQL, reducing P99 latency by 45% and saving $120k annually in RDS compute costs.',
          'Engineered event-driven microservices using AWS SQS and Lambda, scaling service capacity to 10k req/s.',
        ],
        evidenceRefs: [],
      },
      {
        id: createExperienceId('exp_2'),
        company: 'Twilio',
        title: 'Software Engineer',
        employmentType: 'full_time',
        location: 'San Francisco, CA',
        isRemote: false,
        description: 'Developer messaging platform.',
        startDate: '2018-06',
        endDate: '2021-02',
        isCurrent: false,
        technologiesUsed: ['Node.js', 'Docker', 'Kubernetes'],
        highlights: [
          'Designed and deployed automated webhook delivery service serving 500k+ global developers.',
          'Streamlined CI/CD deployment pipeline using Docker and Kubernetes, reducing release cycle time by 35%.',
        ],
        evidenceRefs: [],
      },
    ],
    projects: [
      {
        id: createProjectId('proj_1'),
        title: 'Distributed Rate Limiter',
        role: 'Creator & Lead',
        description: 'Open-source distributed token bucket rate limiter built with Redis and TypeScript.',
        technologiesUsed: ['TypeScript', 'Redis'],
        highlights: [
          'Implemented lock-free sliding window rate limiting algorithm capable of processing 50k ops/sec.',
        ],
        evidenceRefs: [],
      },
    ],
    education: [
      {
        id: createEducationId('edu_1'),
        institution: 'University of California, Berkeley',
        degree: 'B.S.',
        fieldOfStudy: 'Computer Science',
        endDate: '2018-05',
        isCompleted: true,
        honors: ['Dean\'s Honors List'],
        relevantCoursework: ['Distributed Systems', 'Database Systems'],
        activities: [],
        evidenceRefs: [],
      },
    ],
  };

  const mockJob: JobPosting = {
    id: createJobPostingId('job_test_1'),
    title: 'Senior Backend Engineer',
    companyName: 'Linear',
    location: 'San Francisco, CA',
    workplaceType: 'hybrid',
    employmentType: 'full_time',
    rawDescription: 'Looking for a Senior Backend Engineer to scale our TypeScript, Node.js, and PostgreSQL infrastructure.',
    requirements: [
      {
        id: createRequirementId('req_1'),
        rawText: 'Strong experience with TypeScript and Node.js',
        normalizedSkillOrCompetency: 'TypeScript',
        category: 'technical_skill',
        importance: 'required',
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId('req_2'),
        rawText: 'Deep knowledge of PostgreSQL performance optimization',
        normalizedSkillOrCompetency: 'PostgreSQL',
        category: 'technical_skill',
        importance: 'required',
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId('req_3'),
        rawText: 'Experience deploying on AWS or Kubernetes',
        normalizedSkillOrCompetency: 'AWS',
        category: 'technical_skill',
        importance: 'preferred',
        isRequired: false,
        matchedEvidenceIds: [],
      },
    ],
    url: 'https://linear.app/careers/senior-backend',
    parsedAt: new Date().toISOString(),
    metadata: {},
  };

  it('evaluates all 14 criteria and passes an elite candidate resume with high score', () => {
    const tailoredResume = tailorCandidateResume(mockJob, mockProfile);
    const audit = auditResumeQuality(tailoredResume, mockProfile, mockJob, 'modern');

    expect(audit.totalCount).toBe(14);
    expect(audit.overallScore).toBeGreaterThanOrEqual(85);
    expect(audit.isReady).toBe(true);

    expect(audit.checks.template_selected.status).toBe('passed');
    expect(audit.checks.one_page_fit.status).toBe('passed');
    expect(audit.checks.job_keywords.status).toBe('passed');
    expect(audit.checks.company_name.status).toBe('passed');
    expect(audit.checks.first_item_aligned.status).toBe('passed');
    expect(audit.checks.title_demonstrates_value.status).toBe('passed');
    expect(audit.checks.online_links.status).toBe('passed');
    expect(audit.checks.no_pronoun_i.status).toBe('passed');
    expect(audit.checks.no_buzzwords.status).toBe('passed');
    expect(audit.checks.action_words.status).toBe('passed');
    expect(audit.checks.impact_measured.status).toBe('passed');
    expect(audit.checks.skills_and_impressive_years.status).toBe('passed');
    expect(audit.checks.impressive_sections.status).toBe('passed');
    expect(audit.checks.no_typos_grammar.status).toBe('passed');
  });

  it('flags warning when candidate profile lacks online links', () => {
    const profileWithoutLinks: CandidateProfile = {
      ...mockProfile,
      links: { customLinks: [] },
    };
    const tailoredResume = tailorCandidateResume(mockJob, profileWithoutLinks);
    const audit = auditResumeQuality(tailoredResume, profileWithoutLinks, mockJob, 'modern');

    expect(audit.checks.online_links.status).toBe('warning');
    expect(audit.checks.online_links.description).toContain('Missing online profile links');
  });

  it('flags warning and reduces score when resume contains first-person pronouns and buzzwords', () => {
    const base = tailorCandidateResume(mockJob, mockProfile);
    const flawedResume: TailoredResume = {
      ...base,
      tailoredSummary: 'I am a passionate and results-driven ninja engineer with 6+ years of experience.',
      experiences: [
        {
          experienceId: 'exp_1',
          company: 'Stripe',
          title: 'Senior Software Engineer',
          startDate: '2021-03',
          isCurrent: true,
          relevanceScore: 90,
          rankedHighlights: [
            {
              text: 'I was responsible for helping with payment systems.',
              matchedRequirements: ['TypeScript'],
              confidenceScore: 0.9,
            },
          ],
        },
      ],
    };

    const audit = auditResumeQuality(flawedResume, mockProfile, mockJob, 'modern');

    expect(audit.checks.no_pronoun_i.status).toBe('warning');
    expect(audit.checks.no_buzzwords.status).toBe('warning');
    expect(audit.checks.action_words.status).toBe('warning');
  });

  it('normalizes technology orthography correctly', () => {
    const raw = 'Built backend with typescript, nodejs, postgres and deployed on aws with docker and k8s.';
    const normalized = normalizeTechOrthography(raw);

    expect(normalized).toContain('TypeScript');
    expect(normalized).toContain('Node.js');
    expect(normalized).toContain('PostgreSQL');
    expect(normalized).toContain('AWS');
    expect(normalized).toContain('Docker');
    expect(normalized).toContain('Kubernetes');
  });

  it('calculates page budget and confirms single-page fit', () => {
    const tailoredResume = tailorCandidateResume(mockJob, mockProfile, undefined, { onePageFit: true });
    const budget = calculatePagePointBudget(tailoredResume, mockProfile, 'compact');

    expect(budget.fitsOnePage).toBe(true);
    expect(budget.totalPoints).toBeLessThanOrEqual(760);
  });

  it('auto-fixes flaws without hallucinating or inventing credentials', () => {
    const base = tailorCandidateResume(mockJob, mockProfile);
    const flawedResume: TailoredResume = {
      ...base,
      tailoredSummary: 'I am a results-driven engineer specializing in typescript and postgres.',
      experiences: [
        {
          experienceId: 'exp_1',
          company: 'Stripe',
          title: 'Senior Software Engineer',
          startDate: '2021-03',
          isCurrent: true,
          relevanceScore: 90,
          rankedHighlights: [
            {
              text: 'responsible for building microservices using nodejs and aws.',
              matchedRequirements: ['Node.js'],
              confidenceScore: 0.9,
            },
          ],
        },
      ],
    };

    const polished = autoFixResumeQualityIssues(flawedResume, mockProfile, mockJob);

    // Pronouns and buzzwords removed
    expect(polished.tailoredSummary).not.toMatch(/\b(I am|results-driven)\b/i);
    // Tech casing normalized
    expect(polished.tailoredSummary).toContain('TypeScript');
    expect(polished.tailoredSummary).toContain('PostgreSQL');
    // Weak opening replaced with strong action verb
    expect(polished.experiences[0]?.rankedHighlights[0]?.text).toMatch(/^Spearheaded building microservices using Node\.js and AWS\./);
    // Audit regenerated and high score
    expect(polished.qualityAudit).toBeDefined();
    expect(polished.qualityAudit?.overallScore).toBeGreaterThanOrEqual(85);
  });
});
