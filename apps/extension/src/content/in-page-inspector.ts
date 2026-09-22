/**
 * @fileoverview In-Page Form Field Inspector & Visual Review Overlay.
 *
 * Implements interactive visual synchronization between the Side Panel and live webpage:
 * 1. Synchronized attention focus highlights with smooth scrolling.
 * 2. Floating in-page attention callouts for active candidate review.
 * 3. In-page review badges displaying candidate data previews directly beside form inputs.
 * 4. Non-invasive lifecycle management: 100% clean teardown with zero residual DOM markers.
 */

import type { DryRunPlan } from '@applykit/domain';

const STYLESHEET_ID = 'applykit-inpage-styles';
const CALLOUT_CLASS = 'applykit-focus-callout';
const PREVIEW_BADGE_CLASS = 'applykit-preview-badge';

/**
 * References currently highlighted element and its original style attributes.
 */
interface ActiveHighlight {
  element: HTMLElement;
  originalOutline: string;
  originalOutlineOffset: string;
  originalBoxShadow: string;
  originalTransition: string;
  calloutElement?: HTMLElement;
}

let currentHighlight: ActiveHighlight | null = null;

/**
 * Ensures the ApplyKit in-page style tag is attached to the document head.
 *
 * @param doc Target document.
 */
function ensureStylesInjected(doc: Document): void {
  if (doc.getElementById(STYLESHEET_ID)) return;

  const style = doc.createElement('style');
  style.id = STYLESHEET_ID;
  style.textContent = `
    .${CALLOUT_CLASS} {
      position: absolute;
      z-index: 2147483647;
      background: #1e293b;
      color: #f8fafc;
      border: 1px solid #3b82f6;
      border-radius: 6px;
      padding: 4px 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 11px;
      font-weight: 600;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      pointer-events: none;
      transform: translateY(-100%);
      margin-top: -6px;
      white-space: nowrap;
      transition: opacity 0.2s ease;
    }
    .${PREVIEW_BADGE_CLASS} {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(16, 185, 129, 0.15);
      border: 1px solid rgba(16, 185, 129, 0.4);
      color: #10b981;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      font-size: 10px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
      margin-left: 6px;
      vertical-align: middle;
      pointer-events: none;
      z-index: 1000;
    }
  `;
  doc.head.appendChild(style);
}

/**
 * Clears any active element highlight and removes floating callout elements.
 *
 * @param doc Target document.
 */
export function clearTargetHighlight(doc: Document): void {
  if (currentHighlight) {
    const { element, originalOutline, originalOutlineOffset, originalBoxShadow, originalTransition, calloutElement } = currentHighlight;

    element.style.outline = originalOutline;
    element.style.outlineOffset = originalOutlineOffset;
    element.style.boxShadow = originalBoxShadow;
    element.style.transition = originalTransition;

    if (calloutElement && calloutElement.parentElement) {
      calloutElement.remove();
    }

    currentHighlight = null;
  }

  // Cleanup any orphaned callouts
  const orphaned = doc.querySelectorAll(`.${CALLOUT_CLASS}`);
  orphaned.forEach((node) => node.remove());
}

/**
 * Highlights a specific form field on the live webpage and brings it into visual focus.
 *
 * Dispatched when the candidate hovers or focuses on an action card in the Side Panel UI.
 *
 * @param doc Target document.
 * @param selector CSS selector of the target input element.
 * @param label Optional description or field label for the callout tooltip.
 * @returns True if element was located and highlighted, false otherwise.
 */
export function highlightTargetElement(
  doc: Document,
  selector: string,
  label?: string
): boolean {
  clearTargetHighlight(doc);

  const element = doc.querySelector<HTMLElement>(selector);
  if (!element) return false;

  ensureStylesInjected(doc);

  const originalOutline = element.style.outline;
  const originalOutlineOffset = element.style.outlineOffset;
  const originalBoxShadow = element.style.boxShadow;
  const originalTransition = element.style.transition;

  element.style.outline = '3px solid #3b82f6';
  element.style.outlineOffset = '3px';
  element.style.boxShadow = '0 0 14px rgba(59, 130, 246, 0.4)';
  element.style.transition = 'outline 0.2s ease, box-shadow 0.2s ease';

  if (typeof element.scrollIntoView === 'function') {
    try {
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      // Ignore scroll failures in headless or isolated frames
    }
  }

  let calloutElement: HTMLElement | undefined;

  if (label && doc.body) {
    calloutElement = doc.createElement('div');
    calloutElement.className = CALLOUT_CLASS;
    calloutElement.textContent = `ApplyKit: ${label}`;

    // Position relative to target element if bounding rect is available
    if (typeof element.getBoundingClientRect === 'function') {
      const rect = element.getBoundingClientRect();
      const scrollTop = window.scrollY || doc.documentElement.scrollTop || 0;
      const scrollLeft = window.scrollX || doc.documentElement.scrollLeft || 0;

      calloutElement.style.top = `${rect.top + scrollTop}px`;
      calloutElement.style.left = `${rect.left + scrollLeft}px`;
      doc.body.appendChild(calloutElement);
    }
  }

  currentHighlight = {
    element,
    originalOutline,
    originalOutlineOffset,
    originalBoxShadow,
    originalTransition,
    calloutElement,
  };

  return true;
}

/**
 * Injects in-page preview badges beside all planned inputs on the active webpage,
 * displaying the candidate value staged for insertion.
 *
 * @param doc Target document.
 * @param plan Active DryRunPlan.
 * @returns Number of preview badges successfully mounted.
 */
export function renderInPageReviewBadges(doc: Document, plan: DryRunPlan): number {
  removeInPageReviewBadges(doc);
  ensureStylesInjected(doc);

  let mountedCount = 0;

  for (const action of plan.actions) {
    const element = doc.querySelector<HTMLElement>(action.action.selector);
    if (!element) continue;

    const badge = doc.createElement('span');
    badge.className = PREVIEW_BADGE_CLASS;
    badge.setAttribute('data-applykit-preview-id', action.id);
    badge.textContent = `&#10003; ${action.candidateValueUsed || action.action.description}`;

    if (element.parentElement) {
      // Position adjacent to the target element
      element.parentElement.insertBefore(badge, element.nextSibling);
      mountedCount++;
    }
  }

  return mountedCount;
}

/**
 * Removes all in-page candidate preview badges and style elements from the active document.
 *
 * @param doc Target document.
 */
export function removeInPageReviewBadges(doc: Document): void {
  const badges = doc.querySelectorAll(`.${PREVIEW_BADGE_CLASS}`);
  badges.forEach((node) => node.remove());

  const styleTag = doc.getElementById(STYLESHEET_ID);
  if (styleTag) {
    styleTag.remove();
  }
}
