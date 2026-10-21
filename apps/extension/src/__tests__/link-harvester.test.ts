/**
 * @fileoverview Unit tests for DOM link harvester.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { harvestPageJobLinks } from '../content/link-harvester.js';

describe('harvestPageJobLinks', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('extracts links matching known ATS hosts', () => {
    document.body.innerHTML = `
      <div>
        <a href="https://jobs.ashbyhq.com/monad/12345" class="job-link">Staff Backend Engineer</a>
        <a href="https://boards.greenhouse.io/stripe/jobs/67890">Infrastructure Lead</a>
        <a href="https://jobs.lever.co/figma/abc-def-123">Senior Full Stack</a>
        <a href="https://google.com/about">About Company</a>
      </div>
    `;

    const links = harvestPageJobLinks(document, 'https://careers.example.com');
    expect(links).toHaveLength(3);
    expect(links[0]!.url).toBe('https://jobs.ashbyhq.com/monad/12345');
    expect(links[0]!.title).toBe('Staff Backend Engineer');
    expect(links[1]!.url).toBe('https://boards.greenhouse.io/stripe/jobs/67890');
    expect(links[1]!.title).toBe('Infrastructure Lead');
    expect(links[2]!.url).toBe('https://jobs.lever.co/figma/abc-def-123');
    expect(links[2]!.title).toBe('Senior Full Stack');
  });

  it('extracts links with relative URLs and job path patterns', () => {
    document.body.innerHTML = `
      <div class="careers-list">
        <a href="/careers/principal-architect">Principal Architect</a>
        <a href="/jobs/platform-lead?utm_source=linkedin">Platform Lead</a>
        <a href="/privacy-policy">Privacy Policy</a>
      </div>
    `;

    const links = harvestPageJobLinks(document, 'https://company.io/careers');
    expect(links).toHaveLength(2);
    expect(links[0]!.url).toBe('https://company.io/careers/principal-architect');
    expect(links[0]!.title).toBe('Principal Architect');
    expect(links[1]!.url).toBe('https://company.io/jobs/platform-lead');
    expect(links[1]!.title).toBe('Platform Lead');
  });

  it('deduplicates identical URLs after stripping tracking parameters', () => {
    document.body.innerHTML = `
      <div>
        <a href="https://jobs.lever.co/corp/job-1?utm_source=twitter">Role One</a>
        <a href="https://jobs.lever.co/corp/job-1?utm_medium=cpc">Role One Again</a>
      </div>
    `;

    const links = harvestPageJobLinks(document, 'https://corp.com');
    expect(links).toHaveLength(1);
    expect(links[0]!.url).toBe('https://jobs.lever.co/corp/job-1');
  });

  it('resolves generic button anchor text from nearby card headings', () => {
    document.body.innerHTML = `
      <div class="job-card">
        <h3>Senior Rust Specialist</h3>
        <a href="https://jobs.ashbyhq.com/tech/rust-specialist">Apply Now</a>
      </div>
    `;

    const links = harvestPageJobLinks(document, 'https://tech.io');
    expect(links).toHaveLength(1);
    expect(links[0]!.title).toBe('Senior Rust Specialist');
  });

  it('ignores invalid, javascript, and anchor fragment hrefs', () => {
    document.body.innerHTML = `
      <div>
        <a href="javascript:void(0)">Do nothing</a>
        <a href="#section">Jump</a>
        <a href="mailto:jobs@company.com">Email Us</a>
      </div>
    `;

    const links = harvestPageJobLinks(document, 'https://company.io');
    expect(links).toHaveLength(0);
  });
});
