/**
 * @fileoverview IndexedDB implementation of JobPosting persistence and discovery caching.
 */

import type { JobPosting, JobPostingId } from '@applykit/domain';
import type { IJobRepository } from './interfaces.js';
import {
  STORES,
  dbGet,
  dbPut,
  dbDelete,
  dbGetAll,
  dbGetByIndex,
  openDatabase,
} from './indexeddb.js';

export class IndexedDbJobRepository implements IJobRepository {
  private cachedDb: IDBDatabase | null = null;

  constructor(private readonly customFactory?: IDBFactory) {}

  private async getDb(): Promise<IDBDatabase> {
    if (!this.cachedDb) {
      this.cachedDb = await openDatabase(this.customFactory);
    }
    return this.cachedDb;
  }

  async saveJob(job: JobPosting): Promise<void> {
    const db = await this.getDb();
    await dbPut(db, STORES.JOBS, job);
  }

  async getJobById(id: JobPostingId): Promise<JobPosting | null> {
    const db = await this.getDb();
    return dbGet<JobPosting>(db, STORES.JOBS, id);
  }

  async getJobByUrl(url: string): Promise<JobPosting | null> {
    const db = await this.getDb();
    return dbGetByIndex<JobPosting>(db, STORES.JOBS, 'url', url);
  }

  async listJobs(limit = 50): Promise<JobPosting[]> {
    const db = await this.getDb();
    const all = await dbGetAll<JobPosting>(db, STORES.JOBS);
    // Sort descending by parsedAt timestamp
    return all
      .sort((a, b) => new Date(b.parsedAt).getTime() - new Date(a.parsedAt).getTime())
      .slice(0, limit);
  }

  async deleteJob(id: JobPostingId): Promise<void> {
    const db = await this.getDb();
    await dbDelete(db, STORES.JOBS, id);
  }

  close(): void {
    if (this.cachedDb) {
      this.cachedDb.close();
      this.cachedDb = null;
    }
  }
}
