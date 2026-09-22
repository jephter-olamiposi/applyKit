/**
 * @fileoverview Unit and integration tests for Tailoring Engine & Fact-Checking Flow (Phase 12).
 *
 * Verifies:
 * 1. Resume tailoring integration: experiences and projects ranked by job criteria alignment.
 * 2. Evidence-grounded cover letter generation citing verified EvidenceGraph nodes.
 * 3. Fact-checking verification pass flagging unbacked claims and hallucinated metrics.
 * 4. Clean Markdown and plain-text export formatting for ATS submissions.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import {
  createProfileId,
  createJobPostingId,
  createExperienceId,
  createSkillId,
  createEvidenceId,
  createRequirementId,
  normalizeSkillName,
  createEmptyProfile,
  buildEvidenceGraph,
  tailorCandidateResume,
  generateGroundedCoverLetter,
  factCheckTailoredDocument,
  exportResumeAsMarkdown,
  exportCoverLetterAsMarkdown,
  type CandidateProfile,
  type JobPosting,
  type Evidence,
} from '@applykit/domain';
import {
  IndexedDbProfileRepository,
  IndexedDbJobRepository,
  IndexedDbEvidenceRepository,
  deleteDatabase,
} from '../storage/index.js';

describe('Evidence-Grounded Tailoring & Fact-Checking Flow (Phase 12)', () => {
  let profileRepo: IndexedDbProfileRepository;
  let jobRepo: IndexedDbJobRepository;
  let evidenceRepo: IndexedDbEvidenceRepository;

  const sampleJob: JobPosting = {
    id: createJobPostingId('job_stripe_staff'),
    url: 'https://stripe.com/jobs/staff-engineer',
    title: 'Staff Platform Engineer',
    companyName: 'Stripe',
    location: 'San Francisco, CA',
    workplaceType: 'hybrid',
    employmentType: 'full_time',
    parsedAt: '2026-03-20T10:00:00Z',
    rawDescription: 'Scale globally distributed payments infrastructure using Go and Kubernetes.',
    metadata: {},
    requirements: [
      {
        id: createRequirementId('req_go'),
        rawText: 'Expert in Go (Golang) distributed systems',
        normalizedSkillOrCompetency: 'go',
        category: 'technical_skill',
        importance: 'required',
        isRequired: true,
        matchedEvidenceIds: [],
      },
      {
        id: createRequirementId('req_k8s'),
        rawText: 'Production Kubernetes cluster operations at scale',
        normalizedSkillOrCompetency: 'kubernetes',
        category: 'technical_skill',
        importance: 'required',
        isRequired: true,
        matchedEvidenceIds: [],
      },
    ],
  };

  const exp1Id = createExperienceId('exp_stripe_match');
  const ev1Id = createEvidenceId('ev_go_perf');

  const sampleProfile: CandidateProfile = {
    ...createEmptyProfile(createProfileId('prof_jesse')),
    identity: {
      legalFirstName: 'Jesse',
      legalLastName: 'Pinkman',
      email: 'jesse@example.com',
      phone: '+1 555-0155',
      location: { city: 'San Francisco', stateOrProvince: 'CA', country: 'USA' },
      workAuthorization: { isAuthorizedInCountry: true, requiresSponsorship: false, authorizedCountries: ['USA'] },
    },
    professional: {
      headline: 'Senior Infrastructure Engineer',
      summary: 'Distributed systems engineer focused on high availability.',
      currentTitle: 'Senior Infrastructure Engineer',
      totalYearsOfExperience: 7,
      primaryRoles: ['Platform Engineer'],
      targetRoles: ['Staff Platform Engineer'],
      preferredLocations: ['San Francisco, CA'],
      workplacePreference: 'hybrid',
      isOpenToRelocation: false,
    },
    skills: [
      { id: createSkillId(), name: 'Go', normalizedName: normalizeSkillName('Go'), category: 'language', proficiency: 'expert', yearsOfExperience: 6, evidenceRefs: [] },
      { id: createSkillId(), name: 'Kubernetes', normalizedName: normalizeSkillName('Kubernetes'), category: 'cloud_infrastructure', proficiency: 'expert', yearsOfExperience: 5, evidenceRefs: [] },
      { id: createSkillId(), name: 'PostgreSQL', normalizedName: normalizeSkillName('PostgreSQL'), category: 'database', proficiency: 'advanced', yearsOfExperience: 4, evidenceRefs: [] },
    ],
    experiences: [
      {
        id: exp1Id,
        company: 'Fintech Cloud Corp',
        title: 'Senior Infrastructure Engineer',
        employmentType: 'full_time',
        location: 'San Francisco, CA',
        isRemote: false,
        startDate: '2020-03',
        isCurrent: true,
        description: 'Engineered payment processing services.',
        highlights: [
          'Engineered low-latency Go payment gateway handling 25,000 transactions/sec with p99 latency < 15ms.',
          'Managed 50-node production Kubernetes cluster across 3 AWS regions.',
        ],
        technologiesUsed: ['Go', 'Kubernetes', 'AWS'],
        evidenceRefs: [ev1Id],
      },
    ],
    projects: [],
  };

  const sampleEvidence: Evidence[] = [
    {
      id: ev1Id,
      source: {
        type: 'resume_bullet',
        sourceId: exp1Id,
        metadata: { company: 'Fintech Cloud Corp', title: 'Senior Infrastructure Engineer', bulletIndex: '0' },
      },
      description: 'Senior Infrastructure Engineer at Fintech Cloud Corp: Engineered low-latency Go payment gateway handling 25,000 transactions/sec with p99 latency < 15ms.',
      textSnippet: 'Engineered low-latency Go payment gateway handling 25,000 transactions/sec with p99 latency < 15ms.',
      verificationStatus: 'verified',
      confidenceScore: 0.95,
      createdAt: '2026-03-20T10:00:00Z',
      tags: ['Go', 'Fintech'],
    },
  ];

  beforeEach(async () => {
    await deleteDatabase(indexedDB);
    profileRepo = new IndexedDbProfileRepository(indexedDB);
    jobRepo = new IndexedDbJobRepository(indexedDB);
    evidenceRepo = new IndexedDbEvidenceRepository(indexedDB);

    await profileRepo.saveProfile(sampleProfile);
    await jobRepo.saveJob(sampleJob);
    await evidenceRepo.saveEvidenceBatch(sampleEvidence);
  });

  afterEach(() => {
    profileRepo.close();
    jobRepo.close();
    evidenceRepo.close();
  });

  it('persists profile, job, and evidence and produces tailored resume', async () => {
    const loadedProfile = await profileRepo.getProfile();
    const loadedJob = await jobRepo.getJobById(sampleJob.id);
    const loadedEvidence = await evidenceRepo.listEvidence();
    const graph = buildEvidenceGraph(loadedEvidence, []);

    expect(loadedProfile).toBeDefined();
    expect(loadedJob).toBeDefined();

    const tailored = tailorCandidateResume(loadedJob!, loadedProfile!, graph);

    expect(tailored.targetJobTitle).toBe('Staff Platform Engineer');
    expect(tailored.companyName).toBe('Stripe');
    expect(tailored.skills.matchedRequired).toContain('Go');
    expect(tailored.skills.matchedRequired).toContain('Kubernetes');
    expect(tailored.experiences[0]!.rankedHighlights[0]!.sourceEvidenceId).toBe(ev1Id);
    expect(tailored.tailoredSummary).toContain('Go');
  });

  it('generates grounded cover letter citing verified accomplishment bullets', async () => {
    const loadedProfile = await profileRepo.getProfile();
    const loadedJob = await jobRepo.getJobById(sampleJob.id);
    const loadedEvidence = await evidenceRepo.listEvidence();
    const graph = buildEvidenceGraph(loadedEvidence, []);

    const coverLetter = generateGroundedCoverLetter(loadedJob!, loadedProfile!, graph);

    expect(coverLetter.targetJobTitle).toBe('Staff Platform Engineer');
    expect(coverLetter.companyName).toBe('Stripe');
    expect(coverLetter.allCitations.length).toBeGreaterThanOrEqual(1);
    expect(coverLetter.allCitations[0]!.evidenceId).toBe(ev1Id);
    expect(coverLetter.fullText).toContain('25,000 transactions/sec');
  });

  it('audits cover letter grounding and flags ungrounded metric additions', async () => {
    const loadedProfile = await profileRepo.getProfile();
    const loadedEvidence = await evidenceRepo.listEvidence();
    const graph = buildEvidenceGraph(loadedEvidence, []);

    // Grounded text
    const groundedText = `
      Dear Hiring Team at Stripe,
      I am writing to express my strong enthusiasm for this position.
      In my recent role, I engineered low-latency Go payment gateway handling 25,000 transactions/sec with p99 latency < 15ms.
      Thank you for your consideration.
      Sincerely,
      Jesse Pinkman
    `;
    const pristineAudit = factCheckTailoredDocument(groundedText, loadedProfile!, graph, 'cover_letter');
    expect(pristineAudit.isPristine).toBe(true);

    // Fabricated metric
    const hallucinatedText = `
      Dear Hiring Team at Stripe,
      I grew company revenues by $120M while operating a 500-node cluster with 99.999% uptime.
      Sincerely,
      Jesse Pinkman
    `;
    const flawedAudit = factCheckTailoredDocument(hallucinatedText, loadedProfile!, graph, 'cover_letter');
    expect(flawedAudit.isPristine).toBe(false);
    expect(flawedAudit.unbackedStatements.length).toBeGreaterThan(0);
    const hasCritical = flawedAudit.unbackedStatements.some((u) => u.severity === 'critical');
    expect(hasCritical).toBe(true);
  });

  it('exports documents to Markdown cleanly', async () => {
    const loadedProfile = await profileRepo.getProfile();
    const loadedJob = await jobRepo.getJobById(sampleJob.id);
    const loadedEvidence = await evidenceRepo.listEvidence();
    const graph = buildEvidenceGraph(loadedEvidence, []);

    const tailored = tailorCandidateResume(loadedJob!, loadedProfile!, graph);
    const resumeMd = exportResumeAsMarkdown(tailored, loadedProfile!);
    expect(resumeMd).toContain('# Jesse Pinkman');
    expect(resumeMd).toContain('## Professional Summary');
    expect(resumeMd).toContain('Fintech Cloud Corp');

    const coverLetter = generateGroundedCoverLetter(loadedJob!, loadedProfile!, graph);
    const letterMd = exportCoverLetterAsMarkdown(coverLetter, loadedProfile!);
    expect(letterMd).toContain('# Jesse Pinkman');
    expect(letterMd).toContain('**Application for:** Staff Platform Engineer at Stripe');
  });
});
