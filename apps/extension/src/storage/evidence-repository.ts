/**
 * @fileoverview IndexedDB implementation of atomic Evidence items and CandidateClaims.
 *
 * Enforces evidence verification invariant (ADR-0004): claims must be substantiated by
 * concrete evidence nodes stored client-side.
 */

import type {
  Evidence,
  EvidenceId,
  CandidateClaim,
  ClaimId,
  EvidenceGraph,
} from '@applykit/domain';
import { buildEvidenceGraph } from '@applykit/domain';
import type { IEvidenceRepository } from './interfaces.js';
import {
  STORES,
  dbGet,
  dbPut,
  dbGetAll,
  openDatabase,
} from './indexeddb.js';

export class IndexedDbEvidenceRepository implements IEvidenceRepository {
  private cachedDb: IDBDatabase | null = null;

  constructor(private readonly customFactory?: IDBFactory) {}

  private async getDb(): Promise<IDBDatabase> {
    if (!this.cachedDb) {
      this.cachedDb = await openDatabase(this.customFactory);
    }
    return this.cachedDb;
  }

  async saveEvidence(evidence: Evidence): Promise<void> {
    const db = await this.getDb();
    await dbPut(db, STORES.EVIDENCE, evidence);
  }

  async saveEvidenceBatch(evidenceList: readonly Evidence[]): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(STORES.EVIDENCE, 'readwrite');
    const store = tx.objectStore(STORES.EVIDENCE);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('Transaction aborted during saveEvidenceBatch'));

      for (const ev of evidenceList) {
        store.put(ev);
      }
    });
  }

  async getEvidenceById(id: EvidenceId): Promise<Evidence | null> {
    const db = await this.getDb();
    return dbGet<Evidence>(db, STORES.EVIDENCE, id);
  }

  async listEvidence(limit = 500): Promise<Evidence[]> {
    const db = await this.getDb();
    return dbGetAll<Evidence>(db, STORES.EVIDENCE, limit);
  }

  async saveClaim(claim: CandidateClaim): Promise<void> {
    const db = await this.getDb();
    await dbPut(db, STORES.CLAIMS, claim);
  }

  async saveClaimBatch(claimsList: readonly CandidateClaim[]): Promise<void> {
    const db = await this.getDb();
    const tx = db.transaction(STORES.CLAIMS, 'readwrite');
    const store = tx.objectStore(STORES.CLAIMS);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('Transaction aborted during saveClaimBatch'));

      for (const claim of claimsList) {
        store.put(claim);
      }
    });
  }

  async getClaimById(id: ClaimId): Promise<CandidateClaim | null> {
    const db = await this.getDb();
    return dbGet<CandidateClaim>(db, STORES.CLAIMS, id);
  }

  async listClaims(limit = 500): Promise<CandidateClaim[]> {
    const db = await this.getDb();
    return dbGetAll<CandidateClaim>(db, STORES.CLAIMS, limit);
  }

  async getEvidenceGraph(): Promise<EvidenceGraph> {
    const [evidence, claims] = await Promise.all([
      this.listEvidence(1000),
      this.listClaims(1000),
    ]);
    return buildEvidenceGraph(evidence, claims);
  }

  close(): void {
    if (this.cachedDb) {
      this.cachedDb.close();
      this.cachedDb = null;
    }
  }
}
