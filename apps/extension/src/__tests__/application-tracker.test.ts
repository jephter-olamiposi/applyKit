/**
 * @fileoverview Unit and integration tests for Application Tracker & Audit History (Phase 11).
 *
 * Verifies:
 * 1. Application state machine transitions and audit trail persistence.
 * 2. Status updates and interview stage lifecycle progression.
 * 3. Anti-Autonomous Submission Hard Gate (ADR-0006): execution stops at 'awaiting_user_review'.
 * 4. Application deletion and Right to Erasure privacy compliance.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import {
  createApplicationId,
  createProfileId,
  createJobPostingId,
  createActionId,
  createPlanId,
  createApplicationRecord,
  type DryRunPlan,
  type ExecutionReport,
} from '@applykit/domain';
import {
  IndexedDbApplicationRepository,
  deleteDatabase,
} from '../storage/index.js';

describe('Application Tracking & Audit History Engine (Phase 11)', () => {
  let appRepo: IndexedDbApplicationRepository;

  beforeEach(async () => {
    await deleteDatabase(indexedDB);
    appRepo = new IndexedDbApplicationRepository(indexedDB);
  });

  afterEach(() => {
    appRepo.close();
  });

  describe('Application Record Creation & Metadata', () => {
    it('initializes application with company and role metadata', async () => {
      const appId = createApplicationId('app_google_1');
      const profileId = createProfileId('prof_1');
      const jobId = createJobPostingId('job_google');

      const app = createApplicationRecord({
        id: appId,
        candidateProfileId: profileId,
        jobPostingId: jobId,
        companyName: 'Google',
        jobTitle: 'Senior Infrastructure Engineer',
        jobPostingUrl: 'https://careers.google.com/jobs/12345',
        jobDescriptionSnapshot: 'Design distributed systems in Go and C++.',
        matchedRequirementsScore: 0.94,
      });

      await appRepo.saveApplication(app);

      const loaded = await appRepo.getApplicationById(appId);
      expect(loaded).toBeDefined();
      expect(loaded?.companyName).toBe('Google');
      expect(loaded?.jobTitle).toBe('Senior Infrastructure Engineer');
      expect(loaded?.jobPostingUrl).toBe('https://careers.google.com/jobs/12345');
      expect(loaded?.currentStatus).toBe('idle');
      expect(loaded?.matchedRequirementsScore).toBe(0.94);
      expect(loaded?.statusHistory.length).toBe(1);
    });

    it('queries application by jobPostingId', async () => {
      const appId = createApplicationId('app_lever_1');
      const profileId = createProfileId('prof_1');
      const jobId = createJobPostingId('job_lever_123');

      const app = createApplicationRecord({
        id: appId,
        candidateProfileId: profileId,
        jobPostingId: jobId,
        companyName: 'Linear',
        jobTitle: 'Product Engineer',
        jobPostingUrl: 'https://jobs.lever.co/linear/123',
      });

      await appRepo.saveApplication(app);

      const loadedByJob = await appRepo.getApplicationByJobId(jobId);
      expect(loadedByJob).toBeDefined();
      expect(loadedByJob?.id).toBe(appId);
      expect(loadedByJob?.companyName).toBe('Linear');
    });
  });

  describe('Status Transitions & Post-Submission Lifecycle', () => {
    it('transitions through full journey: review -> submitted -> interviewing -> offered', async () => {
      const appId = createApplicationId('app_lifecycle');
      const profileId = createProfileId('prof_1');
      const jobId = createJobPostingId('job_lifecycle');

      const app = createApplicationRecord({
        id: appId,
        candidateProfileId: profileId,
        jobPostingId: jobId,
        companyName: 'Stripe',
        jobTitle: 'Staff Backend Engineer',
      });

      await appRepo.saveApplication(app);

      // Step 1: Advance to awaiting_user_review
      await appRepo.updateApplicationStatus(
        appId,
        'ready_to_fill',
        'Form fields inspected and mapped'
      );
      await appRepo.updateApplicationStatus(
        appId,
        'dry_run_review',
        'Dry run preview generated for candidate review'
      );
      await appRepo.updateApplicationStatus(
        appId,
        'executing_actions',
        'Executing form fill dry run actions'
      );
      const inReview = await appRepo.updateApplicationStatus(
        appId,
        'awaiting_user_review',
        'Actions completed. Paused at Anti-Autonomous Submit Gate.'
      );

      expect(inReview.currentStatus).toBe('awaiting_user_review');
      expect(inReview.appliedAt).toBeUndefined();

      // Step 2: Human-in-the-Loop Confirmation: User manually submits and confirms
      const submitted = await appRepo.updateApplicationStatus(
        appId,
        'submitted',
        'Candidate visually reviewed and manually clicked submit on host webpage'
      );

      expect(submitted.currentStatus).toBe('submitted');
      // Invariant: appliedAt must be automatically stamped when transitioning to submitted
      expect(submitted.appliedAt).toBeDefined();

      // Step 3: Advance to interviewing with interview stage and follow-up schedule
      const interviewing = await appRepo.updateApplicationStatus(
        appId,
        'interviewing',
        'Recruiter reached out for initial phone screen',
        {
          interviewStage: 'Recruiter Screen',
          nextFollowUpDate: '2026-10-15',
          notes: 'Spoke with Sarah. Asked about distributed consensus and Kafka experience.',
        }
      );

      expect(interviewing.currentStatus).toBe('interviewing');
      expect(interviewing.interviewStage).toBe('Recruiter Screen');
      expect(interviewing.nextFollowUpDate).toBe('2026-10-15');
      expect(interviewing.notes).toContain('Sarah');

      // Step 4: Advance to offered
      const offered = await appRepo.updateApplicationStatus(
        appId,
        'offered',
        'Received written offer package',
        {
          interviewStage: 'Offer Extended',
          notes: 'Received offer: $220k base + equity.',
        }
      );

      expect(offered.currentStatus).toBe('offered');
      expect(offered.interviewStage).toBe('Offer Extended');

      // Verify audit history timeline length (1 initial + 7 transitions = 8)
      expect(offered.statusHistory.length).toBe(8);
    });

    it('rejects forbidden state transitions according to state machine rules', async () => {
      const appId = createApplicationId('app_invalid');
      const profileId = createProfileId('prof_1');
      const jobId = createJobPostingId('job_invalid');

      const app = createApplicationRecord({
        id: appId,
        candidateProfileId: profileId,
        jobPostingId: jobId,
        companyName: 'Acme',
        jobTitle: 'Developer',
      });

      await appRepo.saveApplication(app);

      // Invariant: Cannot transition directly from 'idle' to 'submitted'
      await expect(
        appRepo.updateApplicationStatus(appId, 'submitted', 'Direct jump')
      ).rejects.toThrow("Invalid application state transition from 'idle' to 'submitted'");
    });
  });

  describe('Application Deletion & Right to Erasure', () => {
    it('deletes an application record and its audit history cleanly', async () => {
      const appId = createApplicationId('app_delete');
      const profileId = createProfileId('prof_1');
      const jobId = createJobPostingId('job_delete');

      const app = createApplicationRecord({
        id: appId,
        candidateProfileId: profileId,
        jobPostingId: jobId,
        companyName: 'Private Corp',
        jobTitle: 'Engineer',
      });

      await appRepo.saveApplication(app);
      expect(await appRepo.getApplicationById(appId)).toBeDefined();

      await appRepo.deleteApplication(appId);
      expect(await appRepo.getApplicationById(appId)).toBeNull();
    });

    it('lists applications sorted by updatedAt in descending order', async () => {
      const profileId = createProfileId('prof_1');

      const app1 = createApplicationRecord({
        id: createApplicationId('app_older'),
        candidateProfileId: profileId,
        jobPostingId: createJobPostingId('job_1'),
        companyName: 'Old Corp',
        jobTitle: 'Role 1',
      });

      const app2 = createApplicationRecord({
        id: createApplicationId('app_newer'),
        candidateProfileId: profileId,
        jobPostingId: createJobPostingId('job_2'),
        companyName: 'New Corp',
        jobTitle: 'Role 2',
      });

      await appRepo.saveApplication(app1);
      // Wait brief microtask to ensure different updatedAt
      await new Promise((r) => setTimeout(r, 10));
      await appRepo.saveApplication(app2);

      const list = await appRepo.listApplications(10);
      expect(list.length).toBe(2);
      expect(list[0]?.companyName).toBe('New Corp');
      expect(list[1]?.companyName).toBe('Old Corp');
    });
  });
});
