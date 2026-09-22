/**
 * @fileoverview Domain repository contracts for local-first storage.
 *
 * Defines strongly-typed repository interfaces decoupling persistence implementation
 * details (IndexedDB, in-memory, or future sync) from business orchestration logic.
 */

import type {
  CandidateProfile,
  ProfileId,
  JobPosting,
  JobPostingId,
  ApplicationRecord,
  ApplicationId,
  ApplicationState,
  Evidence,
  EvidenceId,
  CandidateClaim,
  ClaimId,
  EvidenceGraph,
} from '@applykit/domain';
import type { CandidateProfileSummary } from '../messages/contracts.js';

/**
 * Repository interface for managing candidate profile aggregate persistence.
 */
export interface IProfileRepository {
  /** Retrieves a candidate profile by ID or returns the default active profile if omitted. */
  getProfile(id?: ProfileId): Promise<CandidateProfile | null>;

  /** Persists or updates the candidate profile aggregate. */
  saveProfile(profile: CandidateProfile): Promise<void>;

  /** Deletes the profile associated with the specified identifier. */
  deleteProfile(id: ProfileId): Promise<void>;

  /** Computes high-level profile metrics for side panel display without hydrating full history. */
  getProfileSummary(id?: ProfileId): Promise<CandidateProfileSummary>;
}

/**
 * Repository interface for caching and managing extracted job listings.
 */
export interface IJobRepository {
  /** Persists an extracted or edited job posting. */
  saveJob(job: JobPosting): Promise<void>;

  /** Retrieves a job posting by its nominal JobPostingId. */
  getJobById(id: JobPostingId): Promise<JobPosting | null>;

  /** Retrieves a previously extracted job by its canonical webpage URL. */
  getJobByUrl(url: string): Promise<JobPosting | null>;

  /** Lists historical job postings ordered by most recent parsedAt timestamp. */
  listJobs(limit?: number): Promise<JobPosting[]>;

  /** Deletes a cached job posting by ID. */
  deleteJob(id: JobPostingId): Promise<void>;
}

/**
 * Repository interface for tracking individual job application journeys.
 */
export interface IApplicationRepository {
  /** Persists or updates an application tracking record. */
  saveApplication(record: ApplicationRecord): Promise<void>;

  /** Retrieves an application by its unique ApplicationId. */
  getApplicationById(id: ApplicationId): Promise<ApplicationRecord | null>;

  /** Retrieves an application tracking record for a specific job posting, if one exists. */
  getApplicationByJobId(jobPostingId: JobPostingId): Promise<ApplicationRecord | null>;

  /** Lists historical application journeys ordered by most recent update. */
  listApplications(limit?: number): Promise<ApplicationRecord[]>;

  /** Updates the status of an application record with an appended audit transition. */
  updateApplicationStatus(
    id: ApplicationId,
    nextStatus: ApplicationState,
    reason?: string,
    updates?: Partial<ApplicationRecord>
  ): Promise<ApplicationRecord>;

  /** Deletes an application tracking record. */
  deleteApplication(id: ApplicationId): Promise<void>;
}

/**
 * Repository interface for atomic evidence items and candidate claims.
 */
export interface IEvidenceRepository {
  /** Persists an atomic verified evidence node. */
  saveEvidence(evidence: Evidence): Promise<void>;

  /** Persists a batch of atomic evidence nodes. */
  saveEvidenceBatch(evidenceList: readonly Evidence[]): Promise<void>;

  /** Retrieves an evidence node by its unique EvidenceId. */
  getEvidenceById(id: EvidenceId): Promise<Evidence | null>;

  /** Lists all evidence nodes associated with candidate credentials. */
  listEvidence(limit?: number): Promise<Evidence[]>;

  /** Persists a candidate qualification claim. */
  saveClaim(claim: CandidateClaim): Promise<void>;

  /** Persists a batch of candidate claims. */
  saveClaimBatch(claimsList: readonly CandidateClaim[]): Promise<void>;

  /** Retrieves a candidate claim by its unique ClaimId. */
  getClaimById(id: ClaimId): Promise<CandidateClaim | null>;

  /** Lists candidate claims. */
  listClaims(limit?: number): Promise<CandidateClaim[]>;

  /** Loads all active evidence nodes and claims, constructing an indexed EvidenceGraph. */
  getEvidenceGraph(): Promise<EvidenceGraph>;
}
