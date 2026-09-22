/**
 * @fileoverview Candidate Data Sovereignty: Single-file Backup, Restore, and Purge.
 *
 * Implements user data sovereignty guarantees (ADR-0001, Privacy Specification):
 * - Complete offline JSON export for user-controlled backups.
 * - Validated import restoring relational profile and evidence structures.
 * - One-click "Right to be Forgotten" local data purge.
 */

import type {
  CandidateProfile,
  Evidence,
  CandidateClaim,
  JobPosting,
  ApplicationRecord,
} from '@applykit/domain';
import { IndexedDbProfileRepository } from './profile-repository.js';
import { IndexedDbJobRepository } from './job-repository.js';
import { IndexedDbApplicationRepository } from './application-repository.js';
import { IndexedDbEvidenceRepository } from './evidence-repository.js';
import { deleteDatabase } from './indexeddb.js';
import { clearAllApiKeys } from './credential-store.js';

export interface ApplyKitBackupPayload {
  readonly schemaVersion: 1;
  readonly exportedAt: string;
  readonly profile: CandidateProfile | null;
  readonly evidence: readonly Evidence[];
  readonly claims: readonly CandidateClaim[];
  readonly jobs: readonly JobPosting[];
  readonly applications: readonly ApplicationRecord[];
}

/**
 * Generates a complete, portable JSON backup of the candidate's local data.
 */
export async function exportCandidateBackup(customFactory?: IDBFactory): Promise<string> {
  const profileRepo = new IndexedDbProfileRepository(customFactory);
  const jobRepo = new IndexedDbJobRepository(customFactory);
  const appRepo = new IndexedDbApplicationRepository(customFactory);
  const evidenceRepo = new IndexedDbEvidenceRepository(customFactory);

  try {
    const profile = await profileRepo.getProfile();
    const evidence = await evidenceRepo.listEvidence(500);
    const claims = await evidenceRepo.listClaims(500);
    const jobs = await jobRepo.listJobs(500);
    const applications = await appRepo.listApplications(500);

    const payload: ApplyKitBackupPayload = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      profile,
      evidence,
      claims,
      jobs,
      applications,
    };

    return JSON.stringify(payload, null, 2);
  } finally {
    profileRepo.close();
    jobRepo.close();
    appRepo.close();
    evidenceRepo.close();
  }
}

/**
 * Validates and restores local stores from an ApplyKit backup JSON string.
 */
export async function importCandidateBackup(
  jsonString: string,
  customFactory?: IDBFactory
): Promise<{ success: boolean; error?: string }> {
  let data: Partial<ApplyKitBackupPayload>;
  try {
    data = JSON.parse(jsonString);
  } catch {
    return { success: false, error: 'Invalid JSON format in backup file' };
  }

  if (data.schemaVersion !== 1) {
    return { success: false, error: `Unsupported backup schema version: ${data.schemaVersion}` };
  }

  if (!data.profile || typeof data.profile !== 'object' || !data.profile.id) {
    return { success: false, error: 'Backup payload missing valid candidate profile' };
  }

  const profileRepo = new IndexedDbProfileRepository(customFactory);
  const jobRepo = new IndexedDbJobRepository(customFactory);
  const appRepo = new IndexedDbApplicationRepository(customFactory);
  const evidenceRepo = new IndexedDbEvidenceRepository(customFactory);

  try {
    // Restore profile
    await profileRepo.saveProfile(data.profile as CandidateProfile);

    // Restore evidence
    if (Array.isArray(data.evidence)) {
      for (const ev of data.evidence) {
        if (ev && ev.id) {
          await evidenceRepo.saveEvidence(ev as Evidence);
        }
      }
    }

    // Restore claims
    if (Array.isArray(data.claims)) {
      for (const cl of data.claims) {
        if (cl && cl.id) {
          await evidenceRepo.saveClaim(cl as CandidateClaim);
        }
      }
    }

    // Restore cached jobs
    if (Array.isArray(data.jobs)) {
      for (const j of data.jobs) {
        if (j && j.id) {
          await jobRepo.saveJob(j as JobPosting);
        }
      }
    }

    // Restore applications
    if (Array.isArray(data.applications)) {
      for (const a of data.applications) {
        if (a && a.id) {
          await appRepo.saveApplication(a as ApplicationRecord);
        }
      }
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown restore error',
    };
  } finally {
    profileRepo.close();
    jobRepo.close();
    appRepo.close();
    evidenceRepo.close();
  }
}

/**
 * Executes a full local data wipe ("Right to be Forgotten"):
 * 1. Drops the IndexedDB database (`applykit_db`).
 * 2. Clears `chrome.storage.local` credentials and cached sessions.
 */
export async function purgeAllLocalData(customFactory?: IDBFactory): Promise<void> {
  // Clear IndexedDB
  await deleteDatabase(customFactory);

  // Clear chrome.storage.local
  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    await chrome.storage.local.clear();
  } else {
    await clearAllApiKeys();
  }
}
