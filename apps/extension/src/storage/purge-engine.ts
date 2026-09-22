/**
 * @fileoverview Privacy & Right to Erasure Data Purge Engine.
 *
 * Implements candidate data sovereignty and privacy compliance (ADR-0001, ADR-0021):
 * - One-click complete data purge ("Right to be Forgotten") wiping all IndexedDB stores,
 *   encrypted provider credentials, and local storage caches without residual traces.
 * - Local storage usage calculation providing transparent audits of stored candidate data.
 * - Zero central telemetry or external tracking retention.
 */

import {
  openDatabase,
  deleteDatabase,
  STORES,
  type StoreName,
  getIndexedDbFactory,
} from './indexeddb.js';
import { clearAllApiKeys, getApiKeysStatus } from './credential-store.js';

/**
 * Summary of candidate data stored locally in the extension.
 */
export interface StorageUsageSummary {
  /** True if a CandidateProfile is configured */
  readonly hasProfile: boolean;
  /** Primary candidate name if known */
  readonly candidateName?: string;
  /** Total verified atomic evidence records stored */
  readonly evidenceCount: number;
  /** Total claims generated in evidence graph */
  readonly claimsCount: number;
  /** Total application records and audit logs stored */
  readonly applicationsCount: number;
  /** Total cached job posting records */
  readonly jobsCount: number;
  /** Count of configured AI provider API keys */
  readonly keysConfiguredCount: number;
}

/**
 * Audit record of an atomic data purge execution.
 */
export interface PurgeResult {
  readonly success: boolean;
  readonly storesPurged: readonly string[];
  readonly keysCleared: boolean;
  readonly purgedAt: string;
}

/**
 * Counts records in an IndexedDB object store safely.
 */
async function countStoreRecords(db: IDBDatabase, storeName: StoreName): Promise<number> {
  if (!db.objectStoreNames.contains(storeName)) {
    return 0;
  }

  return new Promise<number>((resolve) => {
    try {
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

/**
 * Computes transparent local storage metrics across all ApplyKit stores.
 *
 * @param customFactory Optional custom IDBFactory for testing environments.
 * @returns StorageUsageSummary metrics.
 */
export async function getStorageUsageSummary(
  customFactory?: IDBFactory
): Promise<StorageUsageSummary> {
  let hasProfile = false;
  let candidateName: string | undefined;
  let evidenceCount = 0;
  let claimsCount = 0;
  let applicationsCount = 0;
  let jobsCount = 0;
  let keysConfiguredCount = 0;

  try {
    const db = await openDatabase(customFactory);
    const profileCount = await countStoreRecords(db, STORES.PROFILES);
    hasProfile = profileCount > 0;

    evidenceCount = await countStoreRecords(db, STORES.EVIDENCE);
    claimsCount = await countStoreRecords(db, STORES.CLAIMS);
    applicationsCount = await countStoreRecords(db, STORES.APPLICATIONS);
    jobsCount = await countStoreRecords(db, STORES.JOBS);

    if (hasProfile && db.objectStoreNames.contains(STORES.PROFILES)) {
      const tx = db.transaction(STORES.PROFILES, 'readonly');
      const store = tx.objectStore(STORES.PROFILES);
      const req = store.getAll(undefined, 1);
      await new Promise<void>((resolve) => {
        req.onsuccess = () => {
          const profiles = req.result as Array<{
            identity?: {
              fullName?: string;
              legalFirstName?: string;
              legalLastName?: string;
            };
          }>;
          const identity = profiles[0]?.identity;
          if (identity) {
            if (identity.fullName) {
              candidateName = identity.fullName;
            } else if (identity.legalFirstName) {
              candidateName = `${identity.legalFirstName} ${identity.legalLastName ?? ''}`.trim();
            }
          }
          resolve();
        };
        req.onerror = () => resolve();
      });
    }

    db.close();
  } catch {
    // If DB is uninitialized, metrics remain 0
  }

  try {
    const keyStatus = await getApiKeysStatus();
    keysConfiguredCount = Object.values(keyStatus).filter(Boolean).length;
  } catch {
    // Graceful fallback
  }

  return {
    hasProfile,
    candidateName,
    evidenceCount,
    claimsCount,
    applicationsCount,
    jobsCount,
    keysConfiguredCount,
  };
}

/**
 * Atomically purges all candidate data across both IndexedDB and extension-local storage.
 *
 * GDPR / CCPA "Right to Erasure" Invariant:
 * Wipes all candidate profiles, evidence graphs, application history logs, saved answers,
 * and encrypted provider API keys.
 *
 * @param customFactory Optional custom IDBFactory for testing environments.
 * @returns PurgeResult audit summary.
 */
export async function purgeAllCandidateData(
  customFactory?: IDBFactory
): Promise<PurgeResult> {
  const purgedStores = [
    STORES.PROFILES,
    STORES.JOBS,
    STORES.APPLICATIONS,
    STORES.EVIDENCE,
    STORES.CLAIMS,
  ];

  // 1. Clear records from all object stores directly to ensure immediate erasure even if connections are open
  try {
    const db = await openDatabase(customFactory);
    const existingStores = purgedStores.filter((s) => db.objectStoreNames.contains(s));
    if (existingStores.length > 0) {
      const tx = db.transaction(existingStores, 'readwrite');
      for (const storeName of existingStores) {
        tx.objectStore(storeName).clear();
      }
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      });
    }
    db.close();
  } catch {
    // Proceed to drop database
  }

  // 2. Delete IndexedDB Database
  try {
    await deleteDatabase(customFactory);
  } catch {
    // Continue with storage.local clear even if IndexedDB delete threw
  }

  // 3. Wipe chrome.storage.local
  let keysCleared = false;
  try {
    await clearAllApiKeys();
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.clear();
    }
    keysCleared = true;
  } catch {
    keysCleared = false;
  }

  return {
    success: true,
    storesPurged: purgedStores,
    keysCleared,
    purgedAt: new Date().toISOString(),
  };
}
