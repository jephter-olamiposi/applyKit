/**
 * @fileoverview Job board feed normalizers against the response shapes the public
 * Greenhouse, Ashby, and Lever APIs actually returned on 2026-10-24.
 *
 * Field names and encodings here were read off live responses: Greenhouse sends
 * `content` entity-encoded, Ashby's salary lives in `compensationTierSummary`, and
 * both Ashby and Lever state the workplace type explicitly.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeGreenhouseJobs,
  normalizeAshbyJobs,
  normalizeLeverJobs,
  decodeHtmlEntities,
  DEFAULT_WATCHLIST_COMPANIES,
} from '../index.js';

describe('decodeHtmlEntities', () => {
  it('decodes named and numeric entities and leaves unknown ones alone', () => {
    expect(decodeHtmlEntities('&lt;p&gt;Go &amp; Kafka&lt;/p&gt; &#8212; &#x2019; &nbsp;x &madeup;')).toBe(
      "<p>Go & Kafka</p> — ’  x &madeup;"
    );
  });
});

describe('normalizeGreenhouseJobs', () => {
  it('decodes encoded content before stripping it and reads the salary', () => {
    const [job] = normalizeGreenhouseJobs(
      {
        jobs: [
          {
            id: 4251150009,
            title: 'Software Engineer - Postgres',
            location: { name: 'Remote' },
            absolute_url: 'https://job-boards.greenhouse.io/example/jobs/4251150009',
            updated_at: '2026-07-30T17:11:29-04:00',
            content:
              '&lt;h3&gt;What you will need&lt;/h3&gt;&lt;ul&gt;&lt;li&gt;Strong proficiency in Go.&lt;/li&gt;&lt;/ul&gt;&lt;p&gt;&lt;strong&gt;Base salary range: $120,000 - $290,000 USD&lt;/strong&gt;&lt;/p&gt;',
          },
        ],
      },
      'Example'
    );
    expect(job!.descriptionSnippet).toBe('What you will need Strong proficiency in Go. Base salary range: $120,000 - $290,000 USD');
    expect(job!.descriptionSnippet).not.toMatch(/&lt;|<|&amp;/);
    expect(job!.workplaceType).toBe('remote');
    expect(job!.compensationText).toMatch(/120,000/);
  });
});

describe('normalizeAshbyJobs', () => {
  it('uses the explicit workplace, employment type, salary summary, and secondary locations', () => {
    const [job] = normalizeAshbyJobs(
      {
        jobs: [
          {
            id: 'abc',
            title: 'Backend Engineer',
            location: 'New York, NY (HQ)',
            secondaryLocations: [
              { location: 'Remote (Canada)', address: { postalAddress: { addressCountry: 'Canada' } } },
              { location: 'Remote (US)', address: { postalAddress: { addressCountry: 'United States' } } },
            ],
            workplaceType: 'Hybrid',
            isRemote: true,
            employmentType: 'FullTime',
            descriptionPlain: 'We build payments.',
            compensation: {
              compensationTierSummary: '$211.4K – $290.6K • Offers Equity',
              scrapeableCompensationSalarySummary: '$211.4K - $290.6K',
            },
          },
        ],
      },
      'Ramp',
      'ramp'
    );
    expect(job!.locationText).toBe('New York, NY (HQ); Remote (Canada); Remote (US)');
    expect(job!.locationText).not.toContain('[object Object]');
    expect(job!.workplaceType).toBe('hybrid');
    expect(job!.employmentType).toBe('full_time');
    expect(job!.compensationText).toBe('$211.4K – $290.6K • Offers Equity');
    expect(job!.url).toBe('https://jobs.ashbyhq.com/ramp/abc');
  });
});

describe('normalizeLeverJobs', () => {
  it('uses the explicit workplace type, all locations, commitment, and salary range', () => {
    const [job] = normalizeLeverJobs(
      [
        {
          id: 'xyz',
          text: 'Software Engineer',
          hostedUrl: 'https://jobs.lever.co/example/xyz',
          categories: { location: 'London', allLocations: ['London', 'Remote (UK)'], commitment: 'Full-time', team: 'Platform' },
          workplaceType: 'hybrid',
          descriptionPlain: 'Build the platform.',
          salaryRange: { min: 90000, max: 120000, currency: 'GBP', interval: 'per-year-salary' },
          createdAt: 1767225600000,
        },
      ],
      'Example'
    );
    expect(job!.locationText).toBe('London; Remote (UK)');
    expect(job!.workplaceType).toBe('hybrid');
    expect(job!.employmentType).toBe('full_time');
    expect(job!.compensationText).toBe('GBP 90,000 - 120,000 per year salary');
  });
});

describe('DEFAULT_WATCHLIST_COMPANIES', () => {
  it('has no duplicate boards and no companies on the wrong platform', () => {
    const keys = DEFAULT_WATCHLIST_COMPANIES.map((company) => `${company.platform}:${company.slug}`);
    expect(new Set(keys).size).toBe(keys.length);
    // These moved off the platform the old list had them on; their old entries 404'd.
    const platformOf = (name: string) => DEFAULT_WATCHLIST_COMPANIES.find((company) => company.name === name)?.platform;
    expect(platformOf('PlanetScale')).toBe('greenhouse');
    expect(platformOf('Vercel')).toBe('greenhouse');
    expect(platformOf('Anthropic')).toBe('greenhouse');
  });
});
