/**
 * @fileoverview IndexedDB implementation of ApplicationRecord journey tracking.
 *
 * Persists application state machine transitions and audit trails locally (ADR-0001, ADR-0006).
 */

import type {
  ApplicationRecord,
  ApplicationId,
  JobPostingId,
  ApplicationState,
} from '@applykit/domain';
import { transitionApplicationRecord } from '@applykit/domain';
import type { IApplicationRepository } from './interfaces.js';
import {
  STORES,
  dbGet,
  dbPut,
  dbDelete,
  dbGetAll,
  dbGetByIndex,
  openDatabase,
} from './indexeddb.js';

export class IndexedDbApplicationRepository implements IApplicationRepository {
  private cachedDb: IDBDatabase | null = null;

  constructor(private readonly customFactory?: IDBFactory) {}

  private async getDb(): Promise<IDBDatabase> {
    if (!this.cachedDb) {
      this.cachedDb = await openDatabase(this.customFactory);
    }
    return this.cachedDb;
  }

  async saveApplication(record: ApplicationRecord): Promise<void> {
    const db = await this.getDb();
    const updated: ApplicationRecord = {
      ...record,
      updatedAt: new Date().toISOString(),
    };
    await dbPut(db, STORES.APPLICATIONS, updated);
  }

  async getApplicationById(id: ApplicationId): Promise<ApplicationRecord | null> {
    const db = await this.getDb();
    return dbGet<ApplicationRecord>(db, STORES.APPLICATIONS, id);
  }

  async getApplicationByJobId(jobPostingId: JobPostingId): Promise<ApplicationRecord | null> {
    const db = await this.getDb();
    return dbGetByIndex<ApplicationRecord>(db, STORES.APPLICATIONS, 'jobPostingId', jobPostingId);
  }

  async listApplications(limit = 50): Promise<ApplicationRecord[]> {
    const db = await this.getDb();
    const all = await dbGetAll<ApplicationRecord>(db, STORES.APPLICATIONS);
    return all
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, limit);
  }

  async updateApplicationStatus(
    id: ApplicationId,
    nextStatus: ApplicationState,
    reason?: string,
    updates?: Partial<ApplicationRecord>
  ): Promise<ApplicationRecord> {
    const existing = await this.getApplicationById(id);
    if (!existing) {
      throw new Error(`Application with ID '${id}' not found.`);
    }

    const transitioned = transitionApplicationRecord(existing, nextStatus, reason, updates);
    await this.saveApplication(transitioned);
    return transitioned;
  }

  async deleteApplication(id: ApplicationId): Promise<void> {
    const db = await this.getDb();
    await dbDelete(db, STORES.APPLICATIONS, id);
  }

  close(): void {
    if (this.cachedDb) {
      this.cachedDb.close();
      this.cachedDb = null;
    }
  }
}
