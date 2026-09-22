/**
 * @fileoverview Job Site Adapter contract.
 *
 * Implements deterministic site-specific extraction for known ATS vendors and generic portals.
 */

import type { JobPosting } from '@applykit/domain';

/**
 * Adapter contract for extracting structured JobPosting data from specific ATS layouts or DOM formats.
 */
export interface JobSiteAdapter {
  /** Unique vendor or parser identifier (e.g. 'greenhouse', 'lever', 'workday', 'jsonld', 'generic'). */
  readonly id: string;
  /** Human-readable display label for the adapter. */
  readonly name: string;
  /** Execution priority (higher number executes first). */
  readonly priority: number;

  /**
   * Tests whether this adapter can extract from the provided webpage URL and DOM document.
   */
  matches(url: URL, doc: Document): boolean;

  /**
   * Executes deterministic extraction, returning a structured JobPosting model.
   */
  extract(doc: Document, url: URL): JobPosting;
}
