/**
 * @fileoverview Type-safe RPC message dispatcher and listener bridge.
 *
 * Manifest V3 requires asynchronous messaging via chrome.runtime and chrome.tabs.
 * This module abstracts low-level callback mechanisms into typed Promise-based APIs
 * and provides structured error boundary wrapping.
 */

import type { ExtensionRequest, ExtensionResponse } from './contracts.js';

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
>(request: TReq): Promise<TRes> {
  return new Promise((resolve, reject) => {
    if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
      reject(new Error('Chrome runtime messaging API is unavailable in this execution context'));
      return;
    }

    chrome.runtime.sendMessage(request, (response: TRes) => {
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
