/**
 * @fileoverview Secure AI Provider Credential Store.
 *
 * Enforces strict API key isolation (ADR-0002):
 * - Provider API keys reside exclusively in `chrome.storage.local`.
 * - Content scripts and host webpages never receive or inspect raw API keys.
 * - Outbound RPC queries return boolean flags (`ApiKeysStatus`), never secrets.
 */

import type { AIProviderName } from '@applykit/domain';
import type { ApiKeysStatus } from '../messages/contracts.js';

export const PROVIDER_KEYS_STORAGE_KEY = 'applykit_secure_provider_keys';

/**
 * Retrieves boolean indicators of configured provider keys without revealing secret values.
 */
export async function getApiKeysStatus(): Promise<ApiKeysStatus> {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    return {
      openai: false,
      anthropic: false,
      gemini: false,
      openrouter: false,
    };
  }

  const result = await chrome.storage.local.get(PROVIDER_KEYS_STORAGE_KEY);
  const keys = (result[PROVIDER_KEYS_STORAGE_KEY] as Record<string, string>) || {};

  return {
    openai: Boolean(keys.openai && keys.openai.trim().length > 0),
    anthropic: Boolean(keys.anthropic && keys.anthropic.trim().length > 0),
    gemini: Boolean(keys.gemini && keys.gemini.trim().length > 0),
    openrouter: Boolean(keys.openrouter && keys.openrouter.trim().length > 0),
  };
}

/**
 * Persists an individual provider secret key into extension-local storage.
 */
export async function setApiKey(provider: AIProviderName, apiKey: string): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    throw new Error('chrome.storage.local is not available in the current context');
  }

  const existing = await chrome.storage.local.get(PROVIDER_KEYS_STORAGE_KEY);
  const currentKeys = (existing[PROVIDER_KEYS_STORAGE_KEY] as Record<string, string>) || {};

  const trimmed = apiKey.trim();
  if (trimmed.length === 0) {
    delete currentKeys[provider];
  } else {
    currentKeys[provider] = trimmed;
  }

  await chrome.storage.local.set({ [PROVIDER_KEYS_STORAGE_KEY]: currentKeys });
  return true;
}

/**
 * Removes a provider API key from local storage.
 */
export async function removeApiKey(provider: AIProviderName): Promise<boolean> {
  return setApiKey(provider, '');
}

/**
 * Retrieves the raw API key for external provider requests.
 *
 * INVARIANT: This function MUST ONLY be called within the Extension Service Worker.
 * Never expose its output over message passing to content scripts or UI frames.
 */
export async function getRawApiKey(provider: AIProviderName): Promise<string | null> {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    return null;
  }

  const result = await chrome.storage.local.get(PROVIDER_KEYS_STORAGE_KEY);
  const keys = (result[PROVIDER_KEYS_STORAGE_KEY] as Record<string, string>) || {};
  const key = keys[provider]?.trim();
  return key && key.length > 0 ? key : null;
}

/**
 * Clears all stored provider credentials.
 */
export async function clearAllApiKeys(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.remove(PROVIDER_KEYS_STORAGE_KEY);
  }
}

/**
 * Encrypts a plaintext string using AES-GCM and PBKDF2 key derivation via Web Crypto.
 */
export async function encryptWithPassphrase(plaintext: string, passphrase: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  );

  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    enc.encode(plaintext)
  );

  // Package salt + iv + ciphertext into base64 payload
  const combined = new Uint8Array(salt.length + iv.length + encryptedBuffer.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encryptedBuffer), salt.length + iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypts an AES-GCM ciphertext payload using the provided passphrase.
 */
export async function decryptWithPassphrase(ciphertextBase64: string, passphrase: string): Promise<string> {
  const binaryString = atob(ciphertextBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const salt = bytes.slice(0, 16);
  const iv = bytes.slice(16, 28);
  const data = bytes.slice(28);

  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  );

  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    derivedKey,
    data
  );

  return new TextDecoder().decode(decryptedBuffer);
}
