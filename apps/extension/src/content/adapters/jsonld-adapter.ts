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

    let location = '';
    const rawLocations = data['jobLocation'];
    if (Array.isArray(rawLocations)) {
      // Multiple nested WorkLocations (ICIMS/RECRUITEE style): collect all place names.
      const placeNames: string[] = [];
      for (const loc of rawLocations) {
        if (typeof loc !== 'object' || loc === null) continue;
        const locObj = loc as Record<string, unknown>;
        if (locObj['@type'] === 'VirtualLocation') {
          placeNames.push(String(locObj['description'] || 'Remote'));
          continue;
        }
        if (locObj['address'] && typeof locObj['address'] === 'object') {
          const addr = locObj['address'] as Record<string, string>;
          const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean);
          if (parts.length > 0) {
            placeNames.push(parts.join(', '));
          }
        }
      }
      if (placeNames.length > 0) {
        location = placeNames.join('; ');
      }
    } else if (rawLocations && typeof rawLocations === 'object') {
      const loc = rawLocations as Record<string, unknown>;
      if (loc['@type'] === 'VirtualLocation') {
        location = String(loc['description'] || 'Remote');
      } else if (loc['address'] && typeof loc['address'] === 'object') {
        const addr = loc['address'] as Record<string, string>;
        const parts = [addr.addressLocality, addr.addressRegion, addr.addressCountry].filter(Boolean);
        if (parts.length > 0) {
          location = parts.join(', ');
        }
      }
    }

    // Remote postings name who may apply in applicantLocationRequirements rather than in
    // jobLocation, e.g. { "@type": "Country", "name": "Nigeria" }.
    const applicantRegions = readApplicantRegions(data['applicantLocationRequirements']);
    if (data['jobLocationType'] === 'TELECOMMUTE') {
      const remoteLabel = applicantRegions.length > 0 ? `Remote (${applicantRegions.join(', ')})` : 'Remote';
      location = location ? `${location}; ${remoteLabel}` : remoteLabel;
    } else if (!location && applicantRegions.length > 0) {
      location = applicantRegions.join(', ');
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
      const parsed = new DOMParser().parseFromString(decodeEncodedMarkup(rawHtmlDesc), 'text/html');
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
      rawDescription: rawHtmlDesc.length > 0 ? htmlToReadableText(rawHtmlDesc) : extractCleanBodyText(doc),
      parsedAt: new Date().toISOString(),
      requirements,
      metadata: {
        adapter: this.id,
        schemaType: 'JobPosting',
      },
    };
  }
}

/**
 * Some boards publish the description entity-encoded ("&lt;p&gt;"). Decoding once through
 * a detached DOMParser document turns it back into markup without executing anything.
 */
function decodeEncodedMarkup(html: string): string {
  if (!/&lt;\/?[a-z]/i.test(html)) return html;
  return new DOMParser().parseFromString(html, 'text/html').documentElement.textContent ?? html;
}

/**
 * Converts description HTML into readable plain text: list items become "- " lines and
 * block elements become line breaks, so the side panel never shows raw tags.
 */
export function htmlToReadableText(html: string): string {
  const doc = new DOMParser().parseFromString(decodeEncodedMarkup(html), 'text/html');
  doc.querySelectorAll('script, style, iframe').forEach((node) => node.remove());
  doc.querySelectorAll('li').forEach((li) => {
    li.insertBefore(doc.createTextNode('\n- '), li.firstChild);
  });
  doc.querySelectorAll('br').forEach((br) => br.replaceWith(doc.createTextNode('\n')));
  doc.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, ul, ol, section').forEach((block) => {
    block.appendChild(doc.createTextNode('\n'));
  });
  return (doc.body.textContent ?? '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Reads country or region names from schema.org applicantLocationRequirements. */
function readApplicantRegions(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : value ? [value] : [];
  const names: string[] = [];
  for (const entry of entries) {
    if (typeof entry === 'string' && entry.trim()) {
      names.push(entry.trim());
    } else if (entry && typeof entry === 'object') {
      const record = entry as Record<string, unknown>;
      const name = typeof record['name'] === 'string' ? record['name'] : undefined;
      const address = record['address'] as Record<string, unknown> | undefined;
      const country = address && typeof address['addressCountry'] === 'string' ? address['addressCountry'] : undefined;
      const label = (name ?? country ?? '').trim();
      if (label) names.push(label);
    }
  }
  return [...new Set(names)];
}
