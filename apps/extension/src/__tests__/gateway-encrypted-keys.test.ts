/**
 * @fileoverview A key saved through Settings must be usable by the AI gateway.
 *
 * Settings stores keys AES-GCM encrypted. The gateway used to read the stored value
 * directly, got an encrypted object instead of a string, and every AI request failed
 * with "trim is not a function". Found by running the built extension end to end.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import { setApiKey } from '../storage/credential-store.js';
import { AIGateway } from '../ai/gateway.js';

describe('AIGateway with keys saved through Settings', () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = {};
    (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB = indexedDB;
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn(async (key?: string | string[]) => {
            const keys = key === undefined ? Object.keys(store) : Array.isArray(key) ? key : [key];
            return Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]]));
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(store, items);
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            for (const k of Array.isArray(keys) ? keys : [keys]) delete store[k];
          }),
        },
      },
    };
  });

  it('decrypts the saved key and picks that provider', async () => {
    await setApiKey('gemini', 'test-gemini-key');
    // The stored value really is encrypted, not the plain key.
    expect(JSON.stringify(store)).not.toContain('test-gemini-key');

    const gateway = new AIGateway();
    const { name } = await gateway.resolveActiveProvider();
    expect(name).toBe('gemini');
    expect(await gateway.getApiKey('gemini')).toBe('test-gemini-key');
  });

  it('says plainly when no key is set', async () => {
    await expect(new AIGateway().resolveActiveProvider()).rejects.toThrow(/No AI provider configured/);
  });
});
