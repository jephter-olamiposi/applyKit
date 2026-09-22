/**
 * @fileoverview Workday ATS Job Site Adapter.
 *
 * Dedicated extractor for Workday career portals (*.myworkdayjobs.com).
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

export class WorkdayJobSiteAdapter implements JobSiteAdapter {
  readonly id = 'workday';
  readonly name = 'Workday ATS Adapter';
  readonly priority = 90;

  matches(url: URL, doc: Document): boolean {
    const isHostMatch = url.hostname.includes('myworkdayjobs.com');
    const hasWorkdayDom = Boolean(
      doc.querySelector('[data-automation-id="jobPostingHeader"]') ||
      doc.querySelector('[data-automation-id="jobPostingDescription"]')
    );
    return isHostMatch || hasWorkdayDom;
  }

  extract(doc: Document, url: URL): JobPosting {
    const titleEl =
      doc.querySelector('[data-automation-id="jobPostingHeaderTitle"]') ||
      doc.querySelector('[data-automation-id="jobPostingHeader"] h1') ||
      doc.querySelector('h1');
    const title = titleEl?.textContent?.trim() || doc.title.trim();

    // Company from subdomain or title: company.myworkdayjobs.com
    let companyName = 'Unknown Company';
    const subdomains = url.hostname.split('.');
    if (subdomains.length > 2 && subdomains[0] && subdomains[0] !== 'www' && subdomains[0] !== 'myworkdayjobs') {
      const sub = subdomains[0];
      companyName = sub.charAt(0).toUpperCase() + sub.slice(1);
    }
    if (companyName === 'Unknown Company') {
      const titleMatch = doc.title.match(/[-|]\s*([^|-]+)$/);
      if (titleMatch && titleMatch[1]) {
        companyName = titleMatch[1].trim();
      }
    }

    const locationEl = doc.querySelector('[data-automation-id="locations"]');
    const location = locationEl?.textContent?.trim() || 'Remote / Unspecified';

    const timeTypeEl = doc.querySelector('[data-automation-id="timeType"]');
    const timeTypeText = timeTypeEl?.textContent?.toLowerCase() || '';
    let employmentType: JobPostingEmploymentType = 'full_time';
    if (timeTypeText.includes('part time')) {
      employmentType = 'part_time';
    } else if (timeTypeText.includes('contract')) {
      employmentType = 'contract';
    }

    const cleanText = extractCleanBodyText(doc);
    let workplaceType: WorkplaceType = 'onsite';
    if (location.toLowerCase().includes('remote') || cleanText.toLowerCase().includes('remote')) {
      workplaceType = 'remote';
    } else if (location.toLowerCase().includes('hybrid') || cleanText.toLowerCase().includes('hybrid')) {
      workplaceType = 'hybrid';
    }

    const descEl = doc.querySelector('[data-automation-id="jobPostingDescription"]') || doc.body;
    const { requirements } = extractStructuredSections(descEl);

    const jobIdEl = doc.querySelector('[data-automation-id="jobPostingId"]');
    const jobId = jobIdEl?.textContent?.trim() || '';

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
        sourceAts: 'Workday',
        ...(jobId ? { workdayJobId: jobId } : {}),
      },
    };
  }
}
