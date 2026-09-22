/**
 * @fileoverview Generic Semantic DOM Job Site Adapter.
 *
 * Universal fallback extractor leveraging semantic HTML, OpenGraph tags, and common CSS class conventions.
 */

import {
  type JobPosting,
  type WorkplaceType,
  createJobPostingId,
} from '@applykit/domain';
import type { JobSiteAdapter } from './adapter.js';
import { extractCleanBodyText } from '../extractor.js';
import { extractStructuredSections } from '../normalizer.js';

export class GenericJobSiteAdapter implements JobSiteAdapter {
  readonly id = 'generic';
  readonly name = 'Generic Semantic Parser';
  readonly priority = 10;

  matches(_url: URL, _doc: Document): boolean {
    // Always matches as the terminal fallback adapter
    return true;
  }

  extract(doc: Document, url: URL): JobPosting {
    const ogTitle = doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
    const h1 = doc.querySelector('h1')?.textContent?.trim();
    const title = h1 || ogTitle || doc.title.trim();

    const ogSiteName = doc.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim();
    let companyName = ogSiteName || '';
    if (!companyName) {
      // Derive from hostname: "careers.airbnb.com" -> "Airbnb"
      const domainParts = url.hostname.replace(/^www\./, '').split('.');
      if (domainParts.length >= 2) {
        const candidate = domainParts[0] === 'careers' || domainParts[0] === 'jobs' ? domainParts[1] : domainParts[0];
        if (candidate) {
          companyName = candidate.charAt(0).toUpperCase() + candidate.slice(1);
        }
      }
    }
    if (!companyName) {
      companyName = 'Company';
    }

    const cleanText = extractCleanBodyText(doc);
    let workplaceType: WorkplaceType = 'onsite';
    if (cleanText.toLowerCase().includes('remote') || title.toLowerCase().includes('remote')) {
      workplaceType = 'remote';
    } else if (cleanText.toLowerCase().includes('hybrid') || title.toLowerCase().includes('hybrid')) {
      workplaceType = 'hybrid';
    }

    // Locate primary job content container
    const contentContainer =
      doc.querySelector('article') ||
      doc.querySelector('[class*="job-description"]') ||
      doc.querySelector('[id*="job-description"]') ||
      doc.querySelector('[class*="description"]') ||
      doc.querySelector('main') ||
      doc.body;

    const { requirements } = extractStructuredSections(contentContainer);

    return {
      id: createJobPostingId(),
      url: url.href,
      title,
      companyName,
      location: 'Remote / Unspecified',
      workplaceType,
      employmentType: 'full_time',
      rawDescription: cleanText,
      parsedAt: new Date().toISOString(),
      requirements,
      metadata: {
        adapter: this.id,
        parsedBy: 'GenericSemanticParser',
      },
    };
  }
}
