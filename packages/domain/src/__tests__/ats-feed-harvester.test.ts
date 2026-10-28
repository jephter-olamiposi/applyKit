/**
 * @fileoverview Unit tests for ATS Feed Harvester, Normalizer, and Screening Engine (SKILL.md Phase 1).
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeGreenhouseJobs,
  normalizeAshbyJobs,
  normalizeLeverJobs,
  screenSourcedOpportunities,
  DEFAULT_WATCHLIST_COMPANIES,
  type SourcedOpportunity,
} from '../job/ats-feed-harvester.js';
import { createEmptyProfile } from '../candidate/profile.js';
import { createProfileId } from '../types/ids.js';

describe('ATS Feed Harvester & Opportunity Normalizer Suite', () => {
  const sampleProfile = {
    ...createEmptyProfile(createProfileId('prof_harvester_test')),
    identity: {
      ...createEmptyProfile().identity,
      location: { city: 'Berlin', country: 'Germany' },
      workAuthorization: {
        isAuthorizedInCountry: true,
        requiresSponsorship: false,
        authorizedCountries: ['Germany', 'European Union'],
      },
    },
    professional: {
      ...createEmptyProfile().professional,
      primaryRoles: ['Backend Engineer'],
      targetRoles: ['Senior Backend Engineer', 'Staff Software Engineer'],
      workplacePreference: 'remote' as const,
    },
    skills: [
      {
        id: 's1' as any,
        name: 'Go',
        normalizedName: 'go',
        category: 'language' as const,
        proficiency: 'expert' as const,
        evidenceRefs: [],
      },
      {
        id: 's2' as any,
        name: 'PostgreSQL',
        normalizedName: 'postgresql',
        category: 'database' as const,
        proficiency: 'advanced' as const,
        evidenceRefs: [],
      },
    ],
  };

  it('normalizes Greenhouse public job board responses', () => {
    const rawGreenhouse = {
      jobs: [
        {
          id: 101,
          title: 'Senior Backend Engineer - Core Infrastructure',
          absolute_url: 'https://boards.greenhouse.io/stripe/jobs/101',
          location: { name: 'Remote, Europe' },
          updated_at: '2026-09-20T10:00:00Z',
          departments: [{ name: 'Engineering' }],
          content: '<p>Looking for a Senior Backend Engineer proficient in Go and distributed systems.</p>',
        },
      ],
    };

    const normalized = normalizeGreenhouseJobs(rawGreenhouse, 'Stripe');
    expect(normalized.length).toBe(1);
    expect(normalized[0]?.id).toBe('gh_101');
    expect(normalized[0]?.employer).toBe('Stripe');
    expect(normalized[0]?.title).toBe('Senior Backend Engineer - Core Infrastructure');
    expect(normalized[0]?.sourcePlatform).toBe('greenhouse');
    expect(normalized[0]?.locationText).toBe('Remote, Europe');
    expect(normalized[0]?.descriptionSnippet).toContain('Senior Backend Engineer proficient in Go');
  });

  it('normalizes Ashby public job board responses with compensation', () => {
    const rawAshby = {
      jobs: [
        {
          id: 'ashby_uuid_99',
          title: 'Staff Software Engineer',
          jobUrl: 'https://jobs.ashbyhq.com/linear/ashby_uuid_99',
          location: 'Remote',
          publishedAt: '2026-09-22T12:00:00Z',
          department: 'Core Product',
          compensation: { compensationTierSummary: '$180,000 - $220,000 USD' },
          descriptionPlain: 'Build high-performance collaboration engines in TypeScript and Rust.',
        },
      ],
    };

    const normalized = normalizeAshbyJobs(rawAshby, 'Linear', 'linear');
    expect(normalized.length).toBe(1);
    expect(normalized[0]?.id).toBe('ashby_ashby_uuid_99');
    expect(normalized[0]?.employer).toBe('Linear');
    expect(normalized[0]?.title).toBe('Staff Software Engineer');
    expect(normalized[0]?.compensationText).toBe('$180,000 - $220,000 USD');
    expect(normalized[0]?.sourcePlatform).toBe('ashby');
  });

  it('normalizes Lever public job board responses', () => {
    const rawLever = [
      {
        id: 'lever_id_55',
        text: 'Backend Infrastructure Engineer',
        hostedUrl: 'https://jobs.lever.co/anthropic/lever_id_55',
        categories: { location: 'Remote - Germany', department: 'Platform' },
        salaryDescription: '€110,000 - €140,000',
        createdAt: 1726000000000,
        descriptionPlain: 'Scale core model inference gateways.',
      },
    ];

    const normalized = normalizeLeverJobs(rawLever, 'Anthropic');
    expect(normalized.length).toBe(1);
    expect(normalized[0]?.id).toBe('lever_lever_id_55');
    expect(normalized[0]?.employer).toBe('Anthropic');
    expect(normalized[0]?.title).toBe('Backend Infrastructure Engineer');
    expect(normalized[0]?.locationText).toBe('Remote - Germany');
    expect(normalized[0]?.compensationText).toBe('€110,000 - €140,000');
    expect(normalized[0]?.sourcePlatform).toBe('lever');
  });

  it('screens opportunities through 5-gate qualification and partitions into EV tiers', () => {
    const opportunities: SourcedOpportunity[] = [
      {
        id: 'opp_1',
        employer: 'Stripe',
        title: 'Senior Backend Engineer',
        url: 'https://example.com/stripe/1',
        locationText: 'Remote - Germany',
        descriptionSnippet: 'Requires production experience with Go and PostgreSQL.',
        sourcePlatform: 'greenhouse',
        workplaceType: 'remote',
        employmentType: 'full_time',
      },
      {
        id: 'opp_2',
        employer: 'US Only Corp',
        title: 'Senior Backend Engineer',
        url: 'https://example.com/us/2',
        locationText: 'Remote, US Only',
        descriptionSnippet: 'Must be based in United States. Unable to hire outside US.',
        sourcePlatform: 'greenhouse',
        workplaceType: 'remote',
        employmentType: 'full_time',
      },
    ];

    const screened = screenSourcedOpportunities(opportunities, sampleProfile);

    expect(screened.length).toBe(2);

    // Opp 1 should pass (Germany authorized, Go & Postgres match)
    const passedOpp = screened.find((o) => o.id === 'opp_1');
    expect(passedOpp?.verdict).toBe('OPEN');
    expect(passedOpp?.tier).toBe('tier1_high_ev');
    expect((passedOpp?.matchScore || 0) >= 80).toBe(true);

    // Opp 2 should be blocked by geography gate
    const blockedOpp = screened.find((o) => o.id === 'opp_2');
    expect(blockedOpp?.verdict).toBe('BLOCKED');
    expect(blockedOpp?.fatalGate).toBe('geography');
    expect(blockedOpp?.tier).toBe('tier4_low_or_blocked');
    expect(blockedOpp?.verbatimEvidence).toContain('US Only');
  });

  it('keeps unknown workplace or employment data as conditional results', () => {
    const unknown = [{
      id: 'unknown_1',
      employer: 'Unknown Corp',
      title: 'Backend Engineer',
      url: 'https://example.com/unknown/1',
      locationText: 'Distributed',
      descriptionSnippet: 'Build backend systems.',
      sourcePlatform: 'greenhouse' as const,
    }];

    const screened = screenSourcedOpportunities(unknown, sampleProfile);

    expect(screened).toHaveLength(1);
    expect(screened[0]?.verdict).toBe('CONDITIONAL');
    expect(screened[0]?.tier).toBe('tier3_conditional');
  });

  it('exports a rich default watchlist of tech companies', () => {
    expect(DEFAULT_WATCHLIST_COMPANIES.length).toBeGreaterThan(15);
    expect(DEFAULT_WATCHLIST_COMPANIES.some((c) => c.slug === 'linear' && c.platform === 'ashby')).toBe(true);
    expect(DEFAULT_WATCHLIST_COMPANIES.some((c) => c.slug === 'stripe' && c.platform === 'greenhouse')).toBe(true);
  });
});
