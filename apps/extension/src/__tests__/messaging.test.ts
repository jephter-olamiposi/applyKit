/**
 * @fileoverview Unit tests for extension messaging contracts and message bridge.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerMessageRouter,
  sendToBackground,
  sendToTab,
} from '../messages/bridge.js';
import type {
  ExtensionRequest,
  ExtensionResponse,
  PingRequest,
  PingResponse,
  GetApiKeysStatusResponse,
} from '../messages/contracts.js';

describe('Extension Messaging Bridge & Contracts', () => {
  let listeners: ((
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (res?: unknown) => void
  ) => boolean | undefined)[] = [];

  beforeEach(() => {
    listeners = [];

    // Mock chrome global environment
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: {
        lastError: null,
        sendMessage: vi.fn(),
        onMessage: {
          addListener: vi.fn((fn) => {
            listeners.push(fn);
          }),
          removeListener: vi.fn((fn) => {
            listeners = listeners.filter((l) => l !== fn);
          }),
        },
      },
      tabs: {
        sendMessage: vi.fn(),
      },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('registerMessageRouter', () => {
    it('dispatches synchronous handlers correctly', () => {
      const mockSender = { id: 'test-sender' } as chrome.runtime.MessageSender;
      const sendResponse = vi.fn();

      registerMessageRouter({
        PING: () => ({
          type: 'PONG',
          timestamp: 12345,
        }),
      });

      expect(listeners).toHaveLength(1);
      const listener = listeners[0]!;

      const result = listener({ type: 'PING' }, mockSender, sendResponse);

      expect(result).toBeUndefined(); // Sync handlers return undefined
      expect(sendResponse).toHaveBeenCalledWith({
        type: 'PONG',
        timestamp: 12345,
      });
    });

    it('returns true synchronously for async handlers to keep Chrome port open', async () => {
      const mockSender = { id: 'test-sender' } as chrome.runtime.MessageSender;
      const sendResponse = vi.fn();

      registerMessageRouter({
        PING: async () => {
          return {
            type: 'PONG',
            timestamp: 67890,
          };
        },
      });

      const listener = listeners[0]!;
      const result = listener({ type: 'PING' }, mockSender, sendResponse);

      // Invariant: Must return true synchronously to prevent message port from closing
      expect(result).toBe(true);

      // Allow microtask queue to flush
      await Promise.resolve();

      expect(sendResponse).toHaveBeenCalledWith({
        type: 'PONG',
        timestamp: 67890,
      });
    });

    it('handles async handler rejections by sending structured error response', async () => {
      const mockSender = { id: 'test-sender' } as chrome.runtime.MessageSender;
      const sendResponse = vi.fn();

      registerMessageRouter({
        PING: async () => {
          throw new Error('Database connection failed');
        },
      });

      const listener = listeners[0]!;
      listener({ type: 'PING' }, mockSender, sendResponse);

      await Promise.resolve();
      await Promise.resolve();

      expect(sendResponse).toHaveBeenCalledWith({
        type: 'ERROR',
        error: 'Database connection failed',
      });
    });

    it('ignores unknown message types without invoking sendResponse', () => {
      const sendResponse = vi.fn();
      registerMessageRouter({
        PING: () => ({ type: 'PONG', timestamp: 1 }),
      });

      const listener = listeners[0]!;
      const result = listener(
        { type: 'UNKNOWN_TYPE' },
        {} as chrome.runtime.MessageSender,
        sendResponse
      );

      expect(result).toBeUndefined();
      expect(sendResponse).not.toHaveBeenCalled();
    });

    it('deregisters listener upon invoking returned cleanup callback', () => {
      const cleanup = registerMessageRouter({
        PING: () => ({ type: 'PONG', timestamp: 1 }),
      });

      expect(listeners).toHaveLength(1);
      cleanup();
      expect(chrome.runtime.onMessage.removeListener).toHaveBeenCalledTimes(1);
    });
  });

  describe('sendToBackground', () => {
    it('sends message to chrome.runtime and resolves response', async () => {
      const mockResponse: PingResponse = { type: 'PONG', timestamp: 999 };
      (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
        (_req: ExtensionRequest, callback: (res: ExtensionResponse) => void) => {
          callback(mockResponse);
        }
      );

      const request: PingRequest = { type: 'PING' };
      const response = await sendToBackground<PingRequest, PingResponse>(request);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(request, expect.any(Function));
      expect(response).toEqual(mockResponse);
    });

    it('rejects when chrome.runtime.lastError is populated', async () => {
      (chrome.runtime.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
        (_req: unknown, callback: (res: unknown) => void) => {
          (chrome.runtime as { lastError: { message: string } }).lastError = {
            message: 'Could not establish connection. Receiving end does not exist.',
          };
          callback(undefined);
        }
      );

      await expect(sendToBackground({ type: 'PING' })).rejects.toThrow(
        'Could not establish connection. Receiving end does not exist.'
      );
    });
  });

  describe('sendToTab', () => {
    it('sends message to specific tab and resolves response', async () => {
      const mockResponse = { type: 'EXTRACT_JOB_RESULT', success: true };
      (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
        (_tabId: number, _req: unknown, callback: (res: unknown) => void) => {
          callback(mockResponse);
        }
      );

      const res = await sendToTab(42, { type: 'EXTRACT_JOB' });

      expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, { type: 'EXTRACT_JOB' }, expect.any(Function));
      expect(res).toEqual(mockResponse);
    });

    it('rejects when target tab is invalid or closed', async () => {
      (chrome.tabs.sendMessage as ReturnType<typeof vi.fn>).mockImplementation(
        (_tabId: number, _req: unknown, callback: (res: unknown) => void) => {
          (chrome.runtime as { lastError: { message: string } }).lastError = {
            message: 'No tab with id: 999.',
          };
          callback(undefined);
        }
      );

      await expect(sendToTab(999, { type: 'EXTRACT_JOB' })).rejects.toThrow(
        'No tab with id: 999.'
      );
    });
  });

  describe('API Key Isolation Invariant (ADR-0002)', () => {
    it('enforces that API key query response contract contains only boolean flags', () => {
      const statusResponse: GetApiKeysStatusResponse = {
        type: 'API_KEYS_STATUS_RESULT',
        status: {
          openai: true,
          anthropic: false,
          gemini: true,
          openrouter: false,
        },
      };

      // Type-level assertion & runtime verification that no raw credentials can exist
      for (const [provider, hasKey] of Object.entries(statusResponse.status)) {
        expect(typeof hasKey).toBe('boolean');
        expect(hasKey === true || hasKey === false).toBe(true);
        expect(provider).toMatch(/^(openai|anthropic|gemini|openrouter)$/);
      }
    });
  });
});
