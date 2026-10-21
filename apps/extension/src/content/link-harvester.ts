/**
 * @fileoverview DOM link harvester for discovering job postings on active webpages.
 */

/**
 * Known ATS hostnames where job postings are commonly hosted.
 */
const KNOWN_ATS_HOSTS = [
  'boards.greenhouse.io',
  'jobs.greenhouse.io',
  'jobs.ashbyhq.com',
  'jobs.lever.co',
  'myworkdayjobs.com',
  'smartrecruiters.com',
  'bamboohr.com',
  'rippling.com',
  'recruitee.com',
  'applytojob.com',
  'jobvite.com',
  'taleo.net',
  'icims.com',
  'workable.com',
];

/**
 * Regex matching paths indicative of individual job postings or openings.
 */
const JOB_PATH_REGEX = /\/(?:jobs?|careers?|openings?|positions?|opportunities?)\/[a-zA-Z0-9_\-\.\/]+/i;

/**
 * Regex matching generic non-job action text that needs parent context enhancement.
 */
const GENERIC_BUTTON_TEXT = /^(?:apply|apply now|view job|view role|learn more|details|open|read more)$/i;

/**
 * Clean and normalize a discovered URL by removing analytics parameters.
 */
function cleanJobUrl(rawUrl: string): string {
  try {
    const urlObj = new URL(rawUrl);
    // Strip common tracking and referrer params while keeping essential job identifiers (e.g., gh_jid)
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref', 'source'];
    for (const param of trackingParams) {
      urlObj.searchParams.delete(param);
    }
    // Remove trailing slash for deduplication consistency unless it is the root path
    let pathname = urlObj.pathname;
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    urlObj.pathname = pathname;
    return urlObj.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Discovers and extracts candidate job posting links from a webpage document.
 *
 * Traverses anchor elements, identifies links matching ATS domains or career path
 * structures, dedupes targets, and extracts meaningful descriptive titles.
 *
 * @param doc The Document object to inspect.
 * @param baseUrl The base URL of the active webpage for resolving relative anchors.
 * @returns Array of deduplicated job links with human-readable titles.
 */
export function harvestPageJobLinks(
  doc: Document,
  baseUrl: string
): Array<{ url: string; title: string }> {
  const anchors = Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'));
  const discoveredMap = new Map<string, string>();

  for (const anchor of anchors) {
    const href = anchor.getAttribute('href');
    if (!href) continue;

    const trimmedHref = href.trim();
    if (
      trimmedHref.startsWith('#') ||
      trimmedHref.startsWith('javascript:') ||
      trimmedHref.startsWith('mailto:') ||
      trimmedHref.startsWith('tel:')
    ) {
      continue;
    }

    let absoluteUrl: string;
    try {
      absoluteUrl = new URL(trimmedHref, baseUrl).href;
    } catch {
      continue;
    }

    let parsed: URL;
    try {
      parsed = new URL(absoluteUrl);
    } catch {
      continue;
    }

    // Must be HTTP or HTTPS
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      continue;
    }

    const host = parsed.hostname.toLowerCase();
    const pathname = parsed.pathname;

    const isAtsHost = KNOWN_ATS_HOSTS.some((ats) => host === ats || host.endsWith(`.${ats}`));
    const isJobPath = JOB_PATH_REGEX.test(pathname);

    // If it's neither an ATS host nor a job-specific path, skip
    if (!isAtsHost && !isJobPath) {
      continue;
    }

    const cleanedUrl = cleanJobUrl(absoluteUrl);

    // Extract best human-readable text
    let title = (anchor.textContent || '').replace(/\s+/g, ' ').trim();
    if (!title || GENERIC_BUTTON_TEXT.test(title)) {
      const ariaLabel = anchor.getAttribute('aria-label');
      const attrTitle = anchor.getAttribute('title');
      if (ariaLabel && ariaLabel.trim()) {
        title = ariaLabel.trim();
      } else if (attrTitle && attrTitle.trim()) {
        title = attrTitle.trim();
      } else {
        // Try nearby heading in same card or parent container
        const cardParent = anchor.closest('li, tr, article, [class*="job"], [class*="card"]');
        const heading = cardParent?.querySelector('h1, h2, h3, h4, h5, [class*="title"]');
        if (heading && heading.textContent?.trim()) {
          title = heading.textContent.replace(/\s+/g, ' ').trim();
        } else {
          // Fall back to slug derived from path
          const lastSegment = pathname.split('/').filter(Boolean).pop() || 'Job Opportunity';
          title = decodeURIComponent(lastSegment).replace(/[-_]/g, ' ');
        }
      }
    }

    // Capitalize first letter if it was extracted from slug
    if (title.length > 0) {
      title = title.charAt(0).toUpperCase() + title.slice(1);
    }

    if (!discoveredMap.has(cleanedUrl)) {
      discoveredMap.set(cleanedUrl, title || 'Job Opportunity');
    }
  }

  return Array.from(discoveredMap.entries()).map(([url, title]) => ({ url, title }));
}
