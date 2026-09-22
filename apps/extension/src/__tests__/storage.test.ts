/**
 * @fileoverview Unit and integration tests for local-first IndexedDB repositories.
 *
 * Verifies local persistence (ADR-0001, ADR-0004) for CandidateProfile, JobPosting,
 * ApplicationRecord, and Evidence items using in-memory IndexedDB.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import {
  createEmptyProfile,
  createProfileId,
  createJobPostingId,
  createApplicationId,
  createEvidenceId,
  createClaimId,
  createSkillId,
  normalizeSkillName,
  createApplicationRecord,
  type CandidateProfile,
  type JobPosting,
  type Evidence,
  type CandidateClaim,
} from '@applykit/domain';
import {
  IndexedDbProfileRepository,
  IndexedDbJobRepository,
  IndexedDbApplicationRepository,
  IndexedDbEvidenceRepository,
  deleteDatabase,
  DEFAULT_PROFILE_KEY,
} from '../storage/index.js';

describe('IndexedDB Local-First Repositories Suite', () => {
  beforeEach(async () => {
    await deleteDatabase(indexedDB);
  });

  afterEach(async () => {
    await deleteDatabase(indexedDB);
  });

  describe('IndexedDbProfileRepository', () => {
    it('persists, updates, and retrieves candidate profile aggregate', async () => {
      const repo = new IndexedDbProfileRepository(indexedDB);
      const profileId = createProfileId(DEFAULT_PROFILE_KEY);
      const baseProfile = createEmptyProfile(profileId);

      const customProfile: CandidateProfile = {
        ...baseProfile,
        identity: {
          ...baseProfile.identity,
          legalFirstName: 'Jane',
          legalLastName: 'Developer',
          email: 'jane.dev@example.org',
        },
        professional: {
          ...baseProfile.professional,
          headline: 'Senior Systems Architect',
        },
        skills: [
          {
            id: createSkillId(),
            name: 'Rust',
            normalizedName: normalizeSkillName('Rust'),
            category: 'language',
            proficiency: 'expert',
            evidenceRefs: [],
          },
          {
            id: createSkillId(),
            name: 'PostgreSQL',
            normalizedName: normalizeSkillName('PostgreSQL'),
            category: 'database',
            proficiency: 'advanced',
            evidenceRefs: [],
          },
        ],
      };

      await repo.saveProfile(customProfile);

      const loaded = await repo.getProfile(profileId);
      expect(loaded).toBeDefined();
      expect(loaded?.identity.legalFirstName).toBe('Jane');
      expect(loaded?.identity.legalLastName).toBe('Developer');
      expect(loaded?.skills.length).toBe(2);

      // Verify profile summary calculation
      const summary = await repo.getProfileSummary();
      expect(summary.fullName).toBe('Jane Developer');
      expect(summary.headline).toBe('Senior Systems Architect');
      expect(summary.email).toBe('jane.dev@example.org');
      expect(summary.skillsCount).toBe(2);
      expect(summary.isComplete).toBe(true);

      // Verify deletion
      await repo.deleteProfile(profileId);
      const afterDelete = await repo.getProfile(profileId);
      expect(afterDelete).toBeNull();

      repo.close();
    });

    it('returns sensible defaults when no profile exists', async () => {
      const repo = new IndexedDbProfileRepository(indexedDB);
      const summary = await repo.getProfileSummary();

      expect(summary.fullName).toBe('Candidate');
      expect(summary.skillsCount).toBe(0);
      expect(summary.isComplete).toBe(false);

      repo.close();
    });
  });

  describe('IndexedDbJobRepository', () => {
    it('saves, queries by URL and ID, and lists recent jobs', async () => {
      const repo = new IndexedDbJobRepository(indexedDB);

      const job1: JobPosting = {
        id: createJobPostingId(),
        url: 'https://example.com/jobs/senior-rust',
        title: 'Senior Rust Engineer',
        companyName: 'Acme Systems',
        location: 'Remote',
        workplaceType: 'remote',
        employmentType: 'full_time',
        rawDescription: 'Build high-throughput systems',
        parsedAt: new Date(Date.now() - 10000).toISOString(),
        requirements: [],
        metadata: {},
      };

      const job2: JobPosting = {
        id: createJobPostingId(),
        url: 'https://example.com/jobs/staff-platform',
        title: 'Staff Platform Engineer',
        companyName: 'Acme Cloud',
        location: 'New York, NY',
        workplaceType: 'hybrid',
        employmentType: 'full_time',
        rawDescription: 'Kubernetes and infrastructure',
        parsedAt: new Date().toISOString(),
        requirements: [],
        metadata: {},
      };

      await repo.saveJob(job1);
      await repo.saveJob(job2);

      // Lookup by ID
      const fetchedById = await repo.getJobById(job1.id);
      expect(fetchedById?.title).toBe('Senior Rust Engineer');

      // Lookup by URL
      const fetchedByUrl = await repo.getJobByUrl('https://example.com/jobs/staff-platform');
      expect(fetchedByUrl?.title).toBe('Staff Platform Engineer');

      // List ordered by parsedAt descending
      const list = await repo.listJobs(10);
      expect(list.length).toBe(2);
      expect(list[0]?.id).toBe(job2.id); // More recent parsedAt
      expect(list[1]?.id).toBe(job1.id);

      // Delete job
      await repo.deleteJob(job1.id);
      const remaining = await repo.listJobs();
      expect(remaining.length).toBe(1);
      expect(remaining[0]?.id).toBe(job2.id);

      repo.close();
    });
  });

  describe('IndexedDbApplicationRepository', () => {
    it('manages application journey lifecycle and queries by jobPostingId', async () => {
      const repo = new IndexedDbApplicationRepository(indexedDB);
      const appId = createApplicationId();
      const profileId = createProfileId();
      const jobId = createJobPostingId();

      const appRecord = createApplicationRecord(appId, profileId, jobId);
      await repo.saveApplication(appRecord);

      const loaded = await repo.getApplicationById(appId);
      expect(loaded).toBeDefined();
      expect(loaded?.currentStatus).toBe('idle');

      // Query by jobPostingId
      const byJob = await repo.getApplicationByJobId(jobId);
      expect(byJob?.id).toBe(appId);

      // Update application state
      const updated = {
        ...loaded!,
        currentStatus: 'ready_to_fill' as const,
        filledFieldsCount: 5,
      };
      await repo.saveApplication(updated);

      const reloaded = await repo.getApplicationById(appId);
      expect(reloaded?.currentStatus).toBe('ready_to_fill');
      expect(reloaded?.filledFieldsCount).toBe(5);

      // List applications
      const apps = await repo.listApplications();
      expect(apps.length).toBe(1);

      // Delete
      await repo.deleteApplication(appId);
      const afterDelete = await repo.getApplicationById(appId);
      expect(afterDelete).toBeNull();

      repo.close();
    });
  });

  describe('IndexedDbEvidenceRepository', () => {
    it('persists and retrieves atomic evidence items and candidate claims', async () => {
      const repo = new IndexedDbEvidenceRepository(indexedDB);
      const evidenceId = createEvidenceId();
      const claimId = createClaimId();

      const evidenceItem: Evidence = {
        id: evidenceId,
        source: {
          type: 'resume_bullet',
          sourceId: 'doc-1',
        },
        description: 'Led distributed database migration to PostgreSQL',
        textSnippet: 'Migrated 4TB database cluster with zero downtime',
        verificationStatus: 'verified',
        confidenceScore: 0.95,
        createdAt: new Date().toISOString(),
        tags: ['postgresql', 'database', 'migration'],
      };

      const claimItem: CandidateClaim = {
        id: claimId,
        statement: 'Expert proficiency with PostgreSQL database migrations',
        claimType: 'skill_proficiency',
        supportedByEvidenceIds: [evidenceId],
        confidence: 0.95,
        tags: ['postgresql'],
        createdAt: new Date().toISOString(),
      };

      await repo.saveEvidence(evidenceItem);
      await repo.saveClaim(claimItem);

      const fetchedEvidence = await repo.getEvidenceById(evidenceId);
      expect(fetchedEvidence?.textSnippet).toContain('zero downtime');

      const fetchedClaim = await repo.getClaimById(claimId);
      expect(fetchedClaim?.supportedByEvidenceIds).toContain(evidenceId);

      const evidenceList = await repo.listEvidence();
      expect(evidenceList.length).toBe(1);

      const claimsList = await repo.listClaims();
      expect(claimsList.length).toBe(1);

      repo.close();
    });
  });
});
