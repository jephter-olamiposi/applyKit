/**
 * @fileoverview Automated ATS Submission Detector Engine (Phase 20, ADR-0032).
 *
 * Listens for post-submission ATS confirmation URLs and DOM signals to automatically
 * transition in-progress application journeys to 'submitted' without user manual friction:
 * 1. Monitored ATS Confirmation Patterns: Greenhouse, Lever, Workday, Ashby, SmartRecruiters, etc.
 * 2. DOM Confirmation Heading Signatures: "Thank you for applying", "Application received".
 * 3. Immutable State Transition: Transitions application from 'awaiting_user_review' /
 *    'ready_to_fill' / 'dry_run_review' -> 'submitted', stamping the exact timestamp.
 *
 * Invariant (ADR-0006): ApplyKit is programmatically forbidden from clicking submit buttons.
 * This detector solely observes post-submission ATS redirects triggered by the candidate.
 */

import type { ApplicationRecord, ApplicationState } from '@applykit/domain';
import { transitionApplicationRecord } from '@applykit/domain';
import { getApplicationRepository } from '../storage/application-repository.js';

/**
 * Result of inspecting a URL for post-submission confirmation signals.
 */
export interface SubmissionUrlMatch {
  readonly isConfirmation: boolean;
  readonly atsType?: string;
}

/**
 * Known ATS post-submission path signatures.
 */
const ATS_CONFIRMATION_PATTERNS: ReadonlyArray<{
  readonly ats: string;
  readonly regex: RegExp;
}> = [
  { ats: 'greenhouse', regex: /boards\.greenhouse\.io\/.*\/confirmation/i },
  { ats: 'greenhouse', regex: /job-boards\.greenhouse\.io\/.*\/confirmation/i },
  { ats: 'greenhouse', regex: /greenhouse\.io\/.*\/confirmation/i },
  { ats: 'lever', regex: /jobs\.lever\.co\/.*\/thanks/i },
  { ats: 'workday', regex: /\.myworkdayjobs\.com\/.*(?:\/applied|\/thankyou|\/thank-you)/i },
  { ats: 'workday', regex: /workday\.com\/.*(?:\/applied|\/thankyou)/i },
  { ats: 'ashby', regex: /jobs\.ashbyhq\.com\/.*\/application-submitted/i },
  { ats: 'smartrecruiters', regex: /smartrecruiters\.com\/.*(?:\/thank-you|\/success)/i },
  { ats: 'recruitee', regex: /\.recruitee\.com\/.*\/thank_you/i },
  { ats: 'taleo', regex: /taleo\.net\/.*(?:\/confirmation|\/thankyou)/i },
  { ats: 'icims', regex: /\.icims\.com\/.*(?:\/confirmation|\/thanks)/i },
  { ats: 'canonical', regex: /canonical\.com\/careers\/.*(?:\/confirmation|\/thank-you|\/thanks)/i },
  // Generic confirmation path patterns
  { ats: 'generic', regex: /\/(?:application-submitted|application_submitted|applied|thank-you|thank_you|thanks|confirmation)(?:\/|\?|$)/i },
];

/**
 * DOM text headings and titles that signify successful job application receipt.
 */
const CONFIRMATION_TEXT_PATTERNS: ReadonlyArray<RegExp> = [
  /thank\s+you\s+for\s+applying/i,
  /application\s+(?:has\s+been\s+)?(?:received|submitted|complete)/i,
  /thanks\s+for\s+applying/i,
  /your\s+application\s+(?:was|is)\s+(?:received|submitted)/i,
  /we(?:'ve|\s+have)\s+received\s+your\s+application/i,
  /application\s+confirmation/i,
];

/**
 * Evaluates whether a given URL matches known ATS confirmation / thank-you destinations.
 *
 * @param url Full or relative URL to evaluate.
 * @returns Detection result with detected ATS name.
 */
export function isSubmissionConfirmationUrl(url?: string): SubmissionUrlMatch {
  if (!url || typeof url !== 'string') {
    return { isConfirmation: false };
  }

  for (const pattern of ATS_CONFIRMATION_PATTERNS) {
    if (pattern.regex.test(url)) {
      return { isConfirmation: true, atsType: pattern.ats };
    }
  }

  return { isConfirmation: false };
}

/**
 * Evaluates whether page text or document title signals a completed application submission.
 *
 * @param text Title or prominent heading string.
 * @returns True if confirmation phrasing matches.
 */
export function isSubmissionConfirmationText(text?: string): boolean {
  if (!text || typeof text !== 'string') {
    return false;
  }

  return CONFIRMATION_TEXT_PATTERNS.some((pattern) => pattern.test(text.trim()));
}

/**
 * Extracts the base hostname from a URL for domain-level application correlation.
 */
function extractHostname(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch {
    return '';
  }
}

/**
 * Processes a detected submission confirmation event, correlating it with active application records.
 *
 * If a matching in-progress application is identified, advances its state to 'submitted'
 * with the exact confirmation timestamp and updates IndexedDB.
 *
 * @param url Current browser page URL.
 * @param pageTitle Optional page title or heading text for secondary verification.
 * @param detectedAts Optional ATS vendor name.
 * @returns Status transition summary.
 */
export async function processSubmissionDetection(
  url: string,
  pageTitle?: string,
  detectedAts?: string
): Promise<{
  success: boolean;
  applicationId?: string;
  previousStatus?: ApplicationState;
  newStatus?: ApplicationState;
  alreadySubmitted?: boolean;
  error?: string;
}> {
  const urlMatch = isSubmissionConfirmationUrl(url);
  const textMatch = isSubmissionConfirmationText(pageTitle);

  // Require at least URL match or strong DOM text match
  if (!urlMatch.isConfirmation && !textMatch) {
    return {
      success: false,
      error: 'URL or title did not match confirmation patterns',
    };
  }

  const atsType = urlMatch.atsType || detectedAts || 'generic';
  const repository = getApplicationRepository();
  const applications = await repository.listApplications(50);

  if (applications.length === 0) {
    return {
      success: false,
      error: 'No active application records available to correlate',
    };
  }

  const currentHost = extractHostname(url);

  // Find most recent application matching the domain or currently awaiting user review / in progress
  const candidateApp = applications.find((app) => {
    const appHost = extractHostname(app.jobPostingUrl);
    const hostMatches = currentHost && appHost && (currentHost.includes(appHost) || appHost.includes(currentHost));
    const isPending =
      app.currentStatus === 'awaiting_user_review' ||
      app.currentStatus === 'ready_to_fill' ||
      app.currentStatus === 'dry_run_review' ||
      app.currentStatus === 'executing_actions';

    return (hostMatches && isPending) || (hostMatches && app.currentStatus !== 'archived' && app.currentStatus !== 'rejected');
  }) || applications.find((app) => app.currentStatus === 'awaiting_user_review');

  if (!candidateApp) {
    return {
      success: false,
      error: 'No matching in-progress application found for current domain',
    };
  }

  // If already submitted, no transition needed
  if (candidateApp.currentStatus === 'submitted') {
    return {
      success: true,
      applicationId: candidateApp.id,
      previousStatus: 'submitted',
      newStatus: 'submitted',
      alreadySubmitted: true,
    };
  }

  const previousStatus = candidateApp.currentStatus;
  const now = new Date().toISOString();

  try {
    const updated = transitionApplicationRecord(
      candidateApp,
      'submitted',
      `Automated ${atsType} post-submission confirmation detected at ${url}`,
      { appliedAt: candidateApp.appliedAt || now }
    );

    await repository.saveApplication(updated);

    return {
      success: true,
      applicationId: candidateApp.id,
      previousStatus,
      newStatus: 'submitted',
    };
  } catch (err) {
    return {
      success: false,
      applicationId: candidateApp.id,
      previousStatus,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
