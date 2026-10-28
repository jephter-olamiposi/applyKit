/**
 * @fileoverview Which saved job an application form belongs to.
 */

import { describe, it, expect } from 'vitest';
import { companyFromPageTitle, companySlugFromUrl, pickJobForPage, type JobPosting } from '../index.js';

const job = (id: string, companyName: string, url: string) => ({ id, companyName, url, title: 'Backend Engineer' }) as unknown as JobPosting;
const monzo = job('j1', 'Monzo', 'https://boards.greenhouse.io/monzo/jobs/111');
const mercury = job('j2', 'Mercury', 'https://jobs.ashbyhq.com/mercury/abc-123');
const northwind = job('j3', 'Northwind Payments', 'https://jobs.lever.co/northwind-payments/xyz');

describe('companySlugFromUrl', () => {
  it('reads the board name from common ATS addresses', () => {
    expect(companySlugFromUrl('https://boards.greenhouse.io/monzo/jobs/111#app')).toBe('monzo');
    expect(companySlugFromUrl('https://job-boards.greenhouse.io/embed/job_app?for=monzo&token=1')).toBe('monzo');
    expect(companySlugFromUrl('https://jobs.lever.co/northwind-payments/xyz/apply')).toBe('northwindpayments');
    expect(companySlugFromUrl('https://acme.recruitee.com/o/backend')).toBe('acme');
    expect(companySlugFromUrl('https://careers.example.com/jobs/1')).toBeUndefined();
  });
});

describe('pickJobForPage', () => {
  it('matches the job at the same address or its apply step', () => {
    expect(pickJobForPage('https://jobs.lever.co/northwind-payments/xyz/apply', [mercury, northwind, monzo], mercury).job).toBe(northwind);
  });

  it('goes back to an earlier job when the form names its company', () => {
    const picked = pickJobForPage('https://boards.greenhouse.io/monzo/jobs/222', [mercury, northwind, monzo], mercury);
    expect(picked.job).toBe(monzo);
    expect(picked.reason).toBe('company_in_address');
  });

  it('returns no job when the form names a company nothing was read for', () => {
    const picked = pickJobForPage('https://boards.greenhouse.io/stripe/jobs/9', [mercury, monzo], mercury);
    expect(picked.job).toBeNull();
    expect(picked.companySlug).toBe('stripe');
  });

  it('falls back to the last job read when the address says nothing', () => {
    expect(pickJobForPage('https://careers.example.com/apply/1', [monzo], mercury).job).toBe(mercury);
  });
});

describe('company career sites and page titles', () => {
  const monzoSite = job('j4', 'Monzo', 'https://monzo.com/careers/backend-engineer');

  it('matches a company careers host', () => {
    const picked = pickJobForPage('https://careers.monzo.com/apply/42', [mercury, monzoSite], mercury);
    expect(picked.job).toBe(monzoSite);
  });

  it('matches the company named in the page title', () => {
    const picked = pickJobForPage('https://apply.example.com/form/9', [mercury, monzoSite], mercury, 'Senior Backend Engineer at Monzo | Careers');
    expect(picked.job).toBe(monzoSite);
    expect(picked.reason).toBe('company_in_title');
  });

  it('returns no job when the title names a company nothing was read for', () => {
    const picked = pickJobForPage('http://localhost:8123/apply.html', [mercury], mercury, 'Job Application for Senior Backend Engineer at Northwind Payments');
    expect(picked.job).toBeNull();
    expect(picked.companyLabel).toBe('Northwind Payments');
  });

  it('reads the company from an "at X" title only', () => {
    expect(companyFromPageTitle('Job Application for Senior Backend Engineer at Northwind Payments')).toBe('Northwind Payments');
    expect(companyFromPageTitle('Backend Engineer at Monzo | Careers')).toBe('Monzo');
    expect(companyFromPageTitle('Apply now')).toBeUndefined();
  });
});

describe('roleFromPageTitle', () => {
  it('reads the role from "<role> at <company>" titles only', async () => {
    const { roleFromPageTitle } = await import('../index.js');
    expect(roleFromPageTitle('Job Application for Senior Backend Engineer at Northwind Payments')).toBe('Senior Backend Engineer');
    expect(roleFromPageTitle('Backend Engineer at Monzo | Careers')).toBe('Backend Engineer');
    expect(roleFromPageTitle('Careers')).toBeUndefined();
  });
});
