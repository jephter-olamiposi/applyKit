/**
 * @fileoverview Works out which saved job an application form belongs to.
 *
 * The extension used to assume the form was for the last job the candidate read. A
 * candidate who tailors for Monzo, then Mercury, then goes back to apply to Monzo had the
 * Monzo application logged as Mercury, and Mercury's details used to draft Monzo's answers.
 * This looks at the form's address instead and only falls back to the last job read when
 * the address says nothing about the company.
 */

import type { JobPosting } from './job-posting.js';

/** ATS hosts whose first path segment is the company's board name. */
const SLUG_IN_PATH_HOSTS = [
  /(^|\.)greenhouse\.io$/,
  /(^|\.)lever\.co$/,
  /(^|\.)ashbyhq\.com$/,
  /(^|\.)workable\.com$/,
  /(^|\.)smartrecruiters\.com$/,
  /(^|\.)breezy\.hr$/,
];

/** ATS hosts whose first subdomain is the company ("monzo.recruitee.com"). */
const SLUG_IN_SUBDOMAIN_HOSTS = [/\.recruitee\.com$/, /\.myworkdayjobs\.com$/, /\.bamboohr\.com$/, /\.teamtailor\.com$/, /\.workable\.com$/, /\.breezy\.hr$/];

/** Path segments that are never a company board name. */
const NOT_A_SLUG = new Set(['embed', 'job_app', 'jobs', 'j', 'o', 'apply', 'careers', 'v1', 'api', 'en', 'en-us']);

/** Lowercase letters and digits only, for comparing names written different ways. */
function compact(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parse(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

/** Address without query, hash, trailing slash, or a final apply step. */
function basePath(url: URL): string {
  return `${url.host}${url.pathname}`.replace(/\/+$/, '').replace(/\/(apply|application|applications?\/new)$/i, '').toLowerCase();
}

/**
 * The company board name an ATS address carries, if any:
 * "boards.greenhouse.io/northwind/jobs/1" -> "northwind", "monzo.recruitee.com" -> "monzo".
 * Greenhouse embeds pass it as "?for=northwind".
 */
export function companySlugFromUrl(url: string): string | undefined {
  const parsed = parse(url);
  if (!parsed) return undefined;
  const host = parsed.hostname.toLowerCase();
  const forParam = parsed.searchParams.get('for');
  if (forParam && /greenhouse\.io$/.test(host)) return compact(forParam) || undefined;
  if (SLUG_IN_PATH_HOSTS.some((pattern) => pattern.test(host))) {
    const segment = parsed.pathname.split('/').find((part) => part && !NOT_A_SLUG.has(part.toLowerCase()));
    if (segment && !/^\d+$/.test(segment)) return compact(segment) || undefined;
  }
  if (SLUG_IN_SUBDOMAIN_HOSTS.some((pattern) => pattern.test(host))) {
    const sub = host.split('.')[0];
    if (sub && !['www', 'apply', 'jobs', 'careers', 'boards', 'job-boards'].includes(sub)) return compact(sub) || undefined;
  }
  return undefined;
}

/** True when a company slug and a company name plausibly name the same employer. */
function sameCompany(slug: string, companyName: string): boolean {
  const name = compact(companyName);
  if (!name || !slug) return false;
  return name === slug || name.startsWith(slug) || slug.startsWith(name);
}

export interface JobForPage {
  /** The saved job this page belongs to, or null when none can be told apart. */
  readonly job: JobPosting | null;
  /** How it was decided, for logs and tests. */
  readonly reason:
    | 'same_page'
    | 'company_in_address'
    | 'company_in_title'
    | 'last_job_read'
    | 'last_job_is_another_company'
    | 'no_jobs';
  /** The company board name in the address, if any. */
  readonly companySlug?: string;
  /** A display name for the company the page names, for a tracker label when no job matched. */
  readonly companyLabel?: string;
}

/** Host labels that never name the employer. */
const GENERIC_HOST_LABELS = new Set(['www', 'careers', 'career', 'jobs', 'job', 'apply', 'boards', 'hire', 'talent', 'work', 'join', 'recruiting', 'com', 'co', 'io', 'org', 'net', 'ai', 'dev', 'app', 'uk', 'ng', 'de', 'eu', 'us']);

/** True when the page's own host carries the company name ("careers.monzo.com"). */
function hostNamesCompany(url: URL | undefined, companyName: string): boolean {
  if (!url) return false;
  const name = compact(companyName);
  if (name.length < 3) return false;
  return url.hostname
    .toLowerCase()
    .split('.')
    .filter((label) => !GENERIC_HOST_LABELS.has(label))
    .some((label) => {
      const flat = compact(label);
      return flat === name || (flat.length >= 4 && (flat.startsWith(name) || name.startsWith(flat)));
    });
}

/** True when the page title names the company as a whole word or phrase. */
function titleNamesCompany(title: string, companyName: string): boolean {
  const name = companyName.trim();
  if (name.length < 2) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w])${escaped}($|[^\\w])`, 'i').test(title);
}

/**
 * The company a page title says the job is at: "Job Application for Backend Engineer at
 * Northwind Payments" -> "Northwind Payments". Only the explicit "at X" form is trusted.
 */
export function companyFromPageTitle(title: string): string | undefined {
  const match = title.match(/\bat\s+([A-Z0-9][\w&.'-]*(?:\s+[A-Z0-9][\w&.'-]*){0,4})\s*(?:$|[|\-–—:(,])/);
  return match?.[1]?.trim();
}

/**
 * Picks the saved job a form page belongs to.
 *
 * 1. A saved job at the same address, or one the form address extends ("/apply").
 * 2. The most recent saved job whose company matches the board name in an ATS address,
 *    or the company's own host ("careers.monzo.com").
 * 3. A saved job whose company the page title names; a title that names another company
 *    ("... at Northwind") means no saved job.
 * 4. The last job read, when neither the address nor the title names a company.
 *
 * @param pageUrl The form's address.
 * @param savedJobs Saved jobs, most recent first.
 * @param lastJob The last job the candidate read.
 * @param pageTitle The form page's title, when known.
 */
export function pickJobForPage(
  pageUrl: string,
  savedJobs: readonly JobPosting[],
  lastJob: JobPosting | null | undefined,
  pageTitle = ''
): JobForPage {
  const page = parse(pageUrl);
  const slug = companySlugFromUrl(pageUrl);
  const jobs = lastJob ? [lastJob, ...savedJobs.filter((job) => job.id !== lastJob.id)] : [...savedJobs];
  if (jobs.length === 0) return { job: null, reason: 'no_jobs', ...(slug ? { companySlug: slug } : {}) };

  if (page) {
    const pageBase = basePath(page);
    const samePage = jobs.find((job) => {
      const jobUrl = parse(job.url);
      if (!jobUrl) return false;
      const jobBase = basePath(jobUrl);
      return jobBase === pageBase || pageBase.startsWith(`${jobBase}/`);
    });
    if (samePage) return { job: samePage, reason: 'same_page', ...(slug ? { companySlug: slug } : {}) };
  }

  if (slug) {
    const byCompany = jobs.find((job) => sameCompany(slug, job.companyName));
    if (byCompany) return { job: byCompany, reason: 'company_in_address', companySlug: slug, companyLabel: byCompany.companyName };
    return { job: null, reason: 'last_job_is_another_company', companySlug: slug, companyLabel: labelFromSlug(slug) };
  }

  // A company's own careers site: "careers.monzo.com".
  const byHost = jobs.find((job) => hostNamesCompany(page, job.companyName));
  if (byHost) return { job: byHost, reason: 'company_in_address', companyLabel: byHost.companyName };

  // The page title: "Job Application for Backend Engineer at Monzo".
  const title = pageTitle.trim();
  if (title) {
    const byTitle = jobs.find((job) => titleNamesCompany(title, job.companyName));
    if (byTitle) return { job: byTitle, reason: 'company_in_title', companyLabel: byTitle.companyName };
    const named = companyFromPageTitle(title);
    if (named) return { job: null, reason: 'last_job_is_another_company', companyLabel: named };
  }

  return lastJob ? { job: lastJob, reason: 'last_job_read' } : { job: null, reason: 'no_jobs' };
}

/** "northwind" -> "Northwind", for a tracker label when no saved job matched. */
export function labelFromSlug(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/**
 * The role a page title names: "Job Application for Senior Backend Engineer at Northwind"
 * -> "Senior Backend Engineer". Only "<role> at <company>" titles are read.
 */
export function roleFromPageTitle(title: string): string | undefined {
  const match = title
    .replace(/^\s*(?:job application|application|apply)\s+(?:for|to)\s+/i, '')
    .match(/^(.{3,90}?)\s+at\s+[A-Z0-9]/);
  const role = match?.[1]?.replace(/^[\s|:-]+|[\s|:-]+$/g, '').trim();
  return role && !/^(jobs?|careers?|apply|application)$/i.test(role) ? role : undefined;
}
