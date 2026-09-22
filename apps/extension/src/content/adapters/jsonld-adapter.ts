/**
 * @fileoverview Schema.org JobPosting JSON-LD Adapter.
 *
 * Highest-priority deterministic extractor when an employer includes standard JSON-LD structured data.
 */

import {
  type JobPosting,
  type WorkplaceType,
  type JobPostingEmploymentType,
  type SalaryRange,
  type Requirement,
  createJobPostingId,
} from '@applykit/domain';
import type { JobSiteAdapter } from './adapter.js';
import { extractJsonLd, extractCleanBodyText } from '../extractor.js';
import { extractStructuredSections } from '../normalizer.js';

export class JsonLdJobSiteAdapter implements JobSiteAdapter {
  readonly id = 'jsonld';
  readonly name = 'Schema.org JSON-LD Adapter';
  readonly priority = 100;

  matches(_url: URL, doc: Document): boolean {
    const records = extractJsonLd(doc);
    return records.some((r) => r['@type'] === 'JobPosting');
  }

  extract(doc: Document, url: URL): JobPosting {
    const records = extractJsonLd(doc);
    const data = records.find((r) => r['@type'] === 'JobPosting') || {};

    const title = typeof data['title'] === 'string' ? data['title'].trim() : doc.title.trim();

    let companyName = 'Unknown Company';
    if (data['hiringOrganization'] && typeof data['hiringOrganization'] === 'object') {
      const org = data['hiringOrganization'] as Record<string, unknown>;
      if (typeof org['name'] === 'string' && org['name'].trim().length > 0) {
        companyName = org['name'].trim();
      }
    }

    let location = 'Remote / Unspecified';
    if (data['jobLocation'] && typeof data['jobLocation'] === 'object') {
      const loc = data['jobLocation'] as Record<string, unknown>;
      if (loc['address'] && typeof loc['address'] === 'object') {
        const addr = loc['address'] as Record<string, string>;
        const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean);
        if (parts.length > 0) {
          location = parts.join(', ');
        }
      }
    }

    let workplaceType: WorkplaceType = 'onsite';
    const locLower = location.toLowerCase();
    const rawDescLower = typeof data['description'] === 'string' ? data['description'].toLowerCase() : '';
    if (locLower.includes('remote') || rawDescLower.includes('remote') || data['jobLocationType'] === 'TELECOMMUTE') {
      workplaceType = 'remote';
    } else if (locLower.includes('hybrid') || rawDescLower.includes('hybrid')) {
      workplaceType = 'hybrid';
    }

    let employmentType: JobPostingEmploymentType = 'full_time';
    const empTypeRaw = String(data['employmentType'] || '').toUpperCase();
    if (empTypeRaw.includes('PART_TIME')) {
      employmentType = 'part_time';
    } else if (empTypeRaw.includes('CONTRACT') || empTypeRaw.includes('TEMPORARY')) {
      employmentType = 'contract';
    } else if (empTypeRaw.includes('INTERN')) {
      employmentType = 'internship';
    }

    let salaryRange: SalaryRange | undefined;
    if (data['baseSalary'] && typeof data['baseSalary'] === 'object') {
      const sal = data['baseSalary'] as Record<string, unknown>;
      const val = (sal['value'] as Record<string, unknown>) || {};
      const min = Number(val['minValue']);
      const max = Number(val['maxValue'] || min);
      if (!isNaN(min) && min > 0) {
        salaryRange = {
          min,
          max: isNaN(max) || max < min ? min : max,
          currency: String(sal['currency'] || 'USD'),
          period: String(val['unitText'] || '').toUpperCase() === 'HOUR' ? 'hourly' : 'annual',
        };
      }
    }

    // Parse description for bullet requirements
    const rawHtmlDesc = typeof data['description'] === 'string' ? data['description'] : '';
    let requirements: Requirement[] = [];

    if (rawHtmlDesc.length > 0) {
      // Parse via DOMParser instead of innerHTML: the description is untrusted
      // page content, and DOMParser never executes scripts or handler attributes.
      const parsed = new DOMParser().parseFromString(rawHtmlDesc, 'text/html');
      requirements = [...extractStructuredSections(parsed.body).requirements];
    }

    if (requirements.length === 0) {
      requirements = [...extractStructuredSections(doc.body).requirements];
    }

    return {
      id: createJobPostingId(),
      url: url.href,
      title,
      companyName,
      location,
      workplaceType,
      employmentType,
      ...(salaryRange ? { salaryRange } : {}),
      rawDescription: rawHtmlDesc.length > 0 ? rawHtmlDesc : extractCleanBodyText(doc),
      parsedAt: new Date().toISOString(),
      requirements,
      metadata: {
        adapter: this.id,
        schemaType: 'JobPosting',
      },
    };
  }
}
