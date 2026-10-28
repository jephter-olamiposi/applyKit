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
      doc.querySelector('.job__title') ||
      doc.querySelector('#app_body') ||
      doc.querySelector('#header .company-name') ||
      doc.querySelector('[data-mapped="true"]')
    );
    return isHostMatch || hasGreenhouseDom;
  }

  extract(doc: Document, url: URL): JobPosting {
    // Greenhouse has two live layouts: boards.greenhouse.io (.app-title, #content) and
    // job-boards.greenhouse.io (.job__title, .job__location, .job__description).
    const titleEl =
      doc.querySelector('.job__title h1') || doc.querySelector('.app-title') || doc.querySelector('#header h1') || doc.querySelector('h1');
    const title = titleEl?.textContent?.trim() || doc.title.trim();

    const companyEl = doc.querySelector('.company-name') || doc.querySelector('#header .company-name');
    let companyName = companyEl?.textContent?.trim().replace(/^at\s+/i, '') || '';
    if (!companyName) {
      // The tab title reads "Job Application for <role> at <company>". The role itself can
      // contain " at " ("Engineer at Scale"), so the company is whatever follows the last one.
      const pageTitle = doc.title.replace(/\s*[|·].*$/, '').trim();
      const atIndex = pageTitle.toLowerCase().lastIndexOf(' at ');
      companyName = atIndex >= 0 ? pageTitle.slice(atIndex + 4).trim() : '';
    }

    const locationEl = doc.querySelector('.job__location') || doc.querySelector('.location') || doc.querySelector('#header .location');
    const location = locationEl?.textContent?.trim() || '';

    let workplaceType: WorkplaceType = 'onsite';
    const locLower = location.toLowerCase();
    const descriptionEl = doc.querySelector('.job__description');
    const cleanText = descriptionEl
      ? [title, location, (descriptionEl as HTMLElement).innerText || descriptionEl.textContent || '']
          .join('\n')
          .replace(/[ \t]+/g, ' ')
          .trim()
      : extractCleanBodyText(doc);
    if (locLower.includes('remote') || cleanText.toLowerCase().includes('remote')) {
      workplaceType = 'remote';
    } else if (locLower.includes('hybrid') || cleanText.toLowerCase().includes('hybrid')) {
      workplaceType = 'hybrid';
    }

    // Extract content container
    // Never fall back to the whole body when a description container exists: on the
    // new layout the body also holds the application form, whose labels would be read
    // as job requirements.
    const contentEl =
      doc.querySelector('.job__description') || doc.querySelector('#content .body') || doc.querySelector('#content') || doc.body;
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
