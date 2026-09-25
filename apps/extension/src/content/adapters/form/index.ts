/**
 * @fileoverview ATS Form Adapter Registry and Inspection Engine.
 *
 * Coordinates vendor-specific form adapters (Workday, Greenhouse, Lever, Ashby, Generic)
 * to inspect application web pages, track multi-step wizard progression, and detect
 * candidate authentication barriers.
 */

import type { ApplicationForm } from '@applykit/domain';
import type { AtsFormAdapter } from './form-adapter.js';
import { WorkdayFormAdapter } from './workday-form-adapter.js';
import { GreenhouseFormAdapter } from './greenhouse-form-adapter.js';
import { LeverFormAdapter } from './lever-form-adapter.js';
import { AshbyFormAdapter } from './ashby-form-adapter.js';
import { RecruiteeFormAdapter } from './recruitee-form-adapter.js';
import { GenericFormAdapter } from './generic-form-adapter.js';

export * from './form-adapter.js';
export * from './workday-form-adapter.js';
export * from './greenhouse-form-adapter.js';
export * from './lever-form-adapter.js';
export * from './ashby-form-adapter.js';
export * from './recruitee-form-adapter.js';
export * from './generic-form-adapter.js';

/**
 * Standard registry of ATS form adapters sorted by priority (highest first).
 */
const FORM_ADAPTERS: readonly AtsFormAdapter[] = [
  new WorkdayFormAdapter(),
  new GreenhouseFormAdapter(),
  new LeverFormAdapter(),
  new AshbyFormAdapter(),
  new RecruiteeFormAdapter(),
  new GenericFormAdapter(),
].sort((a, b) => b.priority - a.priority);

/**
 * Retrieves the list of available ATS form adapters.
 */
export function getRegisteredFormAdapters(): readonly AtsFormAdapter[] {
  return FORM_ADAPTERS;
}

/**
 * Resolves the best-matching ATS form adapter for the given URL and document.
 *
 * @param url Active webpage URL.
 * @param doc DOM document object.
 * @returns Highest-priority matching AtsFormAdapter.
 */
export function findMatchingFormAdapter(url: URL, doc: Document): AtsFormAdapter {
  for (const adapter of FORM_ADAPTERS) {
    if (adapter.matches(url, doc)) {
      return adapter;
    }
  }

  // Fallback guaranteed to match
  return new GenericFormAdapter();
}

/**
 * Inspects the webpage using the best-matching ATS form adapter.
 *
 * @param doc Webpage DOM document.
 * @returns Array of inspected ApplicationForm aggregates.
 */
export function inspectPageWithAtsAdapters(doc: Document): readonly ApplicationForm[] {
  if (!doc.location) {
    throw new Error('Cannot inspect application form without a document location.');
  }
  const url = new URL(doc.location.href);
  const adapter = findMatchingFormAdapter(url, doc);

  const form = adapter.crawlForm(doc);
  if (form) {
    return [form];
  }

  // If specialized adapter found 0 fields, fall back to generic adapter
  if (adapter.id !== 'generic') {
    const fallback = new GenericFormAdapter();
    const fallbackForm = fallback.crawlForm(doc);
    if (fallbackForm) {
      return [fallbackForm];
    }
  }

  return [];
}
