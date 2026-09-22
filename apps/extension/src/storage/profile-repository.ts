/**
 * @fileoverview IndexedDB implementation of CandidateProfile persistence.
 *
 * Enforces the candidate profile invariant (ADR-0004): candidate history and evidence
 * are stored purely client-side with zero external telemetry.
 */

import {
  type CandidateProfile,
  type ProfileId,
  createProfileId,
} from '@applykit/domain';
import type { IProfileRepository } from './interfaces.js';
import type { CandidateProfileSummary } from '../messages/contracts.js';
import {
  STORES,
  dbGet,
  dbPut,
  dbDelete,
  dbGetAll,
  openDatabase,
} from './indexeddb.js';

export const DEFAULT_PROFILE_KEY = 'default-profile';

export class IndexedDbProfileRepository implements IProfileRepository {
  private cachedDb: IDBDatabase | null = null;

  constructor(private readonly customFactory?: IDBFactory) {}

  private async getDb(): Promise<IDBDatabase> {
    if (!this.cachedDb) {
      this.cachedDb = await openDatabase(this.customFactory);
    }
    return this.cachedDb;
  }

  async getProfile(id?: ProfileId): Promise<CandidateProfile | null> {
    const db = await this.getDb();
    if (id) {
      return dbGet<CandidateProfile>(db, STORES.PROFILES, id);
    }

    // Default to the first available profile or the default profile ID
    const directDefault = await dbGet<CandidateProfile>(db, STORES.PROFILES, DEFAULT_PROFILE_KEY);
    if (directDefault) {
      return directDefault;
    }

    const all = await dbGetAll<CandidateProfile>(db, STORES.PROFILES, 1);
    return all[0] ?? null;
  }

  async saveProfile(profile: CandidateProfile): Promise<void> {
    const db = await this.getDb();
    const updated: CandidateProfile = {
      ...profile,
      updatedAt: new Date().toISOString(),
    };
    await dbPut(db, STORES.PROFILES, updated);
  }

  async deleteProfile(id: ProfileId): Promise<void> {
    const db = await this.getDb();
    await dbDelete(db, STORES.PROFILES, id);
  }

  async getProfileSummary(id?: ProfileId): Promise<CandidateProfileSummary> {
    const profile = await this.getProfile(id);

    if (!profile) {
      return {
        id: id ?? DEFAULT_PROFILE_KEY,
        fullName: 'Candidate',
        headline: 'Ready to configure profile',
        email: '',
        skillsCount: 0,
        experienceCount: 0,
        claimsCount: 0,
        isComplete: false,
      };
    }

    const fullName = `${profile.identity.legalFirstName} ${profile.identity.legalLastName}`.trim() || 'Candidate';
    const hasCoreInfo = Boolean(profile.identity.legalFirstName && profile.identity.email);
    const hasHistory = profile.skills.length > 0 || profile.experiences.length > 0;

    return {
      id: profile.id,
      fullName,
      headline: profile.professional.headline || 'Ready to configure profile',
      email: profile.identity.email || '',
      skillsCount: profile.skills.length,
      experienceCount: profile.experiences.length,
      claimsCount: profile.claims.length,
      isComplete: hasCoreInfo && hasHistory,
    };
  }

  /**
   * Closes the cached database connection. Useful in test fixtures or teardown.
   */
  close(): void {
    if (this.cachedDb) {
      this.cachedDb.close();
      this.cachedDb = null;
    }
  }
}
