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
import {
  highlightTargetElement,
  clearTargetHighlight,
  renderInPageReviewBadges,
  removeInPageReviewBadges,
} from './in-page-inspector.js';
import type {
  ExtractJobResponse,
  PingResponse,
  InspectPageFormsResponse,
  ExecuteContentPlanResponse,
  HighlightFormFieldResponse,
  ClearFormFieldHighlightResponse,
  ToggleInPageReviewBadgesResponse,
} from '../messages/contracts.js';

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object' || !('type' in message)) {
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
      try {
        const forms = inspectPageForms(document);
        const response: InspectPageFormsResponse = {
          type: 'INSPECT_PAGE_FORMS_RESULT',
          success: true,
          forms: [...forms],
        };
        sendResponse(response);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const failureResponse: InspectPageFormsResponse = {
          type: 'INSPECT_PAGE_FORMS_RESULT',
          success: false,
          forms: [],
          error: errorMsg,
        };
        sendResponse(failureResponse);
      }
      return false;
    }

    if (requestType === 'EXECUTE_CONTENT_PLAN') {
      const planReq = message as { plan: any; options?: any };
      executeBrowserPlan(planReq.plan, document, planReq.options)
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
      sendResponse(response);
      return false;
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
      sendResponse(response);
      return false;
    }

    if (requestType === 'INSERT_TEXT_INTO_ACTIVE_ELEMENT') {
      const payload = message as { text: string };
      const success = insertTextIntoActiveElement(payload.text, document);
      sendResponse({
        type: 'INSERT_TEXT_INTO_ACTIVE_ELEMENT_RESULT',
        success,
      });
      return false;
    }

    return false;
  });
}

export * from './extractor.js';
export * from './adapters/index.js';
export * from './normalizer.js';
export * from './form-crawler.js';
export * from './action-interpreter.js';
export * from './in-page-inspector.js';
