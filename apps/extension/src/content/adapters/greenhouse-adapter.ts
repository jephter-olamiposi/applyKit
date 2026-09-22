/**
 * @fileoverview Greenhouse ATS Job Site Adapter.
 *
 * Dedicated extractor for boards.greenhouse.io career portals and embedded iframes.
 */

import {
  type JobPosting,
  type WorkplaceType,
  createJobPostingId,
} from '@applykit/domain';
import type { JobSiteAdapter } from './adapter.js';
import { extractCleanBodyText } from '../extractor.js';
import { extractStructuredSections } from '../normalizer.js';

export class GreenhouseJobSiteAdapter implements JobSiteAdapter {
  readonly id = 'greenhouse';
  readonly name = 'Greenhouse ATS Adapter';
  readonly priority = 90;

  matches(url: URL, doc: Document): boolean {
    const isHostMatch = url.hostname.includes('greenhouse.io');
    const hasGreenhouseDom = Boolean(
      doc.querySelector('.app-title') ||
      doc.querySelector('#app_body') ||
      doc.querySelector('#header .company-name') ||
      doc.querySelector('[data-mapped="true"]')
    );
    return isHostMatch || hasGreenhouseDom;
  }

  extract(doc: Document, url: URL): JobPosting {
    const titleEl = doc.querySelector('.app-title') || doc.querySelector('#header h1') || doc.querySelector('h1');
    const title = titleEl?.textContent?.trim() || doc.title.trim();

    const companyEl = doc.querySelector('.company-name') || doc.querySelector('#header .company-name');
    let companyName = companyEl?.textContent?.trim().replace(/^at\s+/i, '') || '';
    if (!companyName) {
      // Heuristic fallback: check title like "Senior Engineer at Acme Corp"
      const titleMatch = doc.title.match(/\bat\s+([^|-]+)/i);
      companyName = titleMatch && titleMatch[1] ? titleMatch[1].trim() : 'Unknown Company';
    }

    const locationEl = doc.querySelector('.location') || doc.querySelector('#header .location');
    const location = locationEl?.textContent?.trim() || 'Remote / Unspecified';

    let workplaceType: WorkplaceType = 'onsite';
    const locLower = location.toLowerCase();
    const cleanText = extractCleanBodyText(doc);
    if (locLower.includes('remote') || cleanText.toLowerCase().includes('remote')) {
      workplaceType = 'remote';
    } else if (locLower.includes('hybrid') || cleanText.toLowerCase().includes('hybrid')) {
      workplaceType = 'hybrid';
    }

    // Extract content container
    const contentEl = doc.querySelector('#content .body') || doc.querySelector('#content') || doc.body;
    const { requirements } = extractStructuredSections(contentEl);

    return {
      id: createJobPostingId(),
      url: url.href,
      title,
      companyName,
      location,
      workplaceType,
      employmentType: 'full_time',
      rawDescription: cleanText,
      parsedAt: new Date().toISOString(),
      requirements,
      metadata: {
        adapter: this.id,
        sourceAts: 'Greenhouse',
      },
    };
  }
}
