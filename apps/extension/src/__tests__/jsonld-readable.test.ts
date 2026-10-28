/**
 * @fileoverview JSON-LD postings must show readable text and the real remote region.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect } from 'vitest';
import { JsonLdJobSiteAdapter, htmlToReadableText } from '../content/adapters/jsonld-adapter.js';

function docWith(posting: Record<string, unknown>): Document {
  const doc = document.implementation.createHTMLDocument('Job');
  const script = doc.createElement('script');
  script.type = 'application/ld+json';
  script.textContent = JSON.stringify(posting);
  doc.head.appendChild(script);
  return doc;
}

describe('JSON-LD posting readability', () => {
  it('turns description HTML into plain text with list lines', () => {
    const text = htmlToReadableText('<p>We move money.</p><h3>Requirements</h3><ul><li>Go</li><li>PostgreSQL</li></ul>');
    expect(text).not.toMatch(/<[a-z]/i);
    expect(text).toContain('We move money.');
    expect(text).toContain('- Go');
    expect(text).toContain('- PostgreSQL');
  });

  it('decodes entity-encoded descriptions', () => {
    expect(htmlToReadableText('&lt;p&gt;Hello&lt;/p&gt;')).toBe('Hello');
  });

  it('reads the remote region from applicantLocationRequirements', () => {
    const doc = docWith({
      '@type': 'JobPosting',
      title: 'Senior Backend Engineer (Go)',
      hiringOrganization: { name: 'Northwind Payments' },
      jobLocationType: 'TELECOMMUTE',
      applicantLocationRequirements: { '@type': 'Country', name: 'Nigeria' },
      description: '<p>Ledger work.</p><ul><li>5+ years of backend engineering experience</li></ul>',
    });
    const job = new JsonLdJobSiteAdapter().extract(doc, new URL('https://jobs.example.com/1'));
    expect(job.location).toBe('Remote (Nigeria)');
    expect(job.workplaceType).toBe('remote');
    expect(job.rawDescription).not.toContain('<p>');
  });
});
