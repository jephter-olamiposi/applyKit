/**
 * @fileoverview Recruitee ATS Job Site Adapter.
 *
 * Dedicated extractor for Recruitee-hosted career pages (e.g. holepunch.recruitee.com).
 * Extracts structured job title, company name, remote/hybrid status, and categorized requirements.
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

/**
 * Recruitee ATS job posting extractor.
 */
export class RecruiteeJobSiteAdapter implements JobSiteAdapter {
  readonly id = 'recruitee';
  readonly name = 'Recruitee ATS Adapter';
  readonly priority = 85;

  matches(url: URL, doc: Document): boolean {
    const isHostMatch = url.hostname.includes('recruitee.com');
    const hasRecruiteeDom = Boolean(
      doc.querySelector('#offer-application-form') ||
      doc.querySelector('meta[name="offer-guid"]') ||
      doc.querySelector('link[href*="recruitee"]') ||
      doc.querySelector('.offer-header')
    );
    return isHostMatch || hasRecruiteeDom;
  }

  extract(doc: Document, url: URL): JobPosting {
    // 1. Job Title
    const titleEl =
      doc.querySelector('h1.app-title') ||
      doc.querySelector('h1[class*="gVUetx"]') ||
      doc.querySelector('.offer-title') ||
      doc.querySelector('h1');
    const title = titleEl?.textContent?.trim() || doc.title.replace(/\s*[-|]\s*Recruitee.*$/i, '').trim();

    // 2. Company Name
    let companyName = 'Unknown Company';
    const siteNameMeta = doc.querySelector('meta[property="og:site_name"]');
    if (siteNameMeta && siteNameMeta.getAttribute('content')) {
      companyName = siteNameMeta.getAttribute('content')!.trim();
    } else {
      const hostParts = url.hostname.split('.');
      if (hostParts.length > 2 && hostParts[0] && hostParts[0] !== 'careers') {
        companyName = hostParts[0].charAt(0).toUpperCase() + hostParts[0].slice(1);
      } else {
        const titleMatch = doc.title.match(/^([^|-]+)\s*[-|]/);
        if (titleMatch && titleMatch[1]) {
          companyName = titleMatch[1].trim();
        }
      }
    }

    // 3. Location & Workplace Type
    const locationEl =
      doc.querySelector('.location') ||
      doc.querySelector('[class*="location"]') ||
      doc.querySelector('ul[class*="geWhTh"] li');
    const location = locationEl?.textContent?.trim() || 'Remote, Worldwide';

    const fullPageText = doc.body.innerText.toLowerCase();
    let workplaceType: WorkplaceType = 'onsite';
    if (fullPageText.includes('remote') || location.toLowerCase().includes('remote')) {
      workplaceType = 'remote';
    } else if (fullPageText.includes('hybrid') || location.toLowerCase().includes('hybrid')) {
      workplaceType = 'hybrid';
    }

    // 4. Employment Type
    let employmentType: JobPostingEmploymentType = 'full_time';
    if (fullPageText.includes('part-time') || fullPageText.includes('part time')) {
      employmentType = 'part_time';
    } else if (fullPageText.includes('contract')) {
      employmentType = 'contract';
    } else if (fullPageText.includes('internship') || fullPageText.includes('intern')) {
      employmentType = 'internship';
    }

    // 5. Raw Description & Requirements
    const bodyEl =
      doc.querySelector('.body') ||
      doc.querySelector('.description') ||
      doc.querySelector('[class*="fzYpia"]') ||
      doc.querySelector('.content') ||
      doc.body;

    const rawDescription = extractCleanBodyText(doc);
    const { requirements } = extractStructuredSections(bodyEl as HTMLElement);

    return {
      id: createJobPostingId(),
      url: url.href,
      title,
      companyName,
      location,
      workplaceType,
      employmentType,
      rawDescription,
      parsedAt: new Date().toISOString(),
      requirements,
      metadata: {
        adapter: this.id,
      },
    };
  }
}
