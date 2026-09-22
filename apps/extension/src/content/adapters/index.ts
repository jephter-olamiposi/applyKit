/**
 * @fileoverview Job Site Adapter Registry and Extraction Orchestrator.
 *
 * Implements deterministic priority-based adapter selection:
 * 1. Schema.org JSON-LD (priority 100)
 * 2. Vendor ATS Adapters: Greenhouse, Lever, Workday (priority 90)
 * 3. Generic Semantic Parser (priority 10)
 */

import type { JobPosting } from '@applykit/domain';
import type { JobSiteAdapter } from './adapter.js';
import { JsonLdJobSiteAdapter } from './jsonld-adapter.js';
import { GreenhouseJobSiteAdapter } from './greenhouse-adapter.js';
import { LeverJobSiteAdapter } from './lever-adapter.js';
import { WorkdayJobSiteAdapter } from './workday-adapter.js';
import { GenericJobSiteAdapter } from './generic-adapter.js';

export * from './adapter.js';
export * from './jsonld-adapter.js';
export * from './greenhouse-adapter.js';
export * from './lever-adapter.js';
export * from './workday-adapter.js';
export * from './generic-adapter.js';

const REGISTERED_ADAPTERS: readonly JobSiteAdapter[] = [
  new JsonLdJobSiteAdapter(),
  new GreenhouseJobSiteAdapter(),
  new LeverJobSiteAdapter(),
  new WorkdayJobSiteAdapter(),
  new GenericJobSiteAdapter(),
];

/**
 * Resolves the highest-priority adapter matching the current webpage and DOM document.
 */
export function findMatchingAdapter(url: URL, doc: Document): JobSiteAdapter {
  const sorted = [...REGISTERED_ADAPTERS].sort((a, b) => b.priority - a.priority);
  for (const adapter of sorted) {
    if (adapter.matches(url, doc)) {
      return adapter;
    }
  }
  return new GenericJobSiteAdapter();
}

/**
 * Extracts a complete, strongly-typed JobPosting from the provided document and URL.
 */
export function extractStructuredJob(
  doc: Document = document,
  urlString: string = typeof window !== 'undefined' ? window.location.href : 'https://example.com'
): JobPosting {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    url = new URL('https://example.com');
  }

  const adapter = findMatchingAdapter(url, doc);
  return adapter.extract(doc, url);
}
