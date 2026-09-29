/**
 * @fileoverview Content Script ATS Submission Confirmation Observer (Phase 20, ADR-0032).
 *
 * Runs in the webpage context to detect when the candidate has successfully submitted
 * an application on the ATS and reached the confirmation / thank-you view:
 * 1. Checks URL against known ATS thank-you patterns.
 * 2. Scans page headings (<h1>, <h2>, <title>) for confirmation phrases.
 * 3. Sends SUBMISSION_DETECTED RPC to background service worker to auto-advance pipeline.
 *
 * Invariant (ADR-0006): Read-only observation. Never triggers form submission.
 */

import type { SubmissionDetectedNotification, SubmissionDetectedResponse } from '../messages/contracts.js';

let hasReportedSubmission = false;

/**
 * Checks whether text matches common application confirmation headers.
 */
function isConfirmationHeading(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  return (
    normalized.includes('thank you for applying') ||
    normalized.includes('application received') ||
    normalized.includes('application submitted') ||
    normalized.includes('thanks for applying') ||
    normalized.includes('your application has been received') ||
    normalized.includes('we received your application') ||
    normalized.includes('application complete')
  );
}

/**
 * Inspects the current page DOM and URL for post-submission confirmation signals.
 */
export function inspectPageForSubmissionConfirmation(): boolean {
  if (hasReportedSubmission) {
    return false;
  }

  const url = window.location.href;

  // Check URL pathname
  const isUrlConfirmation =
    url.includes('/confirmation') ||
    url.includes('/thanks') ||
    url.includes('/applied') ||
    url.includes('/thankyou') ||
    url.includes('/thank-you') ||
    url.includes('/application-submitted') ||
    url.includes('/application_submitted');

  // Check Document Title and Headings
  let isTextConfirmation = isConfirmationHeading(document.title || '');

  if (!isTextConfirmation) {
    const headings = document.querySelectorAll('h1, h2, h3, [role="heading"]');
    for (const h of Array.from(headings)) {
      if (h.textContent && isConfirmationHeading(h.textContent)) {
        isTextConfirmation = true;
        break;
      }
    }
  }

  if (isUrlConfirmation || isTextConfirmation) {
    hasReportedSubmission = true;

    const message: SubmissionDetectedNotification = {
      type: 'SUBMISSION_DETECTED',
      url,
      title: document.title || '',
    };

    try {
      chrome.runtime.sendMessage(message, (res: SubmissionDetectedResponse) => {
        if (chrome.runtime.lastError) {
          // Extension context may be reloading or inactive
          return;
        }
        if (res && res.success) {
          // Notify In-Page Hub if present
          window.dispatchEvent(
            new CustomEvent('applykit:application-submitted', {
              detail: { applicationId: res.applicationId, newStatus: res.newStatus },
            })
          );
        }
      });
    } catch {
      // Ignore IPC context errors in decoupled iframe contexts
    }

    return true;
  }

  return false;
}

/**
 * Initializes the submission observer on page load and monitors SPA DOM mutations.
 */
export function initSubmissionObserver(): void {
  // 1. Initial check on document load
  inspectPageForSubmissionConfirmation();

  // 2. Observe dynamic SPA route transitions
  if (typeof MutationObserver !== 'undefined') {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const observer = new MutationObserver(() => {
      if (hasReportedSubmission) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        inspectPageForSubmissionConfirmation();
      }, 500);
    });

    observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
    });
  }
}
