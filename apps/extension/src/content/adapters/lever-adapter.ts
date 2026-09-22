/**
 * @fileoverview Lever ATS Job Site Adapter.
 *
 * Dedicated extractor for jobs.lever.co career portals.
 */

import {
  type JobPosting,
  type WorkplaceType,
  type JobPostingEmploymentType,
  createJobPostingId,
} from '@applykit/domain';
import type { JobSiteAdapter } from './adapter.js';
import { extractCleanBodyText } from '../extractor.js';
import { extractStructuredSections } from '../normalizer.js';

export class LeverJobSiteAdapter implements JobSiteAdapter {
  readonly id = 'lever';
  readonly name = 'Lever ATS Adapter';
  readonly priority = 90;

  matches(url: URL, doc: Document): boolean {
    const isHostMatch = url.hostname.includes('lever.co');
    const hasLeverDom = Boolean(
      doc.querySelector('.posting-headline') ||
      doc.querySelector('.posting-categories') ||
      doc.querySelector('.section.page-centered')
    );
    return isHostMatch || hasLeverDom;
  }

  extract(doc: Document, url: URL): JobPosting {
    const titleEl = doc.querySelector('.posting-headline h2') || doc.querySelector('.posting-headline') || doc.querySelector('h1');
    const title = titleEl?.textContent?.trim() || doc.title.trim();

    // In Lever URLs, company name is typically the first pathname segment: jobs.lever.co/:company/:uuid
    let companyName = 'Unknown Company';
    const pathParts = url.pathname.split('/').filter(Boolean);
    if (url.hostname.includes('lever.co') && pathParts.length > 0 && pathParts[0] && pathParts[0] !== 'jobs') {
      companyName = pathParts[0].charAt(0).toUpperCase() + pathParts[0].slice(1);
    } else {
      const titleMatch = doc.title.match(/^([^|-]+)\s*[-|]/);
      if (titleMatch && titleMatch[1]) {
        companyName = titleMatch[1].trim();
      }
    }

    const locationEl = doc.querySelector('.sort-by-location') || doc.querySelector('.location');
    const location = locationEl?.textContent?.trim() || 'Remote / Unspecified';

    const commitmentEl = doc.querySelector('.sort-by-commitment');
    const commitmentText = commitmentEl?.textContent?.toLowerCase() || '';
    let employmentType: JobPostingEmploymentType = 'full_time';
    if (commitmentText.includes('part-time')) {
      employmentType = 'part_time';
    } else if (commitmentText.includes('contract')) {
      employmentType = 'contract';
    } else if (commitmentText.includes('intern')) {
      employmentType = 'internship';
    }

    const workplaceEl = doc.querySelector('.workplaceTypes');
    const workplaceText = workplaceEl?.textContent?.toLowerCase() || '';
    let workplaceType: WorkplaceType = 'onsite';
    const locLower = location.toLowerCase();
    const cleanText = extractCleanBodyText(doc);
    if (workplaceText.includes('remote') || locLower.includes('remote') || cleanText.toLowerCase().includes('remote')) {
      workplaceType = 'remote';
    } else if (workplaceText.includes('hybrid') || locLower.includes('hybrid')) {
      workplaceType = 'hybrid';
    }

    const contentEl = doc.querySelector('.section.page-centered .content') || doc.querySelector('.section.page-centered') || doc.body;
    const { requirements } = extractStructuredSections(contentEl);

    return {
      id: createJobPostingId(),
      url: url.href,
      title,
      companyName,
      location,
      workplaceType,
      employmentType,
      rawDescription: cleanText,
      parsedAt: new Date().toISOString(),
      requirements,
      metadata: {
        adapter: this.id,
        sourceAts: 'Lever',
      },
    };
  }
}
