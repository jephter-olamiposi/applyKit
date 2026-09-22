import { describe, it, expect } from 'vitest';
import {
  createApplicationId,
  createProfileId,
  createJobPostingId,
  createApplicationRecord,
  transitionApplicationRecord,
  isValidStateTransition,
  isTerminalState,
} from '../index.js';

describe('Application State Machine & History', () => {
  const appId = createApplicationId();
  const profId = createProfileId();
  const jobId = createJobPostingId();

  it('initializes application record in idle state with audit log entry', () => {
    const record = createApplicationRecord(appId, profId, jobId);
    expect(record.currentStatus).toBe('idle');
    expect(record.statusHistory).toHaveLength(1);
    expect(record.statusHistory[0]?.from).toBe('idle');
    expect(record.statusHistory[0]?.to).toBe('idle');
  });

  it('transitions cleanly through normal application workflow', () => {
    let record = createApplicationRecord(appId, profId, jobId);

    // idle -> detected_job
    record = transitionApplicationRecord(record, 'detected_job', 'Detected Greenhouse job form');
    expect(record.currentStatus).toBe('detected_job');

    // detected_job -> extracting_job
    record = transitionApplicationRecord(record, 'extracting_job', 'Extracting requirements');
    expect(record.currentStatus).toBe('extracting_job');

    // extracting_job -> matching_profile
    record = transitionApplicationRecord(record, 'matching_profile', 'Matching against profile');
    expect(record.currentStatus).toBe('matching_profile');

    // matching_profile -> ready_to_fill
    record = transitionApplicationRecord(record, 'ready_to_fill', 'Form fields mapped');
    expect(record.currentStatus).toBe('ready_to_fill');

    // ready_to_fill -> dry_run_review
    record = transitionApplicationRecord(record, 'dry_run_review', 'Dry run generated');
    expect(record.currentStatus).toBe('dry_run_review');

    // dry_run_review -> executing_actions
    record = transitionApplicationRecord(record, 'executing_actions', 'User approved actions');
    expect(record.currentStatus).toBe('executing_actions');

    // executing_actions -> awaiting_user_review
    record = transitionApplicationRecord(record, 'awaiting_user_review', 'All fields filled');
    expect(record.currentStatus).toBe('awaiting_user_review');

    // awaiting_user_review -> submitted
    record = transitionApplicationRecord(record, 'submitted', 'User submitted form');
    expect(record.currentStatus).toBe('submitted');
    expect(record.appliedAt).toBeDefined();

    // submitted -> interviewing
    record = transitionApplicationRecord(record, 'interviewing', 'Recruiter phone screen scheduled', {
      interviewStage: 'Recruiter Screen',
      nextFollowUpDate: '2026-10-01',
    });
    expect(record.currentStatus).toBe('interviewing');
    expect(record.interviewStage).toBe('Recruiter Screen');
    expect(record.nextFollowUpDate).toBe('2026-10-01');

    // interviewing -> offered
    record = transitionApplicationRecord(record, 'offered', 'Received official offer letter', {
      interviewStage: 'Offer Extended',
    });
    expect(record.currentStatus).toBe('offered');
    expect(isTerminalState(record.currentStatus)).toBe(true);

    // Check complete history tracking
    expect(record.statusHistory).toHaveLength(11);
  });

  it('initializes application record with rich metadata parameters', () => {
    const record = createApplicationRecord({
      id: appId,
      candidateProfileId: profId,
      jobPostingId: jobId,
      companyName: 'Acme Corp',
      jobTitle: 'Senior Systems Engineer',
      jobPostingUrl: 'https://jobs.acme.com/123',
      matchedRequirementsScore: 0.92,
    });

    expect(record.companyName).toBe('Acme Corp');
    expect(record.jobTitle).toBe('Senior Systems Engineer');
    expect(record.jobPostingUrl).toBe('https://jobs.acme.com/123');
    expect(record.matchedRequirementsScore).toBe(0.92);
    expect(record.currentStatus).toBe('idle');
  });

  it('rejects invalid state transitions and throws error', () => {
    const record = createApplicationRecord(appId, profId, jobId); // status is 'idle'

    // 'idle' cannot jump directly to 'executing_actions'
    expect(isValidStateTransition('idle', 'executing_actions')).toBe(false);
    expect(() => transitionApplicationRecord(record, 'executing_actions')).toThrow(
      "Invalid application state transition from 'idle' to 'executing_actions'"
    );
  });
});
