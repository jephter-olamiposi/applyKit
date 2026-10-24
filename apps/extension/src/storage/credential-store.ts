/**
 * @fileoverview Encrypted AI provider credential store.
 *
 * Enforces strict API key isolation (ADR-0002):
 * - Provider API keys never leave the extension origin and are only decrypted in
 *   the service-worker context.
 * - Values are encrypted with AES-GCM using a non-extractable key stored in
 *   IndexedDB, so `chrome.storage.local` never contains plaintext secrets.
 * - Outbound RPC responses return boolean flags (`ApiKeysStatus`), never secrets.
 */

import type { AIProviderName } from '@applykit/domain';
import type { ApiKeysStatus } from '../messages/contracts.js';

export const PROVIDER_KEYS_STORAGE_KEY = 'applykit_secure_provider_keys';

const SECRETS_DB_NAME = 'applykit_secrets';
const SECRETS_DB_VERSION = 1;
const SECRETS_STORE_NAME = 'crypto_keys';
const SECRETS_KEY_ID = 'provider-credentials-key';

const PROVIDERS: readonly AIProviderName[] = ['openai', 'anthropic', 'gemini', 'openrouter'];

interface EncryptedSecret {
  readonly v: 1;
  readonly iv: string;
  readonly data: string;
}

let cachedEncryptionKey: CryptoKey | null = null;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function openSecretsDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable; secure credential storage cannot start.'));
      return;
    }

    const request = indexedDB.open(SECRETS_DB_NAME, SECRETS_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SECRETS_STORE_NAME)) {
        database.createObjectStore(SECRETS_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open credential database.'));
    request.onblocked = () => reject(new Error('Credential database upgrade was blocked.'));
  });
}

function readStoredKey(database: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SECRETS_STORE_NAME, 'readonly');
    const request = transaction.objectStore(SECRETS_STORE_NAME).get(SECRETS_KEY_ID);
    request.onsuccess = () => {
      const value = request.result as CryptoKey | undefined;
      resolve(value ?? null);
    };
    request.onerror = () => reject(request.error ?? new Error('Failed to read credential key.'));
  });
}

function writeStoredKey(database: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(SECRETS_STORE_NAME, 'readwrite');
    transaction.objectStore(SECRETS_STORE_NAME).put(key, SECRETS_KEY_ID);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('Failed to persist credential key.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('Credential key write aborted.'));
  });
}

async function getEncryptionKey(): Promise<CryptoKey> {
  if (cachedEncryptionKey) return cachedEncryptionKey;
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('Web Crypto is unavailable; secure credential storage cannot start.');
  }

  const database = await openSecretsDatabase();
  try {
    const existing = await readStoredKey(database);
    if (existing) {
      cachedEncryptionKey = existing;
      return existing;
    }

    // Non-extractable: the raw key material can never be exported from the CryptoKey handle.
    const generated = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    await writeStoredKey(database, generated);
    cachedEncryptionKey = generated;
    return generated;
  } finally {
    database.close();
  }
}

async function encryptSecret(plaintext: string): Promise<EncryptedSecret> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext)
  );
  return {
    v: 1,
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(ciphertext)),
  };
}

function isEncryptedSecret(value: unknown): value is EncryptedSecret {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate['v'] === 1 &&
    typeof candidate['iv'] === 'string' &&
    typeof candidate['data'] === 'string';
}

async function decryptSecret(secret: EncryptedSecret): Promise<string> {
  const key = await getEncryptionKey();
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(secret.iv).buffer as ArrayBuffer },
    key,
    fromBase64(secret.data).buffer as ArrayBuffer
  );
  return new TextDecoder().decode(plaintext);
}

async function readKeyMap(): Promise<Record<string, unknown>> {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    return {};
  }
  const result = await chrome.storage.local.get(PROVIDER_KEYS_STORAGE_KEY);
  const value = result[PROVIDER_KEYS_STORAGE_KEY];
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

async function writeKeyMap(keys: Record<string, unknown>): Promise<void> {
  await chrome.storage.local.set({ [PROVIDER_KEYS_STORAGE_KEY]: keys });
}

/**
 * Encrypts every legacy plaintext entry in place and returns the canonical encrypted map.
 *
 * Migration is idempotent: encrypted entries pass through untouched, so a partially
 * completed migration is completed on the next read without losing credentials.
 */
async function migrateLegacyKeys(keys: Record<string, unknown>): Promise<Record<string, unknown>> {
  let changed = false;
  const migrated: Record<string, unknown> = { ...keys };

  for (const provider of PROVIDERS) {
    const value = migrated[provider];
    if (typeof value === 'string' && value.trim().length > 0) {
      migrated[provider] = await encryptSecret(value.trim());
      changed = true;
    }
  }

  if (changed) {
    await writeKeyMap(migrated);
  }
  return migrated;
}

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

  const keys = await readKeyMap();
  const configured = (provider: AIProviderName): boolean => {
    const value = keys[provider];
    return isEncryptedSecret(value) || (typeof value === 'string' && value.trim().length > 0);
  };

  return {
    openai: configured('openai'),
    anthropic: configured('anthropic'),
    gemini: configured('gemini'),
    openrouter: configured('openrouter'),
  };
}

/**
 * Persists an individual provider secret key, encrypted at rest.
 *
 * An empty value revokes the stored credential for that provider.
 */
export async function setApiKey(provider: AIProviderName, apiKey: string): Promise<boolean> {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    throw new Error('chrome.storage.local is not available in the current context');
  }

  const currentKeys = await migrateLegacyKeys(await readKeyMap());
  const trimmed = apiKey.trim();

  if (trimmed.length === 0) {
    delete currentKeys[provider];
  } else {
    currentKeys[provider] = await encryptSecret(trimmed);
  }

  await writeKeyMap(currentKeys);
  return true;
}

/**
 * Removes a provider API key from storage.
 */
export async function removeApiKey(provider: AIProviderName): Promise<boolean> {
  return setApiKey(provider, '');
}

/**
 * Retrieves the decrypted API key for outbound provider requests.
 *
 * INVARIANT: This function MUST ONLY be called within the Extension Service Worker.
 * Never expose its output over message passing to content scripts or UI frames.
 */
export async function getRawApiKey(provider: AIProviderName): Promise<string | null> {
  if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
    return null;
  }

  const keys = await migrateLegacyKeys(await readKeyMap());
  const value = keys[provider];

  if (isEncryptedSecret(value)) {
    const decrypted = await decryptSecret(value);
    return decrypted.length > 0 ? decrypted : null;
  }

  if (typeof value === 'string') {
    const legacy = value.trim();
    return legacy.length > 0 ? legacy : null;
  }

  return null;
}

/**
 * Clears all stored provider credentials and the encryption key.
 */
export async function clearAllApiKeys(): Promise<void> {
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.remove(PROVIDER_KEYS_STORAGE_KEY);
  }

  cachedEncryptionKey = null;
  if (typeof indexedDB === 'undefined') return;

  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(SECRETS_DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

/**
 * Encrypts a plaintext string using AES-GCM and PBKDF2 key derivation via Web Crypto.
 *
 * Retained for portable, passphrase-based export encryption; provider credentials use
 * the non-extractable installation key above.
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

  const combined = new Uint8Array(salt.length + iv.length + encryptedBuffer.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encryptedBuffer), salt.length + iv.length);

  return toBase64(combined);
}

/**
 * Decrypts an AES-GCM ciphertext payload using the provided passphrase.
 */
export async function decryptWithPassphrase(ciphertextBase64: string, passphrase: string): Promise<string> {
  const bytes = fromBase64(ciphertextBase64);
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
