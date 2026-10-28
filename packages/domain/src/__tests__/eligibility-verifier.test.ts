import { describe, it, expect } from 'vitest';
import {
  verifyJobEligibility,
  createEmptyProfile,
  createProfileId,
  type JobPosting,
  type CandidateProfile,
} from '../index.js';

describe('5-Gate Job Eligibility Verifier Suite (SKILL.md Phase 2)', () => {
  const baseProfile: CandidateProfile = {
    ...createEmptyProfile(createProfileId('prof_verify_test')),
    identity: {
      legalFirstName: 'Joseph',
      legalLastName: 'Tsegen',
      email: 'joseph@example.com',
      phone: '+234 814 365 2101',
      location: { city: 'Lagos', country: 'Nigeria' },
      workAuthorization: {
        isAuthorizedInCountry: true,
        requiresSponsorship: true,
        authorizedCountries: ['Nigeria'],
      },
    },
    experiences: [
      {
        id: 'exp_1' as any,
        company: 'Makerverse',
        title: 'Senior Backend Engineer',
        employmentType: 'full_time',
        location: 'Remote',
        isRemote: true,
        startDate: '2022-01-01',
        endDate: '2024-07-01',
        isCurrent: false,
        description: '',
        highlights: [],
        technologiesUsed: ['TypeScript', 'Node.js'],
        evidenceRefs: [],
      },
      {
        id: 'exp_2' as any,
        company: 'Rocksteady Technologies',
        title: 'Senior Software Engineer',
        employmentType: 'full_time',
        location: 'Remote',
        isRemote: true,
        startDate: '2024-07-01',
        endDate: '2026-02-01',
        isCurrent: false,
        description: '',
        highlights: [],
        technologiesUsed: ['TypeScript', 'AWS'],
        evidenceRefs: [],
      },
    ],
  };

  const createMockJob = (description: string, location: string = 'Remote'): JobPosting => ({
    id: 'job_test_1' as any,
    url: 'https://example.com/careers/backend',
    title: 'Senior Backend Engineer',
    companyName: 'Acme Global',
    location,
    workplaceType: 'remote',
    employmentType: 'full_time',
    rawDescription: description,
    requirements: [],
    metadata: {},
    parsedAt: new Date().toISOString(),
  });

  describe('Gate 1: Geography', () => {
    it('blocks roles with strict US-only residency requirements and captures verbatim quote', () => {
      const job = createMockJob(
        'We are building global cloud infrastructure. Please note: You must be based in the US only. All employees work remotely.'
      );

      const report = verifyJobEligibility(job, baseProfile);

      expect(report.verdict).toBe('BLOCKED');
      expect(report.fatalGate).toBe('geography');
      expect(report.verbatimEvidence).toContain('must be based in the US only');
    });

    it('passes roles open worldwide or without geographic residency gates', () => {
      const job = createMockJob(
        'We are a fully remote distributed team. We hire engineers globally across all continents.'
      );

      const report = verifyJobEligibility(job, baseProfile);

      expect(report.fatalGate).toBeUndefined();
      expect(report.checks.find((c) => c.gate === 'geography')?.status).toBe('passed');
    });

    it('blocks an explicit country restriction when the candidate is outside the listed country', () => {
      const job = createMockJob('Must be based in Germany. This is a remote role.');

      const report = verifyJobEligibility(job, baseProfile);

      expect(report.verdict).toBe('BLOCKED');
      expect(report.fatalGate).toBe('geography');
      expect(report.verbatimEvidence).toContain('Must be based in Germany');
    });

    it('flags perk trap: "Work from anywhere 30 days a year" as CONDITIONAL', () => {
      const job = createMockJob(
        'We offer flexible perks. Enjoy our policy: work from anywhere 30 days a year while based in our hub.'
      );

      const report = verifyJobEligibility(job, baseProfile);

      expect(report.verdict).toBe('CONDITIONAL');
      const geoCheck = report.checks.find((c) => c.gate === 'geography');
      expect(geoCheck?.status).toBe('conditional');
      expect(geoCheck?.reason).toContain('not a remote role');
    });
  });

  describe('Gate 1: Geography from real location fields (captured 2026-10-24)', () => {
    const geo = (description: string, location: string) =>
      verifyJobEligibility(createMockJob(description, location), baseProfile).checks.find((c) => c.gate === 'geography')!;

    it('blocks "Remote within Canada or United States" for a candidate in Nigeria', () => {
      const check = geo('Banking for startups.', 'San Francisco, CA, New York, NY, Portland, OR, or Remote within Canada or United States');
      expect(check.status).toBe('blocked');
      expect(check.verbatimQuote).toContain('Remote within Canada or United States');
      expect(check.reason).toContain('Nigeria');
    });

    it('marks a UK-only role as check-first when the posting offers relocation', () => {
      const check = geo(
        "We can help you relocate to the UK. We're open to distributed working within the UK.",
        'Cardiff, London or Remote (UK)'
      );
      expect(check.status).toBe('conditional');
      expect(check.verbatimQuote).toContain('relocate');
    });

    it('blocks a UK-only role that offers no relocation', () => {
      expect(geo('Build payments.', 'Remote (UK)').status).toBe('blocked');
    });

    it('passes regional remote roles that include the candidate', () => {
      expect(geo('Build things.', 'Remote (EMEA)').status).toBe('passed');
      expect(geo('Build things.', 'Remote, Global').status).toBe('passed');
      expect(geo('Build things.', 'Remote').status).toBe('passed');
    });

    it('lets an explicit "anywhere" outrank an office address', () => {
      expect(geo('Our HQ is in Berlin, but you can work from anywhere in the world.', 'Berlin').status).toBe('passed');
    });

    it('does not read ordinary words as places', () => {
      expect(geo('Join us and help us grow. Tell us about your work.', 'Remote').status).toBe('passed');
    });
  });

  describe('Gate 2: Work Authorization', () => {
    it('blocks roles disclaiming visa sponsorship when candidate requires sponsorship', () => {
      const job = createMockJob(
        'Exciting backend role. At this time, we are unable to sponsor visa candidates. Candidates must have right to work.'
      );

      const report = verifyJobEligibility(job, baseProfile);

      expect(report.verdict).toBe('BLOCKED');
      expect(report.fatalGate).toBe('work_authorization');
      expect(report.verbatimEvidence).toContain('unable to sponsor visa candidates');
    });

    it('passes authorization check when candidate does not require sponsorship', () => {
      const noSponsorshipProfile: CandidateProfile = {
        ...baseProfile,
        identity: {
          ...baseProfile.identity,
          workAuthorization: {
            isAuthorizedInCountry: true,
            requiresSponsorship: false,
            authorizedCountries: ['USA', 'Nigeria'],
          },
        },
      };

      const job = createMockJob('We cannot sponsor work visas.');
      const report = verifyJobEligibility(job, noSponsorshipProfile);

      expect(report.fatalGate).not.toBe('work_authorization');
    });

    it('marks roles requiring citizenship or clearance as conditional when facts are missing', () => {
      const job = createMockJob(
        'Defense platform engineering. Must be a U.S. citizen with active secret clearance.'
      );

      const report = verifyJobEligibility(job, baseProfile);

      expect(report.verdict).toBe('CONDITIONAL');
      expect(report.fatalGate).toBeUndefined();
      expect(report.verbatimEvidence).toContain('Must be a U.S. citizen');
    });
  });

  describe('Gate 4: Timezone', () => {
    it('marks roles with strict core hour requirements as CONDITIONAL', () => {
      const job = createMockJob(
        'We operate asynchronously, but working hours are 9am to 2pm EST for team standups and syncs.'
      );

      const report = verifyJobEligibility(job, baseProfile);

      expect(report.verdict).toBe('CONDITIONAL');
      const tzCheck = report.checks.find((c) => c.gate === 'timezone');
      expect(tzCheck?.status).toBe('conditional');
      expect(tzCheck?.verbatimQuote).toContain('working hours are 9am to 2pm EST');
    });
  });

  describe('Gate 5: Requirements (Hard Minimum Tenure)', () => {
    it('blocks roles when hard minimum experience strictly exceeds candidate verified tenure', () => {
      // Base profile has ~4 years experience (2022-2026)
      const job = createMockJob(
        'Senior Lead Architect. Minimum of 10+ years of professional engineering experience required.'
      );

      const report = verifyJobEligibility(job, baseProfile);

      expect(report.verdict).toBe('BLOCKED');
      expect(report.fatalGate).toBe('requirements');
      expect(report.verbatimEvidence).toContain('Minimum of 10+ years');
    });

    it('passes requirements check when candidate tenure meets minimum', () => {
      const job = createMockJob(
        'Software Engineer. Requires at least 3+ years of commercial software experience.'
      );

      const report = verifyJobEligibility(job, baseProfile);

      expect(report.fatalGate).not.toBe('requirements');
    });
  });

  describe('Overall Verdict Resolution', () => {
    it('returns OPEN when all gates pass with zero blockers', () => {
      const job = createMockJob(
        'Global remote team building developer tools. We hire anywhere in the world and collaborate asynchronously.'
      );

      const report = verifyJobEligibility(job, baseProfile);

      expect(report.verdict).toBe('OPEN');
      expect(report.fatalGate).toBeUndefined();
      expect(report.checks.every((c) => c.status === 'passed')).toBe(true);
    });
  });
});
