/**
 * Regression tests against a Tether-style (Recruitee) job posting document.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect } from 'vitest';
import { extractStructuredJob } from '../content/adapters/index.js';
import { inspectPageForms } from '../content/form-crawler.js';

const URL = 'https://careers.example.test/o/senior-nodejs-engineer';

const FIXTURE_HTML = `
<!doctype html>
<html lang="en">
<head>
  <title>Senior Node.js Engineer - Example (100% Remote)</title>
  <meta name="og:title" content="Senior Node.js Engineer - Example">
  <meta name="og:site_name" content="Example">
  <link rel="canonical" href="${URL}">
  <script type="application/ld+json">
  {
    "@type": "JobPosting",
    "@context": "https://schema.org",
    "title": "Senior Node.js Software Engineer - Example (100% Remote, Worldwide)",
    "jobLocationType": "TELECOMMUTE",
    "employmentType": "FULL_TIME",
    "hiringOrganization": { "@type": "Organization", "name": "Example Operations Limited" },
    "jobLocation": [
      { "@type": "Place", "address": { "@type": "PostalAddress", "addressCountry": "GB", "addressLocality": "London", "addressRegion": "England" } },
      { "@type": "Place", "address": { "@type": "PostalAddress", "addressCountry": "US", "addressLocality": "New York", "addressRegion": "NY" } }
    ],
    "description": "<p>Join Example and shape the future.</p><p>We are seeking a talented and motivated Node.js engineer to join our dynamic team and expand our ecosystem of public npm modules.</p><p>Proven experience in Node.js development with production-scale applications.</p><ul><li>Strong competency in writing modular, maintainable code.</li><li>Experience creating and managing reusable npm modules.</li><li>Solid skillset in testing and debugging.</li></ul><h3><strong>Preferred Qualifications</strong></h3><ul><li>Experience with native Node.js extensions (C/C++).</li><li>Familiarity with advanced networking concepts.</li></ul><p>Past contributions to OSS projects, especially in P2P or decentralized tech.</p>"
  }
  </script>
</head>
<body>
  <form id="offer-application-form">
    <label>Full name <input name="full_name" type="text"></label>
    <label>Email address <input name="email" type="email"></label>
    <label>Phone number <input name="phone" type="tel"></label>
    <label>CV or resume <input name="cv" type="file"></label>
    <label>Why are you interested in working at Example? <input name="custom_1" type="text"></label>
    <label>Do you have any experience with care packages? <textarea name="custom_2"></textarea></label>
    <button type="submit" data-testid="submit-application-form-button">Submit</button>
  </form>
</body>
</html>
`;

describe('Tether-style posting extraction', () => {
  it('handles array-valued jobLocation and standalone paragraph requirements', () => {
    document.open();
    document.write(FIXTURE_HTML);
    document.close();

    const posting = extractStructuredJob(document, URL);

    expect(posting.title).toContain('Node.js');
    expect(posting.companyName).toContain('Example');
    expect(posting.workplaceType).toBe('remote');
    // Array jobLocation must produce a combined location string
    expect(posting.location).toBe('London, England, GB; New York, NY, US');
    // Standalone-<p> requirements ("Proven experience...", "Past contributions...")
    const rawTexts = posting.requirements.map((r) => r.rawText);
    expect(rawTexts.some((t) => t.includes('Proven experience in Node.js'))).toBe(true);
    expect(rawTexts.some((t) => t.includes('Past contributions to OSS projects'))).toBe(true);
    // Preferred section paragraph inherits preferred importance
    const oss = posting.requirements.find((r) => r.rawText.includes('Past contributions'));
    expect(oss?.importance).toBe('preferred');
  });

  it('crawls embedded application form fields and submit gate', () => {
    document.open();
    document.write(FIXTURE_HTML);
    document.close();

    const forms = inspectPageForms(document);

    expect(forms.length).toBe(1);
    const form = forms[0];
    if (!form) return;
    expect(form.fields.length).toBeGreaterThanOrEqual(6);
    expect(form.submitButtonSelector).toBeDefined();
    const labels = form.fields.map((f) => f.label);
    expect(labels.some((l) => l.includes('Full name'))).toBe(true);
    expect(labels.some((l) => l.includes('Why are you interested'))).toBe(true);
  });
});