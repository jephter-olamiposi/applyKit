/**
 * @fileoverview Unit and integration tests for Data Sovereignty (Export/Import/Purge) and PII Masking.
 *
 * Verifies that backups match the canonical schema, invalid backups are safely rejected,
 * and PII sanitizers strip sensitive credentials.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { indexedDB } from 'fake-indexeddb';
import {
  createEmptyProfile,
  createProfileId,
  createJobPostingId,
  createEvidenceId,
  type CandidateProfile,
  type JobPosting,
  type Evidence,
} from '@applykit/domain';
import {
  IndexedDbProfileRepository,
  IndexedDbJobRepository,
  IndexedDbEvidenceRepository,
  exportCandidateBackup,
  importCandidateBackup,
  purgeAllLocalData,
  deleteDatabase,
  maskEmail,
  maskPhone,
  maskPii,
  maskCandidateProfileForDiagnostics,
  encryptWithPassphrase,
  decryptWithPassphrase,
} from '../storage/index.js';

describe('Data Sovereignty & Privacy Engine Suite', () => {
  beforeEach(async () => {
    await deleteDatabase(indexedDB);
  });

  afterEach(async () => {
    await deleteDatabase(indexedDB);
  });

  describe('Backup Export & Import', () => {
    it('exports a complete valid JSON backup and restores it into IndexedDB', async () => {
      // 1. Populate some data
      const profileRepo = new IndexedDbProfileRepository(indexedDB);
      const jobRepo = new IndexedDbJobRepository(indexedDB);
      const evidenceRepo = new IndexedDbEvidenceRepository(indexedDB);

      const profileId = createProfileId('default-profile');
      const profile: CandidateProfile = {
        ...createEmptyProfile(profileId),
        identity: {
          legalFirstName: 'Alex',
          legalLastName: 'Engineer',
          email: 'alex.engineer@example.com',
          phone: '555-123-4567',
          location: { city: 'San Francisco', country: 'US' },
          workAuthorization: {
            isAuthorizedInCountry: true,
            requiresSponsorship: false,
            authorizedCountries: ['US'],
          },
        },
      };

      const job: JobPosting = {
        id: createJobPostingId(),
        url: 'https://example.com/job/1',
        title: 'Lead Architect',
        companyName: 'CloudCorp',
        location: 'Remote',
        workplaceType: 'remote',
        employmentType: 'full_time',
        rawDescription: 'Lead architect description',
        parsedAt: new Date().toISOString(),
        requirements: [],
        metadata: {},
      };

      const evidence: Evidence = {
        id: createEvidenceId(),
        source: {
          type: 'git_repository',
          sourceId: 'project-repo-1',
          uri: 'https://github.com/alex/project',
        },
        description: 'Maintained open-source async runtime',
        textSnippet: 'Over 500k monthly downloads on crates.io',
        verificationStatus: 'verified',
        confidenceScore: 1.0,
        createdAt: new Date().toISOString(),
        tags: ['rust', 'open-source'],
      };

      await profileRepo.saveProfile(profile);
      await jobRepo.saveJob(job);
      await evidenceRepo.saveEvidence(evidence);

      profileRepo.close();
      jobRepo.close();
      evidenceRepo.close();

      // 2. Export backup
      const backupJson = await exportCandidateBackup(indexedDB);
      expect(backupJson).toBeDefined();

      const parsed = JSON.parse(backupJson);
      expect(parsed.schemaVersion).toBe(1);
      expect(parsed.profile?.identity.legalFirstName).toBe('Alex');
      expect(parsed.jobs.length).toBe(1);
      expect(parsed.evidence.length).toBe(1);

      // 3. Purge existing data
      await purgeAllLocalData(indexedDB);

      // Verify empty after purge
      const checkRepo = new IndexedDbProfileRepository(indexedDB);
      const purgedProfile = await checkRepo.getProfile();
      expect(purgedProfile).toBeNull();
      checkRepo.close();

      // 4. Restore backup
      const importResult = await importCandidateBackup(backupJson, indexedDB);
      expect(importResult.success).toBe(true);

      // Verify restored data
      const verifyProfileRepo = new IndexedDbProfileRepository(indexedDB);
      const verifyJobRepo = new IndexedDbJobRepository(indexedDB);
      const verifyEvidenceRepo = new IndexedDbEvidenceRepository(indexedDB);

      const restoredProfile = await verifyProfileRepo.getProfile();
      expect(restoredProfile?.identity.legalFirstName).toBe('Alex');
      expect(restoredProfile?.identity.email).toBe('alex.engineer@example.com');

      const restoredJobs = await verifyJobRepo.listJobs();
      expect(restoredJobs.length).toBe(1);
      expect(restoredJobs[0]?.title).toBe('Lead Architect');

      const restoredEvidence = await verifyEvidenceRepo.listEvidence();
      expect(restoredEvidence.length).toBe(1);
      expect(restoredEvidence[0]?.textSnippet).toContain('500k monthly downloads');

      verifyProfileRepo.close();
      verifyJobRepo.close();
      verifyEvidenceRepo.close();
    });

    it('rejects invalid or corrupted JSON payloads safely', async () => {
      const invalidJsonResult = await importCandidateBackup('not a json string', indexedDB);
      expect(invalidJsonResult.success).toBe(false);
      expect(invalidJsonResult.error).toContain('Invalid JSON');

      const wrongVersionResult = await importCandidateBackup(
        JSON.stringify({ schemaVersion: 99, profile: {} }),
        indexedDB
      );
      expect(wrongVersionResult.success).toBe(false);
      expect(wrongVersionResult.error).toContain('Unsupported backup schema version');

      const missingProfileResult = await importCandidateBackup(
        JSON.stringify({ schemaVersion: 1 }),
        indexedDB
      );
      expect(missingProfileResult.success).toBe(false);
      expect(missingProfileResult.error).toContain('missing valid candidate profile');
    });
  });

  describe('PII Masking Utilities', () => {
    it('masks email addresses accurately', () => {
      expect(maskEmail('jane.doe@example.org')).toBe('j***e@example.org');
      expect(maskEmail('a@b.com')).toBe('***@***');
    });

    it('masks phone numbers preserving last 4 digits', () => {
      expect(maskPhone('+1 (555) 234-5678')).toBe('***-***-5678');
      expect(maskPhone('123')).toBe('***-***');
    });

    it('redacts multiple PII entities in free text strings', () => {
      const text = 'Reach me at candidate@test.com or call 555-890-1234. SSN is 123-45-6789.';
      const masked = maskPii(text);

      expect(masked).not.toContain('candidate@test.com');
      expect(masked).not.toContain('555-890-1234');
      expect(masked).not.toContain('123-45-6789');
      expect(masked).toContain('***-**-****');
    });

    it('produces diagnostic-safe profile summaries with masked contact info', () => {
      const profile: CandidateProfile = {
        ...createEmptyProfile(createProfileId('diag-prof')),
        identity: {
          legalFirstName: 'Robert',
          legalLastName: 'Smith',
          email: 'robert.smith@domain.com',
          phone: '555-444-3322',
          location: { city: 'Austin', country: 'US' },
          workAuthorization: {
            isAuthorizedInCountry: true,
            requiresSponsorship: false,
            authorizedCountries: ['US'],
          },
        },
      };

      const sanitized = maskCandidateProfileForDiagnostics(profile);
      const identity = sanitized['identity'] as Record<string, string>;

      expect(identity['legalFirstName']).toBe('R***');
      expect(identity['legalLastName']).toBe('S***');
      expect(identity['email']).toBe('r***h@domain.com');
      expect(identity['phone']).toBe('***-***-3322');
    });
  });

  describe('Passphrase Web Crypto Helpers', () => {
    it('encrypts and decrypts secret strings with AES-GCM and PBKDF2', async () => {
      const secretKey = 'sk-proj-super-secret-api-key-12345';
      const passphrase = 'correct-horse-battery-staple';

      const encrypted = await encryptWithPassphrase(secretKey, passphrase);
      expect(encrypted).toBeDefined();
      expect(encrypted).not.toBe(secretKey);

      const decrypted = await decryptWithPassphrase(encrypted, passphrase);
      expect(decrypted).toBe(secretKey);
    });

    it('fails decryption when provided incorrect passphrase', async () => {
      const secretKey = 'sk-proj-test-key';
      const encrypted = await encryptWithPassphrase(secretKey, 'password-one');

      await expect(decryptWithPassphrase(encrypted, 'wrong-password')).rejects.toThrow();
    });
  });
});
