/**
 * @fileoverview Shared runtime message senders for extension tests.
 *
 * The background router authorizes messages by sender context: privileged requests must
 * arrive from an extension page, never from a content script's tab. Tests must therefore
 * emulate a real sender instead of passing an empty object.
 */

export const TEST_EXTENSION_ID = 'test-extension-id';

/** Sender for privileged calls originating from the side panel or options page. */
export const EXTENSION_PAGE_SENDER = {
  id: TEST_EXTENSION_ID,
  url: `chrome-extension://${TEST_EXTENSION_ID}/sidepanel.html`,
} as chrome.runtime.MessageSender;

/** Sender for calls made by the isolated content script running in a web tab. */
export function contentScriptSender(tabId = 1): chrome.runtime.MessageSender {
  return {
    id: TEST_EXTENSION_ID,
    tab: { id: tabId } as chrome.tabs.Tab,
    url: 'https://jobs.example.com/apply',
  };
}
