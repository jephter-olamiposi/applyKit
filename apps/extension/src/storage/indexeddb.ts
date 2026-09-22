/**
 * @fileoverview Native IndexedDB engine wrapper with type-safe schema migrations and transactions.
 *
 * Implements local-first storage (ADR-0001) for candidate profiles, extracted jobs,
 * application state tracking, and evidence graphs with zero central telemetry.
 */

export const DB_NAME = 'applykit_db';
export const DB_VERSION = 1;

export const STORES = {
  PROFILES: 'profiles',
  JOBS: 'jobs',
  APPLICATIONS: 'applications',
  EVIDENCE: 'evidence',
  CLAIMS: 'claims',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

/**
 * Resolves the active IndexedDB factory across browser service worker, window, or test runner.
 */
export function getIndexedDbFactory(customFactory?: IDBFactory): IDBFactory {
  if (customFactory) {
    return customFactory;
  }
  if (typeof indexedDB !== 'undefined') {
    return indexedDB;
  }
  if (typeof globalThis !== 'undefined' && 'indexedDB' in globalThis) {
    return (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB;
  }
  throw new Error('IndexedDB environment not available in the current context');
}

/**
 * Opens and initializes the ApplyKit database with versioned schema upgrades.
 */
export function openDatabase(customFactory?: IDBFactory): Promise<IDBDatabase> {
  const factory = getIndexedDbFactory(customFactory);

  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      const oldVersion = event.oldVersion;

      if (oldVersion < 1) {
        // Candidate profile aggregate store
        if (!db.objectStoreNames.contains(STORES.PROFILES)) {
          const profileStore = db.createObjectStore(STORES.PROFILES, { keyPath: 'id' });
          profileStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // Extracted job postings store
        if (!db.objectStoreNames.contains(STORES.JOBS)) {
          const jobStore = db.createObjectStore(STORES.JOBS, { keyPath: 'id' });
          jobStore.createIndex('url', 'url', { unique: false });
          jobStore.createIndex('companyName', 'companyName', { unique: false });
          jobStore.createIndex('parsedAt', 'parsedAt', { unique: false });
        }

        // Application tracking journeys store
        if (!db.objectStoreNames.contains(STORES.APPLICATIONS)) {
          const appStore = db.createObjectStore(STORES.APPLICATIONS, { keyPath: 'id' });
          appStore.createIndex('jobPostingId', 'jobPostingId', { unique: false });
          appStore.createIndex('currentStatus', 'currentStatus', { unique: false });
          appStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        // Atomic evidence items store
        if (!db.objectStoreNames.contains(STORES.EVIDENCE)) {
          const evidenceStore = db.createObjectStore(STORES.EVIDENCE, { keyPath: 'id' });
          evidenceStore.createIndex('verificationStatus', 'verificationStatus', { unique: false });
          evidenceStore.createIndex('createdAt', 'createdAt', { unique: false });
        }

        // Candidate qualification claims store
        if (!db.objectStoreNames.contains(STORES.CLAIMS)) {
          const claimStore = db.createObjectStore(STORES.CLAIMS, { keyPath: 'id' });
          claimStore.createIndex('claimType', 'claimType', { unique: false });
          claimStore.createIndex('createdAt', 'createdAt', { unique: false });
        }
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Failed to open IndexedDB'));
    request.onblocked = () => reject(new Error('IndexedDB database upgrade blocked by other connection'));
  });
}

/**
 * Executes a type-safe database transaction on a specific object store.
 */
export function runTransaction<T>(
  db: IDBDatabase,
  storeName: StoreName,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Promise<T> | T
): Promise<T> {
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(storeName, mode);
    } catch (error) {
      reject(error);
      return;
    }

    const store = transaction.objectStore(storeName);
    let operationResult: T;

    Promise.resolve(operation(store))
      .then((res) => {
        operationResult = res;
      })
      .catch((err) => {
        try {
          transaction.abort();
        } catch {
          // Transaction may already be finished
        }
        reject(err);
      });

    transaction.oncomplete = () => resolve(operationResult);
    transaction.onerror = () => reject(transaction.error ?? new Error(`Transaction failed on ${storeName}`));
    transaction.onabort = () => reject(new Error(`Transaction aborted on ${storeName}`));
  });
}

/**
 * Retrieves a single record by its key path.
 */
export async function dbGet<T>(db: IDBDatabase, storeName: StoreName, key: IDBValidKey): Promise<T | null> {
  return runTransaction(db, storeName, 'readonly', (store) => {
    return new Promise<T | null>((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Inserts or updates a record in the specified object store.
 */
export async function dbPut<T>(db: IDBDatabase, storeName: StoreName, value: T): Promise<void> {
  await runTransaction(db, storeName, 'readwrite', (store) => {
    return new Promise<void>((resolve, reject) => {
      const request = store.put(value);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Deletes a record by key path.
 */
export async function dbDelete(db: IDBDatabase, storeName: StoreName, key: IDBValidKey): Promise<void> {
  await runTransaction(db, storeName, 'readwrite', (store) => {
    return new Promise<void>((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Retrieves all records from an object store, optionally constrained by limit.
 */
export async function dbGetAll<T>(db: IDBDatabase, storeName: StoreName, limit?: number): Promise<T[]> {
  return runTransaction(db, storeName, 'readonly', (store) => {
    return new Promise<T[]>((resolve, reject) => {
      const request = limit ? store.getAll(undefined, limit) : store.getAll();
      request.onsuccess = () => resolve((request.result as T[]) ?? []);
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Retrieves a single record matching an indexed key.
 */
export async function dbGetByIndex<T>(
  db: IDBDatabase,
  storeName: StoreName,
  indexName: string,
  query: IDBValidKey | IDBKeyRange
): Promise<T | null> {
  return runTransaction(db, storeName, 'readonly', (store) => {
    return new Promise<T | null>((resolve, reject) => {
      const index = store.index(indexName);
      const request = index.get(query);
      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Retrieves all records matching an indexed key, ordered by index order.
 */
export async function dbGetAllByIndex<T>(
  db: IDBDatabase,
  storeName: StoreName,
  indexName: string,
  query?: IDBValidKey | IDBKeyRange,
  limit?: number
): Promise<T[]> {
  return runTransaction(db, storeName, 'readonly', (store) => {
    return new Promise<T[]>((resolve, reject) => {
      const index = store.index(indexName);
      const request = limit ? index.getAll(query, limit) : index.getAll(query);
      request.onsuccess = () => resolve((request.result as T[]) ?? []);
      request.onerror = () => reject(request.error);
    });
  });
}

/**
 * Completely drops the local IndexedDB database.
 * Used for the "Right to be Forgotten" data wipe action.
 */
export function deleteDatabase(customFactory?: IDBFactory): Promise<void> {
  const factory = getIndexedDbFactory(customFactory);

  return new Promise((resolve, reject) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(); // Don't hang indefinitely on blocked connections
      }
    }, 1500);

    const request = factory.deleteDatabase(DB_NAME);
    request.onsuccess = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve();
      }
    };
    request.onerror = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        reject(request.error ?? new Error('Failed to delete database'));
      }
    };
    request.onblocked = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timer);
        resolve(); // Unblocked will finish deletion in background
      }
    };
  });
}
