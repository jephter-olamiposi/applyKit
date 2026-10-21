/**
 * @fileoverview Multi-Board ATS API Feed Harvester, Normalizer, and Screening Engine.
 *
 * Implements Phase 1 (Sourcing) & Phase 2 (Verify) of the autonomous job application pipeline (SKILL.md):
 * 1. Queries unauthenticated direct ATS endpoints (Greenhouse, Ashby, Lever) for candidate target companies.
 * 2. Normalizes divergent ATS schemas into canonical SourcedOpportunity records.
 * 3. Immediately subjects every discovered job to the 5-Gate Qualification Waterfall.
 * 4. Partitions surviving opportunities into Expected-Value (EV) priority tiers.
 *
 * Invariant: Zero external runtime dependencies. Strict local evaluation against candidate profile facts.
 */

import type { CandidateProfile } from '../candidate/profile.js';
import type { EmploymentPreference, WorkplacePreference } from '../candidate/professional.js';
import type { JobPosting } from './job-posting.js';
import type { JobPostingEmploymentType, WorkplaceType } from './job-posting.js';
import { createJobPostingId } from '../types/ids.js';
import { verifyJobEligibility } from './eligibility-verifier.js';

/**
 * Supported ATS platforms with unauthenticated public board APIs.
 */
export type SourcedPlatformId = 'greenhouse' | 'ashby' | 'lever' | 'workable' | 'smartrecruiters' | 'custom';

/**
 * Expected-Value (EV) priority tier category for opportunities.
 */
export type OpportunityTier =
  | 'tier1_high_ev'
  | 'tier2_competitive'
  | 'tier3_conditional'
  | 'tier4_low_or_blocked';

/**
 * Canonical normalized job opportunity retrieved from an ATS board or search results.
 */
export interface SourcedOpportunity {
  /** Stable unique identifier (e.g. 'greenhouse_123456', 'ashby_uuid'). */
  readonly id: string;
  /** Name of the hiring company. */
  readonly employer: string;
  /** Official job title. */
  readonly title: string;
  /** Direct URL to the job posting / application page. */
  readonly url: string;
  /** Verbatim location string from the ATS. */
  readonly locationText: string;
  /** Normalized workplace type when the source provides enough evidence. */
  readonly workplaceType?: WorkplaceType;
  /** Normalized employment type when the source provides enough evidence. */
  readonly employmentType?: JobPostingEmploymentType;
  /** Verbatim compensation string if published by the employer. */
  readonly compensationText?: string;
  /** Underlying ATS platform hosting the posting. */
  readonly sourcePlatform: SourcedPlatformId;
  /** ISO timestamp when the job was posted or last modified. */
  readonly postedAt?: string;
  /** Department or team name if specified. */
  readonly department?: string;
  /** Clean plain text description snippet for screening. */
  readonly descriptionSnippet?: string;
  /** 5-Gate Qualification Verdict (OPEN, CONDITIONAL, BLOCKED). */
  readonly verdict?: 'OPEN' | 'CONDITIONAL' | 'BLOCKED';
  /** Fatal gate identifier if blocked (e.g. 'geography', 'work_authorization'). */
  readonly fatalGate?: string;
  /** Verbatim sentence from employer page proving any disqualification. */
  readonly verbatimEvidence?: string;
  /** Calculated alignment percentage (0-100) against candidate profile. */
  readonly matchScore?: number;
  /** Expected-Value priority tier. */
  readonly tier?: OpportunityTier;
}

/**
 * Pre-configured target company on a direct ATS platform.
 */
export interface WatchlistCompany {
  readonly name: string;
  readonly slug: string;
  readonly platform: 'greenhouse' | 'ashby' | 'lever';
  readonly category: 'infra_devtools' | 'ai_ml' | 'fintech' | 'saas_cloud' | 'remote_first';
}

/**
 * Curated directory of remote-friendly tech employers hiring on Greenhouse, Ashby, and Lever.
 */
export const DEFAULT_WATCHLIST_COMPANIES: readonly WatchlistCompany[] = [
  // Ashby Platforms
  { name: 'Linear', slug: 'linear', platform: 'ashby', category: 'infra_devtools' },
  { name: 'Vercel', slug: 'vercel', platform: 'ashby', category: 'infra_devtools' },
  { name: 'Supabase', slug: 'supabase', platform: 'ashby', category: 'infra_devtools' },
  { name: 'Ramp', slug: 'ramp', platform: 'ashby', category: 'fintech' },
  { name: 'PostHog', slug: 'posthog', platform: 'ashby', category: 'infra_devtools' },
  { name: 'PlanetScale', slug: 'planetscale', platform: 'ashby', category: 'infra_devtools' },
  { name: 'Mistral AI', slug: 'mistralai', platform: 'ashby', category: 'ai_ml' },
  { name: 'Synthesia', slug: 'synthesia', platform: 'ashby', category: 'ai_ml' },

  // Greenhouse Platforms
  { name: 'Stripe', slug: 'stripe', platform: 'greenhouse', category: 'fintech' },
  { name: 'GitLab', slug: 'gitlab', platform: 'greenhouse', category: 'remote_first' },
  { name: 'Remote', slug: 'remotecom', platform: 'greenhouse', category: 'remote_first' },
  { name: 'Figma', slug: 'figma', platform: 'greenhouse', category: 'saas_cloud' },
  { name: 'Datadog', slug: 'datadog', platform: 'greenhouse', category: 'infra_devtools' },
  { name: 'Retool', slug: 'retool', platform: 'greenhouse', category: 'infra_devtools' },
  { name: 'Zapier', slug: 'zapier', platform: 'greenhouse', category: 'remote_first' },
  { name: 'Sourcegraph', slug: 'sourcegraph', platform: 'greenhouse', category: 'infra_devtools' },
  { name: 'dbt Labs', slug: 'dbtlabs', platform: 'greenhouse', category: 'infra_devtools' },
  { name: 'Docker', slug: 'docker', platform: 'greenhouse', category: 'infra_devtools' },
  { name: 'Grafana Labs', slug: 'grafanalabs', platform: 'greenhouse', category: 'infra_devtools' },

  // Lever Platforms
  { name: 'Anthropic', slug: 'anthropic', platform: 'lever', category: 'ai_ml' },
];

/**
 * Normalizes Greenhouse public JSON payload (`boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true`).
 */
export function normalizeGreenhouseJobs(
  rawJson: any,
  companyName: string
): SourcedOpportunity[] {
  if (!rawJson || !Array.isArray(rawJson.jobs)) {
    return [];
  }

  const results: SourcedOpportunity[] = [];
  for (const job of rawJson.jobs) {
    if (!job || !job.title || !job.id) continue;

    const rawContent = typeof job.content === 'string' ? job.content : '';
    const cleanSnippet = stripHtmlTags(rawContent).slice(0, 500);

    results.push({
      id: `gh_${job.id}`,
      employer: companyName,
      title: String(job.title).trim(),
      url: job.absolute_url || `https://boards.greenhouse.io/jobs/${job.id}`,
      locationText: job.location?.name?.trim() || 'Remote',
      workplaceType: inferWorkplaceType(`${job.location?.name || ''} ${rawContent}`),
      employmentType: inferEmploymentType(`${job.title} ${rawContent}`),
      compensationText: undefined,
      sourcePlatform: 'greenhouse',
      postedAt: job.updated_at,
      department: job.departments?.[0]?.name,
      descriptionSnippet: cleanSnippet,
    });
  }
  return results;
}

/**
 * Normalizes Ashby public JSON payload (`api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`).
 */
export function normalizeAshbyJobs(
  rawJson: any,
  companyName: string,
  slug?: string
): SourcedOpportunity[] {
  if (!rawJson || !Array.isArray(rawJson.jobs)) {
    return [];
  }

  const results: SourcedOpportunity[] = [];
  for (const job of rawJson.jobs) {
    if (!job || !job.title || !job.id) continue;

    const compensationText = job.compensation?.compensationSummary || undefined;
    const cleanSnippet = typeof job.descriptionPlain === 'string'
      ? job.descriptionPlain.slice(0, 500)
      : stripHtmlTags(job.descriptionHtml || '').slice(0, 500);

    const jobUrl = job.jobUrl || (slug ? `https://jobs.ashbyhq.com/${slug}/${job.id}` : '');

    results.push({
      id: `ashby_${job.id}`,
      employer: companyName,
      title: String(job.title).trim(),
      url: jobUrl,
      locationText: job.location || (Array.isArray(job.secondaryLocations) ? job.secondaryLocations.join(', ') : 'Remote'),
      workplaceType: inferWorkplaceType(`${job.location || ''} ${job.descriptionPlain || job.descriptionHtml || ''}`),
      employmentType: inferEmploymentType(`${job.title} ${job.descriptionPlain || job.descriptionHtml || ''}`),
      compensationText,
      sourcePlatform: 'ashby',
      postedAt: job.publishedAt,
      department: job.department,
      descriptionSnippet: cleanSnippet,
    });
  }
  return results;
}

/**
 * Normalizes Lever public JSON payload (`api.lever.co/v0/postings/{slug}?mode=json`).
 */
export function normalizeLeverJobs(
  rawJson: any,
  companyName: string
): SourcedOpportunity[] {
  if (!Array.isArray(rawJson)) {
    return [];
  }

  const results: SourcedOpportunity[] = [];
  for (const job of rawJson) {
    if (!job || !job.text || !job.id) continue;

    const cleanSnippet = typeof job.descriptionPlain === 'string'
      ? job.descriptionPlain.slice(0, 500)
      : stripHtmlTags(job.description || '').slice(0, 500);

    results.push({
      id: `lever_${job.id}`,
      employer: companyName,
      title: String(job.text).trim(),
      url: job.hostedUrl || job.applyUrl || '',
      locationText: job.categories?.location || 'Remote',
      workplaceType: inferWorkplaceType(`${job.categories?.location || ''} ${job.descriptionPlain || job.description || ''}`),
      employmentType: inferEmploymentType(`${job.text} ${job.descriptionPlain || job.description || ''}`),
      compensationText: job.salaryDescription || undefined,
      sourcePlatform: 'lever',
      postedAt: job.createdAt ? new Date(job.createdAt).toISOString() : undefined,
      department: job.categories?.department || job.categories?.team,
      descriptionSnippet: cleanSnippet,
    });
  }
  return results;
}

/**
 * Screens and ranks a batch of sourced opportunities against candidate profile.
 * Applies role relevance filtering, 5-gate qualification evaluation, and EV tiering.
 */
export function screenSourcedOpportunities(
  opportunities: readonly SourcedOpportunity[],
  profile: CandidateProfile,
  preferences?: {
    readonly workplacePreference?: WorkplacePreference;
    readonly employmentPreference?: EmploymentPreference;
  }
): SourcedOpportunity[] {
  const targetRoles = profile.professional.targetRoles.map((r) => r.toLowerCase());
  const candidateSkills = profile.skills.map((s) => s.normalizedName.toLowerCase());
  const workplacePreference = preferences?.workplacePreference ?? profile.professional.workplacePreference;
  const employmentPreference = preferences?.employmentPreference ?? profile.professional.employmentPreference;

  const screened: SourcedOpportunity[] = [];

  for (const opp of opportunities) {
    if (!matchesWorkplacePreference(opp, workplacePreference)) continue;
    if (!matchesEmploymentPreference(opp, employmentPreference)) continue;
    const titleLower = opp.title.toLowerCase();
    const snippetLower = (opp.descriptionSnippet || '').toLowerCase();
    const fullTextLower = `${titleLower} ${snippetLower}`;

    // 1. Calculate Keyword & Role Alignment Score (0-100)
    let matchScore = 50; // Base score for relevant job in tech watchlist

    // Check target role alignment
    const roleMatches = targetRoles.some((tr) => titleLower.includes(tr) || tr.split(' ').every((w) => titleLower.includes(w)));
    if (roleMatches) {
      matchScore += 30;
    } else if (titleLower.includes('engineer') || titleLower.includes('developer')) {
      matchScore += 10;
    }

    // Check skill keyword hits
    let skillHits = 0;
    for (const skill of candidateSkills) {
      if (skill.length > 2 && fullTextLower.includes(skill)) {
        skillHits++;
      }
    }
    matchScore = Math.min(100, matchScore + Math.min(20, skillHits * 5));

    // 2. Synthesize lightweight JobPosting for 5-Gate evaluation
    const mockPosting: JobPosting = {
      id: createJobPostingId(opp.id),
      companyName: opp.employer,
      title: opp.title,
      location: opp.locationText,
      workplaceType:
        opp.workplaceType ||
        inferWorkplaceType(`${opp.locationText} ${opp.descriptionSnippet || ''}`) ||
        'onsite',
      employmentType: opp.employmentType || inferEmploymentType(`${opp.title} ${opp.descriptionSnippet || ''}`) || 'full_time',
      rawDescription: `${opp.title}\n${opp.locationText}\n${opp.descriptionSnippet || ''}`,
      requirements: [],
      url: opp.url,
      parsedAt: new Date().toISOString(),
      metadata: { ats: opp.sourcePlatform },
    };

    // Missing source classification is never treated as an eligible match. The
    // synthetic posting is still evaluated for other gates, but the opportunity
    // remains conditional until the candidate verifies the missing metadata.
    const eligibility = verifyJobEligibility(mockPosting, profile);
    const hasUnknownClassification = !opp.workplaceType || !opp.employmentType;
    const effectiveVerdict = hasUnknownClassification && eligibility.verdict === 'OPEN'
      ? 'CONDITIONAL'
      : eligibility.verdict;

    // 4. Determine Expected-Value (EV) Tier
    let tier: OpportunityTier;
    if (effectiveVerdict === 'BLOCKED') {
      tier = 'tier4_low_or_blocked';
    } else if (effectiveVerdict === 'CONDITIONAL') {
      tier = 'tier3_conditional';
    } else if (matchScore >= 80) {
      tier = 'tier1_high_ev';
    } else {
      tier = 'tier2_competitive';
    }

    screened.push({
      ...opp,
      verdict: effectiveVerdict,
      fatalGate: eligibility.fatalGate,
      verbatimEvidence: eligibility.verbatimEvidence,
      matchScore,
      tier,
    });
  }

  // Sort by priority tier, then match score descending
  const tierWeight: Record<OpportunityTier, number> = {
    tier1_high_ev: 4,
    tier2_competitive: 3,
    tier3_conditional: 2,
    tier4_low_or_blocked: 1,
  };

  return screened.sort((a, b) => {
    const weightDiff = (tierWeight[b.tier || 'tier4_low_or_blocked'] || 0) - (tierWeight[a.tier || 'tier4_low_or_blocked'] || 0);
    if (weightDiff !== 0) return weightDiff;
    return (b.matchScore || 0) - (a.matchScore || 0);
  });
}

/**
 * Strips HTML tags from raw job board descriptions.
 */
function stripHtmlTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function inferWorkplaceType(text: string): WorkplaceType | undefined {
  const normalized = text.toLowerCase();
  if (/\bhybrid\b/.test(normalized)) return 'hybrid';
  if (/\b(remote|work from anywhere|distributed team)\b/.test(normalized)) return 'remote';
  if (/\b(on[- ]?site|in office|office based)\b/.test(normalized)) return 'onsite';
  return undefined;
}

function inferEmploymentType(text: string): JobPostingEmploymentType | undefined {
  const normalized = text.toLowerCase();
  if (/\b(intern(ship)?|co[- ]?op)\b/.test(normalized)) return 'internship';
  if (/\b(contract|contractor|freelance)\b/.test(normalized)) return 'contract';
  if (/\bpart[- ]?time\b/.test(normalized)) return 'part_time';
  if (/\bfull[- ]?time\b/.test(normalized)) return 'full_time';
  return undefined;
}

function matchesWorkplacePreference(
  opportunity: SourcedOpportunity,
  preference: WorkplacePreference | undefined
): boolean {
  if (!preference || preference === 'any' || preference === 'flexible') return true;
  return opportunity.workplaceType === undefined || opportunity.workplaceType === preference;
}

function matchesEmploymentPreference(
  opportunity: SourcedOpportunity,
  preference: EmploymentPreference | undefined
): boolean {
  if (!preference || preference === 'any') return true;
  return opportunity.employmentType === undefined || opportunity.employmentType === preference;
}
