/**
 * @fileoverview Unit and integration tests for Application Tracker & Audit History.
 *
 * Verifies:
 * 1. Application state machine transitions and audit trail persistence.
 * 2. Status updates and interview stage lifecycle progression.
 * 3. Anti-Autonomous Submission Hard Gate: execution stops at 'awaiting_user_review'.
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

describe('Application Tracking & Audit History Engine', () => {
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

      // Human-in-the-loop confirmation: user manually submits and confirms
      const submitted = await appRepo.updateApplicationStatus(
        appId,
        'submitted',
        'Candidate visually reviewed and manually clicked submit on host webpage'
      );

      expect(submitted.currentStatus).toBe('submitted');
      // Invariant: appliedAt must be automatically stamped when transitioning to submitted
      expect(submitted.appliedAt).toBeDefined();

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

  describe('Recruiter CRM & Automated Transition Enhancements (Phase 20, ADR-0032)', () => {
    it('persists and updates recruiter contact info and target compensation', async () => {
      const appId = createApplicationId('app_crm_1');
      const profileId = createProfileId('prof_crm');
      const jobId = createJobPostingId('job_crm_1');

      const app = createApplicationRecord({
        id: appId,
        candidateProfileId: profileId,
        jobPostingId: jobId,
        companyName: 'Stripe',
        jobTitle: 'Staff Backend Engineer',
        recruiterName: 'Sarah Jenkins',
        recruiterEmail: 'sarah.j@stripe.com',
        expectedSalary: '$220,000 - $250,000',
        notes: 'Initial outreach via recruiter message on LinkedIn.',
      });

      await appRepo.saveApplication(app);

      const saved = await appRepo.getApplicationById(appId);
      expect(saved?.recruiterName).toBe('Sarah Jenkins');
      expect(saved?.recruiterEmail).toBe('sarah.j@stripe.com');
      expect(saved?.expectedSalary).toBe('$220,000 - $250,000');
      expect(saved?.notes).toBe('Initial outreach via recruiter message on LinkedIn.');

      // Update recruiter details and snapshots
      const updated = {
        ...saved!,
        notes: 'Completed technical screen. Awaiting on-site schedule.',
        tailoredResumeSnapshot: '# Tailored Resume\n\nProven distributed systems experience...',
      };
      await appRepo.saveApplication(updated);

      const reloaded = await appRepo.getApplicationById(appId);
      expect(reloaded?.notes).toBe('Completed technical screen. Awaiting on-site schedule.');
      expect(reloaded?.tailoredResumeSnapshot).toContain('Proven distributed systems experience');
    });

    it('permits transition to submitted from ready_to_fill and dry_run_review upon ATS detection', async () => {
      const profileId = createProfileId('prof_ats');

      // Test from ready_to_fill -> submitted
      const app1 = createApplicationRecord({
        id: createApplicationId('app_ats_1'),
        candidateProfileId: profileId,
        jobPostingId: createJobPostingId('job_ats_1'),
        companyName: 'Canonical',
        jobTitle: 'Kernel Engineer',
      });
      await appRepo.saveApplication(app1);
      await appRepo.updateApplicationStatus(app1.id, 'extracting_job');
      await appRepo.updateApplicationStatus(app1.id, 'matching_profile');
      await appRepo.updateApplicationStatus(app1.id, 'ready_to_fill');

      const submittedFromReady = await appRepo.updateApplicationStatus(
        app1.id,
        'submitted',
        'Automated ATS confirmation detected'
      );
      expect(submittedFromReady.currentStatus).toBe('submitted');

      // Test from dry_run_review -> submitted
      const app2 = createApplicationRecord({
        id: createApplicationId('app_ats_2'),
        candidateProfileId: profileId,
        jobPostingId: createJobPostingId('job_ats_2'),
        companyName: 'Ashby',
        jobTitle: 'Frontend Engineer',
      });
      await appRepo.saveApplication(app2);
      await appRepo.updateApplicationStatus(app2.id, 'extracting_job');
      await appRepo.updateApplicationStatus(app2.id, 'matching_profile');
      await appRepo.updateApplicationStatus(app2.id, 'ready_to_fill');
      await appRepo.updateApplicationStatus(app2.id, 'dry_run_review');

      const submittedFromDryRun = await appRepo.updateApplicationStatus(
        app2.id,
        'submitted',
        'ATS confirmation page redirect'
      );
      expect(submittedFromDryRun.currentStatus).toBe('submitted');
    });
  });
});
