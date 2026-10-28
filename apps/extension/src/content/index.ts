/**
 * @fileoverview Isolated-world content script entry point.
 *
 * Runs directly in the context of host webpages. Programmatically forbidden
 * from accessing API keys or initiating external AI requests.
 */

import { extractPageData } from './extractor.js';
import { extractStructuredJob } from './adapters/index.js';
import { inspectPageForms } from './form-crawler.js';
import { executeBrowserPlan, insertTextIntoActiveElement } from './action-interpreter.js';
import { annotatePageWidgetsOnce, pageHooks } from './page-widget-bridge.js';
import {
  highlightTargetElement,
  clearTargetHighlight,
  renderInPageReviewBadges,
  removeInPageReviewBadges,
} from './in-page-inspector.js';
import {
  initInPageHub,
  unmountInPageHub,
} from './in-page-hub.js';
import { initSubmissionObserver, destroySubmissionObserver } from './submission-observer.js';
import { harvestPageJobLinks } from './link-harvester.js';
import { isJobOrApplicationPage, shouldShowApplyHub } from './page-context.js';
import type {
  ExtractJobResponse,
  PingResponse,
  InspectPageFormsResponse,
  ExecuteContentPlanResponse,
  HighlightFormFieldResponse,
  ClearFormFieldHighlightResponse,
  ToggleInPageReviewBadgesResponse,
  HarvestPageLinksResponse,
} from '../messages/contracts.js';
import { isValidExtensionRequest } from '../messages/contracts.js';

/**
 * Whether this instance runs in the tab's top-level document.
 *
 * The script is injected into every frame so application forms nested inside an
 * iframe can still be inspected and filled, but the floating hub is a per-tab
 * affordance and must not appear once per frame.
 */
const IS_TOP_FRAME = (() => {
  try {
    return window.top === window;
  } catch {
    // Cross-origin ancestors make `window.top` unreadable; treat as a nested frame.
    return false;
  }
})();

/**
 * The script runs in every frame, and Chrome takes the first frame that answers a tab
 * message. A Greenhouse page carries a reCAPTCHA frame, so that frame often answered
 * first: "no form on this page" while the form was right there, or a job read from the
 * captcha's "Content" heading. Now a frame with nothing to offer stays silent, and the
 * top frame waits briefly before giving an empty answer so a frame that does have the
 * form wins.
 */
function answerFromBestFrame<T>(hasResult: boolean, sendResponse: (response: T) => void, response: T): boolean {
  if (hasResult) {
    sendResponse(response);
    return false;
  }
  if (!IS_TOP_FRAME) return false;
  setTimeout(() => sendResponse(response), 350);
  return true;
}

/** True when a plan was built from the form in this frame's document. */
function planBelongsToThisFrame(formUrl: unknown): boolean {
  if (typeof formUrl !== 'string' || !formUrl) return IS_TOP_FRAME;
  const strip = (url: string) => url.split('#')[0];
  return strip(formUrl) === strip(window.location.href);
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isValidExtensionRequest(message)) {
      return false;
    }

    const requestType = (message as { type: string }).type;

    if (requestType === 'PING') {
      const pong: PingResponse = {
        type: 'PONG',
        timestamp: Date.now(),
      };
      sendResponse(pong);
      return false;
    }

    if (requestType === 'EXTRACT_JOB') {
      // The job posting is the page itself, never an embedded frame (captcha, video, map).
      if (!IS_TOP_FRAME) return false;
      try {
        const data = extractPageData(document, window.location.href);
        const jobPosting = extractStructuredJob(document, window.location.href);

        const response: ExtractJobResponse = {
          type: 'EXTRACT_JOB_RESULT',
          success: true,
          data,
          jobPosting,
        };
        sendResponse(response);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const failureResponse: ExtractJobResponse = {
          type: 'EXTRACT_JOB_RESULT',
          success: false,
          error: errorMsg,
        };
        sendResponse(failureResponse);
      }
      return false;
    }

    if (requestType === 'INSPECT_PAGE_FORMS') {
      const respond = () => {
        try {
          const forms = inspectPageForms(document);
          const response: InspectPageFormsResponse = {
            type: 'INSPECT_PAGE_FORMS_RESULT',
            success: true,
            forms: [...forms],
          };
          answerFromBestFrame(forms.length > 0, sendResponse, response);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const failureResponse: InspectPageFormsResponse = {
            type: 'INSPECT_PAGE_FORMS_RESULT',
            success: false,
            forms: [],
            error: errorMsg,
          };
          if (IS_TOP_FRAME) sendResponse(failureResponse);
        }
      };
      // React dropdowns only reveal their options to page code, so ask the service
      // worker to tag them first. A slow or failed tag still lets the scan run.
      annotatePageWidgetsOnce().finally(respond);
      return true;
    }

    if (requestType === 'EXECUTE_CONTENT_PLAN') {
      const planReq = message as { plan: any; options?: any };
      // Only the frame the form was read from fills it; the others stay silent so their
      // empty report cannot reach the side panel first.
      if (!planBelongsToThisFrame(planReq.plan?.formUrl)) return false;
      executeBrowserPlan(planReq.plan, document, planReq.options, pageHooks)
        .then((report) => {
          const response: ExecuteContentPlanResponse = {
            type: 'EXECUTE_CONTENT_PLAN_RESULT',
            success: true,
            report,
          };
          sendResponse(response);
        })
        .catch((err) => {
          const errorMsg = err instanceof Error ? err.message : String(err);
          const failureResponse: ExecuteContentPlanResponse = {
            type: 'EXECUTE_CONTENT_PLAN_RESULT',
            success: false,
            error: errorMsg,
          };
          sendResponse(failureResponse);
        });
      return true;
    }

    if (requestType === 'HIGHLIGHT_FORM_FIELD') {
      const payload = message as { selector: string; label?: string };
      const success = highlightTargetElement(document, payload.selector, payload.label);
      const response: HighlightFormFieldResponse = {
        type: 'HIGHLIGHT_FORM_FIELD_RESULT',
        success,
      };
      return answerFromBestFrame(success, sendResponse, response);
    }

    if (requestType === 'CLEAR_FORM_FIELD_HIGHLIGHT') {
      clearTargetHighlight(document);
      const response: ClearFormFieldHighlightResponse = {
        type: 'CLEAR_FORM_FIELD_HIGHLIGHT_RESULT',
        success: true,
      };
      sendResponse(response);
      return false;
    }

    if (requestType === 'TOGGLE_IN_PAGE_REVIEW_BADGES') {
      const payload = message as { enabled: boolean; plan?: any };
      let count = 0;
      if (payload.enabled && payload.plan) {
        count = renderInPageReviewBadges(document, payload.plan);
      } else {
        removeInPageReviewBadges(document);
      }
      const response: ToggleInPageReviewBadgesResponse = {
        type: 'TOGGLE_IN_PAGE_REVIEW_BADGES_RESULT',
        success: true,
        count,
      };
      return answerFromBestFrame(count > 0 || !payload.enabled, sendResponse, response);
    }

    if (requestType === 'INSERT_TEXT_INTO_ACTIVE_ELEMENT') {
      const payload = message as { text: string };
      const success = insertTextIntoActiveElement(payload.text, document);
      return answerFromBestFrame(success, sendResponse, {
        type: 'INSERT_TEXT_INTO_ACTIVE_ELEMENT_RESULT',
        success,
      });
    }

    if (requestType === 'TOGGLE_IN_PAGE_HUB') {
      const payload = message as { enabled: boolean };
      if (payload.enabled) {
        if (IS_TOP_FRAME && shouldShowApplyHub(document, window.location.href)) initInPageHub(document);
      } else {
        unmountInPageHub(document);
        destroySubmissionObserver();
      }
      sendResponse({
        type: 'TOGGLE_IN_PAGE_HUB_RESULT',
        success: true,
      });
      return false;
    }

    if (requestType === 'HARVEST_PAGE_LINKS') {
      if (!IS_TOP_FRAME) return false;
      try {
        const links = harvestPageJobLinks(document, window.location.href);
        const response: HarvestPageLinksResponse = {
          type: 'HARVEST_PAGE_LINKS_RESULT',
          success: true,
          links,
        };
        sendResponse(response);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const failureResponse: HarvestPageLinksResponse = {
          type: 'HARVEST_PAGE_LINKS_RESULT',
          success: false,
          links: [],
          error: errorMsg,
        };
        sendResponse(failureResponse);
      }
      return false;
    }

    return false;
  });
}

// Automatically mount In-Page Floating Hub and Submission Observer
if (typeof document !== 'undefined' && typeof window !== 'undefined') {
  let lastPageUrl = window.location.href;
  // The "Fill this form" bar shows only while an application form is on the page. It
  // used to show on every job or careers page, including listings and search results.
  // Forms often appear after load (an "Apply" click, a Lever /apply step, an embedded
  // Greenhouse frame), so the check repeats while the page is open.
  const syncApplyHub = () => {
    if (!IS_TOP_FRAME) return;
    if (shouldShowApplyHub(document, window.location.href)) {
      initInPageHub(document);
    } else {
      unmountInPageHub(document);
    }
  };
  const syncInPageAssistant = () => {
    syncApplyHub();
    if (IS_TOP_FRAME && isJobOrApplicationPage(document, window.location.href)) initSubmissionObserver();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      syncInPageAssistant();
    });
  } else {
    syncInPageAssistant();
  }

  let ticks = 0;
  window.setInterval(() => {
    ticks += 1;
    if (window.location.href !== lastPageUrl) {
      lastPageUrl = window.location.href;
      syncInPageAssistant();
    } else if (ticks % 2 === 0 && !document.hidden) {
      syncApplyHub();
    }
  }, 1000);
}

export * from './extractor.js';
export * from './adapters/index.js';
export * from './normalizer.js';
export * from './form-crawler.js';
export * from './action-interpreter.js';
export * from './in-page-inspector.js';
export * from './in-page-hub.js';
export * from './submission-observer.js';
export * from './link-harvester.js';
