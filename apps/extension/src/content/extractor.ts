/**
 * @fileoverview DOM Extraction and sanitization engine for content script contexts.
 *
 * Implements Phase 1 content extraction while maintaining security boundaries:
 * 1. Indirect prompt injection mitigation by sanitizing and XML-wrapping third-party text.
 * 2. Complete absence of any credential or API key dependencies (ADR-0002).
 * 3. Pure DOM traversal decoupled from external network requests.
 */

import type { ExtractedPageData } from '../messages/contracts.js';

/**
 * Escapes characters with special meaning in XML to ensure content injected into LLM
 * prompt templates cannot break out of structural boundary delimiters.
 *
 * @param str Raw untrusted string.
 * @returns Safely escaped XML character sequence.
 */
export function escapeXmlEntities(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Strips script tags, style blocks, hidden elements, and dangerous embeds from an HTML clone,
 * then returns readable, whitespace-normalized body text.
 *
 * @param doc The Document object to extract visible body text from.
 * @returns Cleaned plaintext representation of the main document body.
 */
export function extractCleanBodyText(doc: Document): string {
  const body = doc.body;
  if (!body) {
    return '';
  }

  // Clone node to prevent mutating live webpage DOM
  const clone = body.cloneNode(true) as HTMLElement;

  // Remove dangerous and non-textual tags
  const tagsToRemove = [
    'script',
    'style',
    'noscript',
    'iframe',
    'object',
    'embed',
    'svg',
    'canvas',
    'nav',
    'footer',
  ];

  for (const tag of tagsToRemove) {
    const elements = clone.querySelectorAll(tag);
    elements.forEach((el) => el.remove());
  }

  // Remove elements explicitly marked hidden
  const hiddenElements = clone.querySelectorAll('[hidden], [aria-hidden="true"]');
  hiddenElements.forEach((el) => el.remove());

  const rawText = clone.innerText ?? clone.textContent ?? '';

  // Collapse excess whitespace and empty lines
  return rawText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/**
 * Collects and parses JSON-LD schemas embedded in `<script type="application/ld+json">` tags.
 *
 * @param doc The Document object to inspect.
 * @returns Array of parsed JSON-LD objects.
 */
export function extractJsonLd(doc: Document): Record<string, unknown>[] {
  const scripts = doc.querySelectorAll('script[type="application/ld+json"]');
  const results: Record<string, unknown>[] = [];

  scripts.forEach((script) => {
    const content = script.textContent?.trim();
    if (!content) {
      return;
    }

    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item && typeof item === 'object') {
            results.push(item as Record<string, unknown>);
          }
        }
      } else if (parsed && typeof parsed === 'object') {
        results.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Ignore malformed JSON-LD scripts on host page
    }
  });

  return results;
}

/**
 * Extracts comprehensive job posting metadata and text from the active webpage DOM.
 *
 * @param doc The Document object to inspect (defaults to global window.document).
 * @param location The Location or URL string (defaults to global window.location).
 * @returns Extracted page data adhering to {@link ExtractedPageData}.
 */
export function extractPageData(
  doc: Document = document,
  locationHref: string = typeof window !== 'undefined' ? window.location.href : ''
): ExtractedPageData {
  const url = locationHref;
  const title = doc.title || '';

  // Metadata tags extraction
  const getMeta = (selector: string): string | undefined => {
    const el = doc.querySelector(`meta[${selector}]`);
    return el?.getAttribute('content')?.trim() || undefined;
  };

  const metaDescription =
    getMeta('name="description"') ||
    getMeta('property="og:description"') ||
    getMeta('name="twitter:description"');

  const rawKeywords = getMeta('name="keywords"');
  const metaKeywords = rawKeywords
    ? rawKeywords
        .split(',')
        .map((k) => k.trim())
        .filter((k) => k.length > 0)
    : undefined;

  const canonicalLink = doc.querySelector('link[rel="canonical"]');
  const canonicalUrl = canonicalLink?.getAttribute('href')?.trim() || undefined;

  const ogTitle = getMeta('property="og:title"');
  const ogSiteName = getMeta('property="og:site_name"');

  // Headings extraction
  const h1Elements = Array.from(doc.querySelectorAll('h1'));
  const h1 = h1Elements
    .map((el) => el.textContent?.trim() || '')
    .filter((text) => text.length > 0);

  const subHeadings = Array.from(doc.querySelectorAll('h2, h3'));
  const headings = subHeadings
    .map((el) => el.textContent?.trim() || '')
    .filter((text) => text.length > 0);

  // Selected text (if user highlighted a specific job section)
  let selectedText: string | undefined;
  if (typeof window !== 'undefined' && window.getSelection) {
    const selection = window.getSelection()?.toString().trim();
    if (selection && selection.length > 0) {
      selectedText = selection;
    }
  }

  const cleanBodyText = extractCleanBodyText(doc);
  const jsonLd = extractJsonLd(doc);

  // XML demarcation prevents prompt injection by encapsulating untrusted text
  const sanitizedXml = [
    '<untrusted_job_content>',
    `  <source_url>${escapeXmlEntities(url)}</source_url>`,
    `  <page_title>${escapeXmlEntities(title)}</page_title>`,
    metaDescription ? `  <meta_description>${escapeXmlEntities(metaDescription)}</meta_description>` : '',
    h1.length > 0 ? `  <primary_headings>${h1.map(h => escapeXmlEntities(h)).join(' | ')}</primary_headings>` : '',
    headings.length > 0 ? `  <section_headings>${headings.map(h => escapeXmlEntities(h)).join(' | ')}</section_headings>` : '',
    selectedText ? `  <user_selected_text>${escapeXmlEntities(selectedText)}</user_selected_text>` : '',
    `  <body_content>\n${escapeXmlEntities(cleanBodyText)}\n  </body_content>`,
    '</untrusted_job_content>',
  ].filter(Boolean).join('\n');

  return {
    url,
    title,
    metaDescription,
    metaKeywords,
    canonicalUrl,
    ogTitle,
    ogSiteName,
    h1,
    headings,
    selectedText,
    cleanBodyText,
    sanitizedXml,
    jsonLd,
    extractedAt: new Date().toISOString(),
  };
}
