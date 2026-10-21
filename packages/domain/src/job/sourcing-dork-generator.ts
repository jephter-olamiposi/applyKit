/**
 * @fileoverview ATS Search Engine Dorks & Direct Endpoint Sourcing Generator.
 *
 * Implements Phase 1 (Sourcing) of the autonomous job application pipeline (ADR-0043, SKILL.md):
 * 1. Generates high-yield platform-specific Google/Bing search dorks targeting ATS career boards
 *    (Ashby, Greenhouse, Lever, Workable, SmartRecruiters, Recruitee, Rippling).
 * 2. Incorporates candidate role families, target technology stacks, and regional/timezone bounds.
 * 3. Provides direct unauthenticated ATS API endpoint templates for automated company board probes.
 * 4. Generates independent company career search dorks that filter out stale job boards (-linkedin, -indeed).
 */

import type { CandidateProfile } from '../candidate/profile.js';

/**
 * Configuration options for generating sourcing search dorks.
 */
export interface SourcingDorkOptions {
  /** Target role families (e.g. ['Senior Backend Engineer', 'Staff Platform Engineer']). */
  readonly roleFamilies?: readonly string[];
  /** Core programming languages or technologies (e.g. ['Go', 'TypeScript', 'Rust']). */
  readonly techStack?: readonly string[];
  /** Sourcing freshness window in days. Defaults to 14 days. */
  readonly freshnessDays?: number;
  /** Custom timezone or regional bounds (e.g. 'EMEA', 'UTC+1', 'CET'). */
  readonly timezoneRegion?: string;
  /** Preferred ATS platforms to generate dorks for. */
  readonly platforms?: readonly AtsPlatformId[];
}

/**
 * Recognized Applicant Tracking System platforms with dedicated career subdomains.
 */
export type AtsPlatformId =
  | 'greenhouse'
  | 'ashby'
  | 'lever'
  | 'workable'
  | 'smartrecruiters'
  | 'recruitee'
  | 'rippling'
  | 'personio'
  | 'teamtailor'
  | 'gem';

/**
 * A single generated search engine dork query with metadata.
 */
export interface SearchDork {
  /** Target ATS platform or search strategy category. */
  readonly category: AtsPlatformId | 'independent_careers' | 'global_remote';
  /** Human-readable description of what this dork surfaces. */
  readonly title: string;
  /** The exact query string to paste into Google, DuckDuckGo, or Bing. */
  readonly query: string;
  /** Direct search URL on Google. */
  readonly searchUrl: string;
}

/**
 * Direct unauthenticated ATS API endpoint definition for an employer.
 */
export interface DirectAtsEndpoint {
  readonly platform: AtsPlatformId;
  readonly platformName: string;
  readonly endpointTemplate: string;
  readonly singleJobTemplate?: string;
  readonly notes: string;
}

/**
 * Registry of direct unauthenticated ATS API endpoints (SKILL.md Phase 1).
 */
export const DIRECT_ATS_REGISTRY: readonly DirectAtsEndpoint[] = [
  {
    platform: 'greenhouse',
    platformName: 'Greenhouse',
    endpointTemplate: 'https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true',
    singleJobTemplate: 'https://boards-api.greenhouse.io/v1/boards/{slug}/jobs/{id}?questions=true',
    notes: 'Unauthenticated JSON API. Use ?questions=true to inspect application form schema before browser navigation.',
  },
  {
    platform: 'ashby',
    platformName: 'Ashby',
    endpointTemplate: 'https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true',
    notes: 'Case-sensitive slugs. Check exact brand casing or lowercase if 404 occurs.',
  },
  {
    platform: 'lever',
    platformName: 'Lever',
    endpointTemplate: 'https://api.lever.co/v0/postings/{slug}?mode=json',
    notes: 'Returns clean JSON array of active postings. HTML pages are also server-rendered.',
  },
  {
    platform: 'workable',
    platformName: 'Workable',
    endpointTemplate: 'https://apply.workable.com/api/v1/widget/accounts/{slug}?details=true',
    singleJobTemplate: 'https://apply.workable.com/api/v2/accounts/{slug}/jobs/{shortcode}',
    notes: 'Fetch from an apply.workable.com active tab context if Cloudflare egress block occurs.',
  },
  {
    platform: 'smartrecruiters',
    platformName: 'SmartRecruiters',
    endpointTemplate: 'https://api.smartrecruiters.com/v1/companies/{slug}/postings',
    notes: 'Paginated via offset query parameter.',
  },
  {
    platform: 'recruitee',
    platformName: 'Recruitee',
    endpointTemplate: 'https://{slug}.recruitee.com/api/offers/',
    notes: 'Many employers alias this under careers.{company_domain}.',
  },
  {
    platform: 'teamtailor',
    platformName: 'Teamtailor',
    endpointTemplate: 'https://{slug}.teamtailor.com/jobs.json',
    notes: 'Public unauthenticated JSON catalog.',
  },
  {
    platform: 'personio',
    platformName: 'Personio',
    endpointTemplate: 'https://{slug}.jobs.personio.de/search.json',
    notes: 'European tech employer standard board.',
  },
  {
    platform: 'rippling',
    platformName: 'Rippling',
    endpointTemplate: 'https://api.rippling.com/platform/api/ats/v1/board/{slug}/jobs',
    notes: 'Modern high-growth tech ATS board.',
  },
  {
    platform: 'gem',
    platformName: 'Gem',
    endpointTemplate: 'https://jobs.gem.com/{slug}',
    notes: 'Client-side rendered; navigate in browser tab to inspect.',
  },
];

/**
 * Standard global remote hiring eligibility phrases (SKILL.md line 69).
 */
const GLOBAL_REMOTE_PHRASES = [
  '"work from anywhere"',
  '"remote worldwide"',
  '"hire anywhere"',
  '"any timezone"',
] as const;

/**
 * Formats a Google search URL from a dork query.
 */
function toGoogleSearchUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/**
 * Computes date string formatted as YYYY-MM-DD for freshness dork filtering.
 */
function getFreshnessDateString(daysAgo: number): string {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Resolves target role families from candidate profile or options.
 */
function resolveRoles(profile?: CandidateProfile | null, options?: SourcingDorkOptions): readonly string[] {
  if (options?.roleFamilies && options.roleFamilies.length > 0) {
    return options.roleFamilies;
  }
  if (profile?.professional?.targetRoles && profile.professional.targetRoles.length > 0) {
    return profile.professional.targetRoles;
  }
  if (profile?.professional?.currentTitle) {
    return [profile.professional.currentTitle];
  }
  return ['Senior Software Engineer', 'Senior Backend Engineer'];
}

/**
 * Resolves primary technical stack from candidate profile or options.
 */
function resolveTechStack(profile?: CandidateProfile | null, options?: SourcingDorkOptions): readonly string[] {
  if (options?.techStack && options.techStack.length > 0) {
    return options.techStack;
  }
  if (profile?.skills && profile.skills.length > 0) {
    return profile.skills.slice(0, 4).map((s) => s.name);
  }
  return ['TypeScript', 'Node.js', 'Go', 'Rust'];
}

/**
 * Generates an array of focused search engine dorks for global remote job sourcing (SKILL.md Phase 1).
 *
 * @param profile Verified candidate profile.
 * @param options Sourcing configuration options.
 * @returns Array of SearchDork items with direct search URLs.
 */
export function generateAtsSearchDorks(
  profile?: CandidateProfile | null,
  options?: SourcingDorkOptions
): readonly SearchDork[] {
  const roles = resolveRoles(profile, options);
  const tech = resolveTechStack(profile, options);
  const freshnessDays = options?.freshnessDays ?? 14;
  const afterDate = getFreshnessDateString(freshnessDays);

  const primaryRole = roles[0] || 'Software Engineer';
  const roleKeywords = roles.slice(0, 2).map((r) => `"${r}"`).join(' OR ');
  const techKeywords = tech.slice(0, 2).map((t) => `"${t}"`).join(' OR ');

  const dorks: SearchDork[] = [];

  // 1. Ashby Global Remote Dork
  const ashbyQuery = `site:jobs.ashbyhq.com (${roleKeywords}) ("work from anywhere" OR "remote worldwide") after:${afterDate}`;
  dorks.push({
    category: 'ashby',
    title: 'Ashby — Worldwide Remote Roles',
    query: ashbyQuery,
    searchUrl: toGoogleSearchUrl(ashbyQuery),
  });

  // 2. Greenhouse Global Remote Dork
  const greenhouseQuery = `site:job-boards.greenhouse.io (${roleKeywords}) ("remote" OR "work from anywhere") (${techKeywords}) after:${afterDate}`;
  dorks.push({
    category: 'greenhouse',
    title: 'Greenhouse — Tech Stack Matched Remote Roles',
    query: greenhouseQuery,
    searchUrl: toGoogleSearchUrl(greenhouseQuery),
  });

  // 3. Lever Any Timezone Dork
  const leverQuery = `site:jobs.lever.co (${roleKeywords}) ("any timezone" OR "remote worldwide" OR "work from anywhere") after:${afterDate}`;
  dorks.push({
    category: 'lever',
    title: 'Lever — Any Timezone & Global Remote',
    query: leverQuery,
    searchUrl: toGoogleSearchUrl(leverQuery),
  });

  // 4. Workable Global Remote Dork
  const workableQuery = `site:apply.workable.com (${roleKeywords}) ("remote" OR "work from anywhere") after:${afterDate}`;
  dorks.push({
    category: 'workable',
    title: 'Workable — Remote Engineering Positions',
    query: workableQuery,
    searchUrl: toGoogleSearchUrl(workableQuery),
  });

  // 5. SmartRecruiters & Recruitee Dork
  const smartRecruiteeQuery = `(site:jobs.smartrecruiters.com OR site:*.recruitee.com) (${roleKeywords}) "remote" after:${afterDate}`;
  dorks.push({
    category: 'smartrecruiters',
    title: 'SmartRecruiters & Recruitee — Remote Roles',
    query: smartRecruiteeQuery,
    searchUrl: toGoogleSearchUrl(smartRecruiteeQuery),
  });

  // 6. Direct Language / Stack Dork (e.g. "golang engineer", "rust engineer")
  const langDorkPhrases = tech.slice(0, 3).map((t) => `"${t.toLowerCase()} engineer"`).join(' OR ');
  const stackDorkQuery = `(site:jobs.ashbyhq.com OR site:job-boards.greenhouse.io OR site:jobs.lever.co) (${langDorkPhrases}) ("remote" OR "work from anywhere") after:${afterDate}`;
  dorks.push({
    category: 'global_remote',
    title: 'Language-Specific Role Dork (Captures Unlabeled Titles)',
    query: stackDorkQuery,
    searchUrl: toGoogleSearchUrl(stackDorkQuery),
  });

  // 7. Independent Careers Pages Dork (Bypasses Aggregators)
  const independentQuery = `(inurl:careers OR inurl:jobs) "${primaryRole}" ("work from anywhere" OR "remote worldwide") -linkedin -indeed -glassdoor -wellfound after:${afterDate}`;
  dorks.push({
    category: 'independent_careers',
    title: 'Direct Company Career Pages (Excludes Stale Aggregators)',
    query: independentQuery,
    searchUrl: toGoogleSearchUrl(independentQuery),
  });

  return dorks;
}

/**
 * Builds the direct API endpoint URL for an employer given their ATS platform and company slug.
 *
 * @param platform The ATS platform identifier.
 * @param companySlug The employer's career board slug (e.g. 'stripe', 'vercel').
 * @returns Fully qualified API URL string.
 */
export function buildDirectAtsApiUrl(platform: AtsPlatformId, companySlug: string): string {
  const cleanSlug = companySlug.trim().replace(/^\/+|\/+$/g, '');
  const entry = DIRECT_ATS_REGISTRY.find((e) => e.platform === platform);
  if (!entry) {
    throw new Error(`Unsupported ATS platform: ${platform}`);
  }
  return entry.endpointTemplate.replace('{slug}', cleanSlug);
}
