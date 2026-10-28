/**
 * @fileoverview Content-script side of the React dropdown bridge.
 *
 * Both form entry points (the side panel's scan and the on-page "Fill this form"
 * button) need dropdown options tagged before they crawl, and the fill step needs the
 * page-world picker. See background/page-widgets.ts for why this goes through the
 * service worker.
 */

import type { PageHooks } from './action-interpreter.js';

/**
 * Asks the service worker to tag React dropdowns on this page with their options.
 * Resolves after at most 1.5s either way, so a missing worker never blocks a scan.
 */
export function annotatePageWidgetsOnce(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 1500);
    try {
      chrome.runtime.sendMessage({ type: 'ANNOTATE_PAGE_WIDGETS' }, () => {
        void chrome.runtime.lastError;
        clearTimeout(timer);
        resolve();
      });
    } catch {
      clearTimeout(timer);
      resolve();
    }
  });
}

/** Page-world helpers handed to the action interpreter. */
export const pageHooks: PageHooks = {
  pickPageOption: (selector, wanted) =>
    new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'PICK_PAGE_WIDGET_OPTION', selector, wanted },
        (res?: { success?: boolean; chosenLabel?: string; error?: string }) => {
          const lastError = chrome.runtime.lastError;
          if (lastError || !res) {
            resolve({ ok: false, reason: lastError?.message ?? 'no answer' });
            return;
          }
          resolve({ ok: Boolean(res.success), chosenLabel: res.chosenLabel, reason: res.error });
        }
      );
    }),
};
