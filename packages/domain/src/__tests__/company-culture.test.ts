/**
 * @fileoverview Test suite for Targeted Company Mission & Cultural Alignment Engine (Phase 21, ADR-0033).
 *
 * Verifies extraction of company values, mission statements, and product ecosystems,
 * correlation with CandidateProfile & EvidenceGraph, and synthesis of authentic 'Why Us?' pitches.
 */

import { describe, it, expect } from 'vitest';
import {
  extractCompanyCulture,
  evaluateCompanyCultureAlignment,
  type CompanyCultureProfile,
} from '../job/company-culture.js';
import {
  createEmptyProfile,
  createProfileId,
  buildEvidenceGraph,
  createEvidenceId,
  createClaimId,
  createSkillId,
  createExperienceId,
  createJobPostingId,
  createRequirementId,
  type JobPosting,
  type CandidateProfile,
} from '../index.js';
import { generateGroundedCoverLetter } from '../tailoring/cover-letter-generator.js';

describe('Targeted Company Mission & Cultural Alignment Engine (Phase 21, ADR-0033)', () => {
  const canonicalPostingText = `
    About Canonical:
    Our mission is to bring the best of open source to the world at scale.
    Canonical is the company behind Ubuntu, MicroK8s, and LXD. We are a globally distributed,
    remote-first team committed to autonomous ownership, transparency, and operational excellence.

    Role: Distributed Systems Engineer
    We are looking for engineers with deep experience in high availability, fault-tolerant consensus,
    and Linux systems to design next-generation container orchestration infrastructure.
  `;

  describe('extractCompanyCulture', () => {
    it('extracts mission statement, core values, and product ecosystem from Canonical posting', () => {
      const culture = extractCompanyCulture(canonicalPostingText, 'Canonical');

      expect(culture.companyName).toBe('Canonical');
      expect(culture.missionStatement).toContain('open source to the world at scale');
      expect(culture.coreValues).toContain('Open Source & Transparency');
      expect(culture.coreValues).toContain('Autonomous Ownership');
      expect(culture.engineeringPrinciples).toContain('Distributed Systems & Reliability');
      expect(culture.engineeringPrinciples).toContain('Operational Excellence & Rigor');
      expect(culture.productEcosystem).toContain('Ubuntu');
      expect(culture.productEcosystem).toContain('MicroK8s');
      expect(culture.productEcosystem).toContain('LXD');
      expect(culture.productEcosystem).toContain('Linux');
    });

    it('provides sensible fallback values for minimal or unstructured job postings', () => {
      const minimalText = 'Software developer needed. Will write code and attend meetings.';
      const culture = extractCompanyCulture(minimalText, 'Acme Corp');

      expect(culture.companyName).toBe('Acme Corp');
      expect(culture.coreValues.length).toBeGreaterThan(0);
      expect(culture.engineeringPrinciples.length).toBeGreaterThan(0);
      expect(culture.coreValues[0]).toBe('Technical Craftsmanship & Execution');
    });
  });

  describe('evaluateCompanyCultureAlignment', () => {
    const profile: CandidateProfile = {
      ...createEmptyProfile(createProfileId('prof_engineer')),
      identity: {
        legalFirstName: 'Morgan',
        legalLastName: 'Reed',
        preferredName: 'Morgan',
        email: 'morgan.reed@example.com',
        phone: '+1-555-0199',
        location: { country: 'United States', city: 'Seattle' },
        workAuthorization: { isAuthorizedInCountry: true, requiresSponsorship: false, authorizedCountries: ['United States'] },
        demographics: {},
      },
      links: {
        github: 'https://github.com/mreed',
        linkedin: 'https://linkedin.com/in/mreed',
        customLinks: [],
      },
      skills: [
        {
          id: createSkillId('sk_1'),
          name: 'Distributed Systems',
          normalizedName: 'distributed systems',
          category: 'architecture_pattern',
          proficiency: 'expert',
          yearsOfExperience: 6,
          evidenceRefs: [],
        },
        {
          id: createSkillId('sk_2'),
          name: 'Go',
          normalizedName: 'go',
          category: 'language',
          proficiency: 'expert',
          yearsOfExperience: 5,
          evidenceRefs: [],
        },
      ],
      experiences: [
        {
          id: createExperienceId('exp_1'),
          company: 'Cloud Scale Inc',
          title: 'Senior Distributed Systems Engineer',
          employmentType: 'full_time',
          location: 'Remote',
          isRemote: true,
          startDate: '2021-01',
          isCurrent: true,
          description: 'Distributed systems engineering',
          technologiesUsed: ['Go', 'Kubernetes'],
          evidenceRefs: [],
          highlights: [
            'Architected distributed fault-tolerant Raft consensus cluster maintaining 99.99% availability.',
            'Active open source contributor to upstream Kubernetes controllers on GitHub.',
            'Spearheaded autonomous end-to-end telemetry pipeline serving 10M daily events.',
          ],
        },
      ],
    };

    const ev1 = {
      id: createEvidenceId('ev_raft'),
      source: { type: 'resume_bullet' as const, sourceId: 'exp_1' },
      description: 'Distributed systems experience',
      textSnippet: 'Architected distributed fault-tolerant Raft consensus cluster maintaining 99.99% availability.',
      verificationStatus: 'verified' as const,
      confidenceScore: 1.0,
      createdAt: '2026-09-28T00:00:00Z',
      tags: ['distributed systems', 'raft'],
    };
    const ev2 = {
      id: createEvidenceId('ev_oss'),
      source: { type: 'git_repository' as const, sourceId: 'repo_k8s' },
      description: 'Open source contributions',
      textSnippet: 'Active open source contributor to upstream Kubernetes controllers on GitHub.',
      verificationStatus: 'verified' as const,
      confidenceScore: 1.0,
      createdAt: '2026-09-28T00:00:00Z',
      tags: ['open source', 'kubernetes'],
    };
    const graph = buildEvidenceGraph([ev1, ev2], []);

    it('correlates candidate verified achievements with company core values', () => {
      const culture = extractCompanyCulture(canonicalPostingText, 'Canonical');
      const alignment = evaluateCompanyCultureAlignment(culture, profile, graph);

      expect(alignment.companyName).toBe('Canonical');
      expect(alignment.score).toBeGreaterThanOrEqual(0.6);
      expect(alignment.matches.length).toBeGreaterThanOrEqual(2);

      // Verify open source alignment match
      const ossMatch = alignment.matches.find((m) => m.companyValue.includes('Open Source'));
      expect(ossMatch).toBeDefined();
      expect(ossMatch?.candidateEvidenceSnippet).toContain('open source contributor');

      // Verify distributed systems alignment match
      const distMatch = alignment.matches.find((m) => m.companyValue.includes('Distributed Systems'));
      expect(distMatch).toBeDefined();
      expect(distMatch?.candidateEvidenceSnippet).toContain('Raft consensus cluster');

      // Verify synthesized 'Why Us?' pitch is grounded in authentic evidence
      expect(alignment.whyUsPitch).toContain('Canonical');
      expect(alignment.whyUsPitch).toContain('Ubuntu');
      expect(alignment.whyUsPitch).not.toContain('undefined');
    });

    it('integrates cultural alignment seamlessly into cover letter generation', () => {
      const culture = extractCompanyCulture(canonicalPostingText, 'Canonical');
      const alignment = evaluateCompanyCultureAlignment(culture, profile, graph);

      const job: JobPosting = {
        id: createJobPostingId('job_canonical_1'),
        url: 'https://canonical.com/careers/4581200',
        title: 'Distributed Systems Engineer',
        companyName: 'Canonical',
        location: 'Remote, EMEA',
        workplaceType: 'remote',
        employmentType: 'full_time',
        rawDescription: canonicalPostingText,
        parsedAt: '2026-09-28T12:00:00Z',
        requirements: [
          {
            id: createRequirementId('req_1'),
            rawText: 'Strong experience in Distributed Systems',
            category: 'technical_skill',
            importance: 'required',
            normalizedSkillOrCompetency: 'Distributed Systems',
            yearsRequired: 4,
            isRequired: true,
            matchedEvidenceIds: [],
          },
        ],
        metadata: {},
      };

      const letter = generateGroundedCoverLetter(job, profile, graph, {
        cultureAlignment: alignment,
      });

      expect(letter.bodyParagraphs.length).toBeGreaterThanOrEqual(1);
      const missionPara = letter.bodyParagraphs.find((p) => p.theme.includes('Organizational Alignment'));
      expect(missionPara).toBeDefined();
      expect(missionPara?.paragraphText).toContain('Canonical');
      expect(missionPara?.paragraphText).toContain(alignment.whyUsPitch);
      expect(missionPara?.citedAccomplishments.length).toBeGreaterThan(0);
    });
  });
});
