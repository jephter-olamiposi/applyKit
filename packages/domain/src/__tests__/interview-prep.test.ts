import { describe, it, expect } from 'vitest';
import {
  generateInterviewPrepKit,
  type InterviewPrepKit,
} from '../tailoring/interview-prep.js';
import {
  createEmptyProfile,
  createProfileId,
  createSkillId,
  createExperienceId,
  createJobPostingId,
  createRequirementId,
  createEvidenceId,
  buildEvidenceGraph,
  type JobPosting,
  type CandidateProfile,
} from '../index.js';

describe('Evidence-Grounded Interview Prep & STAR Story Synthesizer', () => {
  const job: JobPosting = {
    id: createJobPostingId('job_test_dist'),
    url: 'https://canonical.com/careers/4581200',
    title: 'Distributed Systems Engineer',
    companyName: 'Canonical',
    location: 'Remote',
    workplaceType: 'remote',
    employmentType: 'full_time',
    rawDescription: 'Building distributed systems in Go with Kafka and Linux.',
    parsedAt: '2026-09-29T00:00:00Z',
    requirements: [
      {
        id: createRequirementId('req_go'),
        rawText: 'Go backend systems',
        category: 'technical_skill',
        importance: 'required',
        normalizedSkillOrCompetency: 'Go',
        yearsRequired: 4,
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId('req_kafka'),
        rawText: 'Kafka stream processing',
        category: 'technical_skill',
        importance: 'required',
        normalizedSkillOrCompetency: 'Kafka',
        yearsRequired: 3,
        isRequired: true,
        matchedEvidenceIds: [],
      },
    ],
    metadata: { ats: 'greenhouse' },
  };

  const profile: CandidateProfile = {
    ...createEmptyProfile(createProfileId('prof_candidate')),
    skills: [
      {
        id: createSkillId('sk_go'),
        name: 'Go',
        normalizedName: 'go',
        category: 'language',
        proficiency: 'expert',
        yearsOfExperience: 6,
        evidenceRefs: [],
      },
    ],
    experiences: [
      {
        id: createExperienceId('exp_lead'),
        company: 'CloudStream Systems',
        title: 'Lead Systems Architect',
        employmentType: 'full_time',
        location: 'London',
        isRemote: true,
        startDate: '2022-01',
        isCurrent: true,
        description: 'Engineered streaming engines.',
        technologiesUsed: ['Go', 'Kafka', 'Linux'],
        evidenceRefs: [],
        highlights: [
          'Architected Raft consensus engine in Go sustaining 300,000 events/second.',
        ],
      },
    ],
  };

  const ev1 = {
    id: createEvidenceId('ev_raft'),
    source: { type: 'resume_bullet' as const, sourceId: 'exp_lead' },
    description: 'Raft consensus in Go',
    textSnippet: 'Architected Raft consensus engine in Go sustaining 300,000 events/second.',
    verificationStatus: 'verified' as const,
    confidenceScore: 1.0,
    createdAt: '2026-09-29T00:00:00Z',
    tags: ['Go', 'Kafka'],
  };

  const evidenceGraph = buildEvidenceGraph([ev1], []);

  it('synthesizes role-tailored technical questions citing matching evidence', () => {
    const prepKit: InterviewPrepKit = generateInterviewPrepKit(job, profile, evidenceGraph);

    expect(prepKit.jobTitle).toBe('Distributed Systems Engineer');
    expect(prepKit.companyName).toBe('Canonical');
    expect(prepKit.technicalQuestions.length).toBe(2);

    const goQuestion = prepKit.technicalQuestions.find((q) => q.question.includes('Go'));
    expect(goQuestion).toBeDefined();
    expect(goQuestion?.relevanceRationale).toContain('Canonical');
    expect(goQuestion?.talkingPoints.some((tp) => tp.includes('Raft consensus engine in Go'))).toBe(true);
  });

  it('generates structured STAR stories grounded in verified work experiences', () => {
    const prepKit = generateInterviewPrepKit(job, profile, evidenceGraph);

    expect(prepKit.behavioralQuestions.length).toBe(1);
    const bq = prepKit.behavioralQuestions[0]!;
    expect(bq.question).toContain('CloudStream Systems');

    const star = bq.starStory;
    expect(star).toBeDefined();
    expect(star?.situation).toContain('CloudStream Systems');
    expect(star?.task).toContain('optimizing and architecting');
    expect(star?.action).toContain('Architected Raft consensus engine');
    expect(star?.verifiedEvidenceIds).toContain(ev1.id);
  });

  it('includes reverse interview questions tailored to company and ecosystem', () => {
    const culture = {
      companyName: 'Canonical',
      missionStatement: 'Make open source software accessible',
      coreValues: ['Open Source', 'Autonomous Ownership'],
      engineeringPrinciples: ['Distributed Systems & Reliability'],
      productEcosystem: ['Ubuntu', 'MicroK8s'],
      detectedAt: '2026-09-29T00:00:00Z',
    };

    const prepKit = generateInterviewPrepKit(job, profile, evidenceGraph, { culture });

    expect(prepKit.questionsToAskInterviewer.length).toBeGreaterThanOrEqual(4);
    expect(prepKit.questionsToAskInterviewer.some((q) => q.includes('Ubuntu'))).toBe(true);
    expect(prepKit.culturalThemes).toContain('Open Source');
    expect(prepKit.groundingScore).toBe(100);
  });
});
