/**
 * @fileoverview Unit test suite for ATS Search Engine Dorks & Direct Endpoint Sourcing Generator.
 *
 * Verifies:
 * 1. Proper formatting of high-yield platform dorks (Ashby, Greenhouse, Lever, Workable, SmartRecruiters).
 * 2. Freshness date windowing (after:YYYY-MM-DD).
 * 3. Candidate role and tech stack keyword injection into boolean search queries.
 * 4. Direct unauthenticated ATS API endpoint resolution and validation.
 */

import { describe, it, expect } from 'vitest';
import {
  generateAtsSearchDorks,
  buildDirectAtsApiUrl,
  DIRECT_ATS_REGISTRY,
} from '../job/sourcing-dork-generator.js';
import { createEmptyProfile } from '../candidate/profile.js';
import { createProfileId } from '../types/ids.js';

describe('ATS Sourcing Dork Generator Suite (Phase 1: Sourcing)', () => {
  const sampleProfile = {
    ...createEmptyProfile(createProfileId('prof_sourcing_test')),
    identity: {
      legalFirstName: 'Jane',
      legalLastName: 'Doe',
      email: 'jane@example.com',
      phone: '+49 123 45678',
      location: { city: 'Berlin', country: 'Germany' },
      workAuthorization: { isAuthorizedInCountry: true, requiresSponsorship: false, authorizedCountries: ['Germany'] },
    },
    professional: {
      headline: 'Senior Distributed Systems Engineer',
      summary: 'Passionate about high-throughput Go and Rust systems.',
      currentTitle: 'Senior Distributed Systems Engineer',
      totalYearsOfExperience: 8,
      primaryRoles: ['Backend Engineer'],
      targetRoles: ['Staff Distributed Systems Engineer', 'Senior Infrastructure Engineer'],
      preferredLocations: ['Remote'],
      workplacePreference: 'remote' as const,
      isOpenToRelocation: false,
    },
    skills: [
      { id: 's1' as any, name: 'Go', normalizedName: 'go', category: 'language' as const, proficiency: 'expert' as const, verified: true, evidenceRefs: [] },
      { id: 's2' as any, name: 'Rust', normalizedName: 'rust', category: 'language' as const, proficiency: 'expert' as const, verified: true, evidenceRefs: [] },
      { id: 's3' as any, name: 'Kubernetes', normalizedName: 'kubernetes', category: 'cloud_infrastructure' as const, proficiency: 'advanced' as const, verified: true, evidenceRefs: [] },
    ],
  };

  it('generates a full suite of platform-specific dorks with candidate roles and technologies', () => {
    const dorks = generateAtsSearchDorks(sampleProfile, { freshnessDays: 14 });

    expect(dorks.length).toBeGreaterThanOrEqual(7);

    // 1. Ashby Dork
    const ashby = dorks.find((d) => d.category === 'ashby');
    expect(ashby).toBeDefined();
    expect(ashby!.query).toContain('site:jobs.ashbyhq.com');
    expect(ashby!.query).toContain('"Staff Distributed Systems Engineer"');
    expect(ashby!.query).toContain('"work from anywhere"');
    expect(ashby!.query).toMatch(/after:\d{4}-\d{2}-\d{2}/);
    expect(ashby!.searchUrl).toContain('google.com/search?q=');

    // 2. Greenhouse Dork
    const greenhouse = dorks.find((d) => d.category === 'greenhouse');
    expect(greenhouse).toBeDefined();
    expect(greenhouse!.query).toContain('site:job-boards.greenhouse.io');
    expect(greenhouse!.query).toContain('"Go"');
    expect(greenhouse!.query).toContain('"Rust"');

    // 3. Lever Dork
    const lever = dorks.find((d) => d.category === 'lever');
    expect(lever).toBeDefined();
    expect(lever!.query).toContain('site:jobs.lever.co');
    expect(lever!.query).toContain('"any timezone"');

    // 4. Independent Career Pages Dork
    const independent = dorks.find((d) => d.category === 'independent_careers');
    expect(independent).toBeDefined();
    expect(independent!.query).toContain('inurl:careers');
    expect(independent!.query).toContain('-linkedin');
    expect(independent!.query).toContain('-indeed');
    expect(independent!.query).toContain('-glassdoor');
  });

  it('respects custom override options for roleFamilies and techStack', () => {
    const dorks = generateAtsSearchDorks(sampleProfile, {
      roleFamilies: ['Lead Platform Architect'],
      techStack: ['Python', 'AWS'],
      freshnessDays: 7,
    });

    const ashby = dorks.find((d) => d.category === 'ashby')!;
    expect(ashby.query).toContain('"Lead Platform Architect"');

    const greenhouse = dorks.find((d) => d.category === 'greenhouse')!;
    expect(greenhouse.query).toContain('"Python"');
    expect(greenhouse.query).toContain('"AWS"');
  });

  it('builds direct unauthenticated ATS API endpoint URLs', () => {
    // Greenhouse
    const ghUrl = buildDirectAtsApiUrl('greenhouse', 'stripe');
    expect(ghUrl).toBe('https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=true');

    // Ashby
    const ashbyUrl = buildDirectAtsApiUrl('ashby', 'linear');
    expect(ashbyUrl).toBe('https://api.ashbyhq.com/posting-api/job-board/linear?includeCompensation=true');

    // Lever
    const leverUrl = buildDirectAtsApiUrl('lever', 'figma');
    expect(leverUrl).toBe('https://api.lever.co/v0/postings/figma?mode=json');

    // Workable
    const workableUrl = buildDirectAtsApiUrl('workable', 'monzo');
    expect(workableUrl).toBe('https://apply.workable.com/api/v1/widget/accounts/monzo?details=true');

    // SmartRecruiters
    const srUrl = buildDirectAtsApiUrl('smartrecruiters', 'spotify');
    expect(srUrl).toBe('https://api.smartrecruiters.com/v1/companies/spotify/postings');

    // Recruitee
    const recruiteeUrl = buildDirectAtsApiUrl('recruitee', 'bunq');
    expect(recruiteeUrl).toBe('https://bunq.recruitee.com/api/offers/');
  });

  it('maintains valid registry entries for all 10 major ATS platforms', () => {
    expect(DIRECT_ATS_REGISTRY.length).toBe(10);
    const platforms = DIRECT_ATS_REGISTRY.map((r) => r.platform);
    expect(platforms).toContain('greenhouse');
    expect(platforms).toContain('ashby');
    expect(platforms).toContain('lever');
    expect(platforms).toContain('workable');
    expect(platforms).toContain('smartrecruiters');
    expect(platforms).toContain('recruitee');
    expect(platforms).toContain('teamtailor');
    expect(platforms).toContain('personio');
    expect(platforms).toContain('rippling');
    expect(platforms).toContain('gem');
  });
});
