/**
 * @fileoverview Canonical ApplicationRecord Aggregate and State Machine Transitions.
 *
 * Implements persistent, local-first application tracking and immutable audit trails
 * (ADR-0001, ADR-0006). Every application journey is tracked through an auditable
 * state machine from job detection to human review, submission, and interview tracking.
 */

import type { ApplicationId, ProfileId, JobPostingId } from '../types/ids.js';
import type { ApplicationState } from './state.js';
import { isValidStateTransition } from './state.js';
import type { DryRunAction } from '../form/dry-run.js';

/**
 * Historical record of an individual state transition for auditing and compliance.
 */
export interface StateTransition {
  readonly from: ApplicationState;
  readonly to: ApplicationState;
  readonly timestamp: string;
  readonly reason?: string;
}

/**
 * Parameter payload used when initializing a new ApplicationRecord.
 */
export interface CreateApplicationParams {
  readonly id: ApplicationId;
  readonly candidateProfileId: ProfileId;
  readonly jobPostingId: JobPostingId;
  readonly companyName?: string;
  readonly jobTitle?: string;
  readonly jobPostingUrl?: string;
  readonly jobDescriptionSnapshot?: string;
  readonly matchedRequirementsScore?: number;
}

/**
 * Canonical aggregate tracking the progress, audit trail, and actions of a single job application.
 */
export interface ApplicationRecord {
  readonly id: ApplicationId;
  readonly candidateProfileId: ProfileId;
  readonly jobPostingId: JobPostingId;
  /** Company name for human-readable search, filtering, and audit display. */
  readonly companyName: string;
  /** Job title for human-readable search and audit display. */
  readonly jobTitle: string;
  /** Direct URL to the job posting. */
  readonly jobPostingUrl: string;
  readonly currentStatus: ApplicationState;
  readonly statusHistory: readonly StateTransition[];
  readonly matchedRequirementsScore: number;
  readonly filledFieldsCount: number;
  readonly dryRunLog: readonly DryRunAction[];
  /** Map of field label/key to candidate value populated. */
  readonly filledValues?: Readonly<Record<string, string>>;
  /** Exact ISO timestamp when user verified and manually submitted the application. */
  readonly appliedAt?: string;
  /** Snapshot of the job posting text at the time of application. */
  readonly jobDescriptionSnapshot?: string;
  /** Active interview stage (e.g. 'Screening', 'Technical', 'Behavioral', 'Offer'). */
  readonly interviewStage?: string;
  /** Scheduled date for follow-up or check-in (ISO string or YYYY-MM-DD). */
  readonly nextFollowUpDate?: string;
  readonly notes?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Initializes a new ApplicationRecord in the 'idle' state.
 * Supports either a typed parameter payload or positional arguments for backwards compatibility.
 *
 * @param idOrParams ApplicationId or initialization params object.
 * @param candidateProfileId Profile identifier if using positional arguments.
 * @param jobPostingId Job posting identifier if using positional arguments.
 * @returns Initialized ApplicationRecord.
 */
export function createApplicationRecord(
  idOrParams: ApplicationId | CreateApplicationParams,
  candidateProfileId?: ProfileId,
  jobPostingId?: JobPostingId
): ApplicationRecord {
  const now = new Date().toISOString();

  let id: ApplicationId;
  let profileId: ProfileId;
  let jobId: JobPostingId;
  let companyName = 'Unknown Company';
  let jobTitle = 'Unknown Role';
  let jobPostingUrl = '';
  let jobDescriptionSnapshot: string | undefined;
  let matchedRequirementsScore = 0;

  if (typeof idOrParams === 'object') {
    id = idOrParams.id;
    profileId = idOrParams.candidateProfileId;
    jobId = idOrParams.jobPostingId;
    companyName = idOrParams.companyName || companyName;
    jobTitle = idOrParams.jobTitle || jobTitle;
    jobPostingUrl = idOrParams.jobPostingUrl || jobPostingUrl;
    jobDescriptionSnapshot = idOrParams.jobDescriptionSnapshot;
    matchedRequirementsScore = idOrParams.matchedRequirementsScore || 0;
  } else {
    id = idOrParams;
    profileId = candidateProfileId!;
    jobId = jobPostingId!;
  }

  return {
    id,
    candidateProfileId: profileId,
    jobPostingId: jobId,
    companyName,
    jobTitle,
    jobPostingUrl,
    currentStatus: 'idle',
    statusHistory: [
      {
        from: 'idle',
        to: 'idle',
        timestamp: now,
        reason: 'Application record initialized',
      },
    ],
    matchedRequirementsScore,
    filledFieldsCount: 0,
    dryRunLog: [],
    ...(jobDescriptionSnapshot ? { jobDescriptionSnapshot } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Executes a valid state transition on an ApplicationRecord.
 * Throws an Error if the requested transition violates the state machine rules.
 *
 * Invariant (ADR-0006): System transitions halt at 'awaiting_user_review'.
 * Only candidate confirmation can advance the record to 'submitted'.
 *
 * @param record Active application record.
 * @param nextStatus Target state machine status.
 * @param reason Human-readable rationale for the transition.
 * @param updates Optional metadata updates (e.g. interview stage, follow-up date, notes).
 * @returns Updated ApplicationRecord with appended transition history.
 */
export function transitionApplicationRecord(
  record: ApplicationRecord,
  nextStatus: ApplicationState,
  reason?: string,
  updates?: Partial<
    Pick<
      ApplicationRecord,
      | 'appliedAt'
      | 'interviewStage'
      | 'nextFollowUpDate'
      | 'notes'
      | 'filledFieldsCount'
      | 'filledValues'
      | 'dryRunLog'
    >
  >
): ApplicationRecord {
  if (!isValidStateTransition(record.currentStatus, nextStatus)) {
    throw new Error(
      `Invalid application state transition from '${record.currentStatus}' to '${nextStatus}'.`
    );
  }

  const now = new Date().toISOString();
  const transition: StateTransition = {
    from: record.currentStatus,
    to: nextStatus,
    timestamp: now,
    ...(reason !== undefined ? { reason } : {}),
  };

  // If transitioning to submitted, automatically timestamp appliedAt if not already populated
  const appliedAt =
    nextStatus === 'submitted'
      ? updates?.appliedAt || record.appliedAt || now
      : updates?.appliedAt || record.appliedAt;

  return {
    ...record,
    ...updates,
    currentStatus: nextStatus,
    statusHistory: [...record.statusHistory, transition],
    ...(appliedAt ? { appliedAt } : {}),
    updatedAt: now,
  };
}
