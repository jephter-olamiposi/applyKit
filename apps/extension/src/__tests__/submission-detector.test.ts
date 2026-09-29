/**
 * @fileoverview Test suite for Automated ATS Submission Detector (Phase 20, ADR-0032).
 *
 * Verifies detection of post-submission confirmation URLs (Greenhouse, Lever, Workday,
 * Ashby, Canonical), DOM thank-you headings, and immutable transitions to 'submitted'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isSubmissionConfirmationUrl,
  isSubmissionConfirmationText,
  processSubmissionDetection,
} from '../background/submission-detector.js';
import {
  createApplicationRecord,
  createApplicationId,
  createProfileId,
  createJobPostingId,
  type ApplicationRecord,
} from '@applykit/domain';
import * as appRepoModule from '../storage/application-repository.js';

describe('Automated ATS Submission Detector Test Suite', () => {
  describe('isSubmissionConfirmationUrl', () => {
    it('detects Greenhouse confirmation URLs', () => {
      const result = isSubmissionConfirmationUrl('https://boards.greenhouse.io/canonical/jobs/4581200/confirmation');
      expect(result.isConfirmation).toBe(true);
      expect(result.atsType).toBe('greenhouse');
    });

    it('detects Lever thanks URLs', () => {
      const result = isSubmissionConfirmationUrl('https://jobs.lever.co/stripe/3762819/thanks');
      expect(result.isConfirmation).toBe(true);
      expect(result.atsType).toBe('lever');
    });

    it('detects Workday applied and thankyou URLs', () => {
      const result1 = isSubmissionConfirmationUrl('https://canonical.myworkdayjobs.com/en-US/Canonical/applied');
      expect(result1.isConfirmation).toBe(true);
      expect(result1.atsType).toBe('workday');

      const result2 = isSubmissionConfirmationUrl('https://adobe.myworkdayjobs.com/en-US/Adobe/thankyou');
      expect(result2.isConfirmation).toBe(true);
      expect(result2.atsType).toBe('workday');
    });

    it('detects Ashby application-submitted URLs', () => {
      const result = isSubmissionConfirmationUrl('https://jobs.ashbyhq.com/linear/application-submitted');
      expect(result.isConfirmation).toBe(true);
      expect(result.atsType).toBe('ashby');
    });

    it('detects Canonical Careers thank-you URLs', () => {
      const result = isSubmissionConfirmationUrl('https://canonical.com/careers/4581200/thank-you');
      expect(result.isConfirmation).toBe(true);
    });

    it('rejects standard job description and application form URLs', () => {
      expect(isSubmissionConfirmationUrl('https://canonical.com/careers/4581200').isConfirmation).toBe(false);
      expect(isSubmissionConfirmationUrl('https://boards.greenhouse.io/canonical/jobs/4581200').isConfirmation).toBe(false);
      expect(isSubmissionConfirmationUrl('https://jobs.lever.co/stripe/123').isConfirmation).toBe(false);
      expect(isSubmissionConfirmationUrl('').isConfirmation).toBe(false);
    });
  });

  describe('isSubmissionConfirmationText', () => {
    it('recognizes diverse receipt and confirmation phrases', () => {
      expect(isSubmissionConfirmationText('Thank you for applying to Canonical')).toBe(true);
      expect(isSubmissionConfirmationText('Your application has been received')).toBe(true);
      expect(isSubmissionConfirmationText('Thanks for applying! We will be in touch.')).toBe(true);
      expect(isSubmissionConfirmationText('Application Submitted Successfully')).toBe(true);
    });

    it('rejects standard job posting descriptions and form labels', () => {
      expect(isSubmissionConfirmationText('Distributed Systems Engineer - Canonical')).toBe(false);
      expect(isSubmissionConfirmationText('Submit your resume and portfolio')).toBe(false);
      expect(isSubmissionConfirmationText('Required Experience: 5+ years with Go')).toBe(false);
      expect(isSubmissionConfirmationText('')).toBe(false);
    });
  });

  describe('processSubmissionDetection', () => {
    let mockSavedApp: ApplicationRecord | null = null;
    let mockList: ApplicationRecord[] = [];

    beforeEach(() => {
      mockSavedApp = null;
      const app = createApplicationRecord({
        id: createApplicationId('app_canonical_1'),
        candidateProfileId: createProfileId('prof_1'),
        jobPostingId: createJobPostingId('job_canonical'),
        companyName: 'Canonical',
        jobTitle: 'Distributed Systems Engineer',
        jobPostingUrl: 'https://canonical.com/careers/4581200',
        matchedRequirementsScore: 0.94,
      });

      // Set to awaiting_user_review
      mockList = [
        {
          ...app,
          currentStatus: 'awaiting_user_review',
        },
      ];

      vi.spyOn(appRepoModule, 'getApplicationRepository').mockReturnValue({
        listApplications: vi.fn().mockImplementation(async () => mockList),
        saveApplication: vi.fn().mockImplementation(async (record) => {
          mockSavedApp = record;
        }),
        getApplicationById: vi.fn(),
        getApplicationByJobId: vi.fn(),
        deleteApplication: vi.fn(),
        updateApplicationStatus: vi.fn(),
      });
    });

    it('transitions active application to submitted upon confirmation URL match', async () => {
      const result = await processSubmissionDetection(
        'https://canonical.com/careers/4581200/confirmation',
        'Thank You For Applying'
      );

      expect(result.success).toBe(true);
      expect(result.applicationId).toBe('app_canonical_1');
      expect(result.previousStatus).toBe('awaiting_user_review');
      expect(result.newStatus).toBe('submitted');

      expect(mockSavedApp).not.toBeNull();
      expect(mockSavedApp?.currentStatus).toBe('submitted');
      expect(mockSavedApp?.appliedAt).toBeDefined();
    });

    it('is idempotent if application is already in submitted status', async () => {
      const existing = mockList[0]!;
      mockList[0] = {
        ...existing,
        currentStatus: 'submitted',
        appliedAt: '2026-09-28T18:00:00Z',
      };

      const result = await processSubmissionDetection(
        'https://canonical.com/careers/4581200/confirmation'
      );

      expect(result.success).toBe(true);
      expect(result.newStatus).toBe('submitted');
      // Should not re-save or overwrite appliedAt
      expect(mockSavedApp).toBeNull();
    });

    it('rejects URLs that do not match confirmation signals', async () => {
      const result = await processSubmissionDetection(
        'https://canonical.com/careers/4581200',
        'Job Posting Description'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('did not match');
    });
  });
});
