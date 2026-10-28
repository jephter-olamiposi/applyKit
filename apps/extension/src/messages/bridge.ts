/**
 * @fileoverview Type-safe RPC message dispatcher and listener bridge.
 *
 * Manifest V3 requires asynchronous messaging via chrome.runtime and chrome.tabs.
 * This module abstracts low-level callback mechanisms into typed Promise-based APIs
 * and provides structured error boundary wrapping.
 */

import type { ExtensionRequest, ExtensionResponse } from './contracts.js';

/**
 * Requests that may call an AI model, which can take a draft plus a corrected draft per
 * question. With the old flat 20 seconds the panel reported a timeout while the answer
 * was still on its way. Each value covers the worst case the service worker allows.
 */
const SLOW_REQUEST_TIMEOUTS_MS: Partial<Record<ExtensionRequest['type'], number>> = {
  ANSWER_AD_HOC_QUESTION: 120_000,
  ANSWER_CUSTOM_FIELDS: 180_000,
  EXECUTE_ONE_CLICK_AUTO_FILL: 180_000,
  REWORD_RESUME_WITH_AI: 90_000,
  MATCH_JOB_REQUIREMENTS: 60_000,
  SET_API_KEY: 30_000,
  CHECK_API_KEY: 30_000,
};

/** A plain-language message for a request that ran out of time. */
function timeoutMessage(type: string): string {
  return SLOW_REQUEST_TIMEOUTS_MS[type as ExtensionRequest['type']]
    ? 'The AI took too long to answer. Check your connection and try again.'
    : `ApplyKit did not answer in time (${type}). Try again.`;
}

/**
 * Sends a typed request message to the Extension Service Worker background context.
 *
 * @param request The structured request conforming to {@link ExtensionRequest}.
 * @returns Promise resolving to the expected typed response.
 * @throws Error if chrome.runtime reports a communication failure or timeout.
 */
export async function sendToBackground<
  TReq extends ExtensionRequest = ExtensionRequest,
  TRes extends ExtensionResponse = ExtensionResponse
>(request: TReq, timeoutMs = SLOW_REQUEST_TIMEOUTS_MS[request.type] ?? 20000): Promise<TRes> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      const fallback = handleWebPreviewFallback(request);
      if (fallback !== undefined) {
        resolve(fallback as TRes);
        return;
      }
      reject(new Error('Chrome runtime messaging API is unavailable in this execution context'));
      return;
    }

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(timeoutMessage(request.type)));
      }
    }, timeoutMs);

    chrome.runtime.sendMessage(request, (response: TRes) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message ?? 'Unknown error occurred in background messaging'));
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Sends a typed request message directly to a content script in a specific browser tab.
 *
 * @param tabId Target tab identifier.
 * @param request The structured request conforming to {@link ExtensionRequest}.
 * @returns Promise resolving to the expected typed response.
 * @throws Error if tab messaging fails or the content script has not loaded.
 */
export async function sendToTab<
  TReq extends ExtensionRequest = ExtensionRequest,
  TRes extends ExtensionResponse = ExtensionResponse
>(tabId: number, request: TReq): Promise<TRes> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.tabs.sendMessage) {
      reject(new Error('Chrome tabs messaging API is unavailable in this execution context'));
      return;
    }

    chrome.tabs.sendMessage(tabId, request, (response: TRes) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message ?? `Failed to send message to tab ${tabId}`));
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Handler signature for an individual RPC message type.
 */
export type MessageHandler<TReq extends ExtensionRequest, TRes extends ExtensionResponse> = (
  request: TReq,
  sender: chrome.runtime.MessageSender
) => Promise<TRes> | TRes;

/**
 * Type-safe registry mapping message `type` discriminators to specific handlers.
 */
export type MessageHandlerMap = {
  [K in ExtensionRequest['type']]?: MessageHandler<
    Extract<ExtensionRequest, { type: K }>,
    ExtensionResponse
  >;
};

/**
 * Attaches a type-safe listener to `chrome.runtime.onMessage`.
 *
 * Chrome MV3 requires synchronous return of `true` from the listener callback
 * whenever the response will be sent asynchronously via `sendResponse`.
 *
 * @param handlers Map of message type discriminators to handler functions.
 * @returns Cleanup function that removes the listener.
 */
export function registerMessageRouter(handlers: MessageHandlerMap): () => void {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.onMessage) {
    return () => {
      // No-op in environments where chrome.runtime is not available (e.g. non-extension unit tests)
    };
  }

  const listener = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ): boolean | undefined => {
    if (!message || typeof message !== 'object' || !('type' in message)) {
      return undefined;
    }

    const typedMessage = message as ExtensionRequest;
    const handler = handlers[typedMessage.type];

    if (!handler) {
      return undefined;
    }

    try {
      const result = (handler as MessageHandler<ExtensionRequest, ExtensionResponse>)(
        typedMessage,
        sender
      );

      if (result instanceof Promise) {
        result
          .then((res) => sendResponse(res))
          .catch((err) => {
            console.error(`Message handler failed for type ${typedMessage.type}:`, err);
            sendResponse({
              type: 'ERROR',
              error: err instanceof Error ? err.message : String(err),
            });
          });
        // Invariant: Return true synchronously so Chrome keeps the message channel open for async response
        return true;
      }

      sendResponse(result);
      return undefined;
    } catch (err) {
      console.error(`Synchronous message handler error for type ${typedMessage.type}:`, err);
      sendResponse({
        type: 'ERROR',
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  };

  chrome.runtime.onMessage.addListener(listener);

  return () => {
    chrome.runtime.onMessage.removeListener(listener);
  };
}

/**
 * Emulates background RPC handler responses when running in standalone web preview mode.
 */
function handleWebPreviewFallback(request: ExtensionRequest): ExtensionResponse | undefined {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return undefined;
  }
  const storage = window.localStorage;

  switch (request.type) {
    case 'GET_CANDIDATE_PROFILE': {
      const raw = storage.getItem('applykit_preview_profile');
      return { profile: raw ? JSON.parse(raw) : null } as ExtensionResponse;
    }
    case 'SAVE_CANDIDATE_PROFILE': {
      const profile = (request as unknown as { profile: unknown }).profile;
      storage.setItem('applykit_preview_profile', JSON.stringify(profile));
      return { success: true, profile } as unknown as ExtensionResponse;
    }
    case 'SET_API_KEY': {
      // Security invariant (ADR-0002): the web preview has no service worker and
      // therefore no isolated credential boundary. Never persist provider secrets here.
      return {
        type: 'SET_API_KEY_RESULT',
        success: false,
        provider: (request as unknown as { provider: string }).provider,
        error: 'API keys can only be stored inside the installed extension.',
      } as unknown as ExtensionResponse;
    }
    case 'GET_CURRENT_EXTRACTION': {
      return {
        type: 'CURRENT_EXTRACTION_RESULT',
        data: null,
        jobPosting: {
          id: 'preview_job_1' as unknown,
          url: 'https://careers.tether.io/o/senior-nodejs-software-engineer',
          title: 'Senior Node.js Software Engineer',
          companyName: 'Tether / Holepunch',
          location: 'Remote - Worldwide',
          workplaceType: 'remote',
          employmentType: 'full_time',
          requirements: [
            { id: 'req_1' as unknown, rawText: '7+ years production Node.js and distributed systems', category: 'hard_skill', importance: 'must_have' },
            { id: 'req_2' as unknown, rawText: 'Experience building modular npm modules', category: 'hard_skill', importance: 'must_have' },
          ],
          extractedAt: new Date().toISOString(),
          description: 'Join Tether and build P2P decentralized systems.',
        },
      } as unknown as ExtensionResponse;
    }
    case 'EXPORT_BACKUP': {
      const raw = storage.getItem('applykit_preview_profile');
      return {
        type: 'EXPORT_BACKUP_RESULT',
        success: true,
        jsonString: JSON.stringify({
          profile: raw ? JSON.parse(raw) : null,
          exportedAt: new Date().toISOString(),
        }),
      } as unknown as ExtensionResponse;
    }
    case 'PURGE_ALL_DATA': {
      storage.removeItem('applykit_preview_profile');
      return { success: true, purgedCount: 1 } as unknown as ExtensionResponse;
    }
    default:
      return undefined;
  }
}

