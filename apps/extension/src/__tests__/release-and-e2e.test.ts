/**
 * @fileoverview End-to-End Candidate Journey, Packaging, and Store Compliance Suite (Phase 15 - ADR-0022).
 *
 * Verifies the complete lifecycle of ApplyKit:
 * 1. Chrome Web Store manifest, icons, bundle integrity, and distribution ZIP packaging.
 * 2. Full end-to-end candidate journey simulation:
 *    First-Run Onboarding -> Profile Setup -> Evidence Ingestion -> Job Extraction ->
 *    Requirement Matching -> Dry-Run Plan Formulation -> Anti-Autonomous Submit Gate ->
 *    Application Tracking -> Audit Trail Export -> Right to Erasure.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { indexedDB } from 'fake-indexeddb';
import {
  createEmptyProfile,
  createProfileId,
  createJobPostingId,
  createApplicationId,
  createEvidenceId,
  createRequirementId,
  createFieldId,
  createSkillId,
  createApplicationRecord,
  transitionApplicationRecord,
  evaluateJobRequirements,
  generateDryRunPlan,
  deriveClaimsFromEvidence,
  buildEvidenceGraph,
  type CandidateProfile,
  type JobPosting,
  type Evidence,
  type ApplicationForm,
  type ApplicationField,
  type ExecutionOptions,
} from '@applykit/domain';
import {
  IndexedDbProfileRepository,
  IndexedDbJobRepository,
  IndexedDbApplicationRepository,
  IndexedDbEvidenceRepository,
  DEFAULT_PROFILE_KEY,
  deleteDatabase,
} from '../storage/index.js';
import {
  getStorageUsageSummary,
  purgeAllCandidateData,
} from '../storage/purge-engine.js';
import {
  setApiKey,
  getApiKeysStatus,
  PROVIDER_KEYS_STORAGE_KEY,
} from '../storage/credential-store.js';
import { executeBrowserPlan } from '../content/action-interpreter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_ROOT = path.resolve(__dirname, '..', '..');
const ROOT_DIR = path.resolve(EXTENSION_ROOT, '..', '..');
const DIST_DIR = path.join(EXTENSION_ROOT, 'dist');
const RELEASE_DIR = path.join(ROOT_DIR, 'dist-release');

describe('Release Readiness, Packaging & End-to-End Suite (Phase 15 - ADR-0022)', () => {
  let localStorageMock: Record<string, unknown> = {};

  beforeEach(async () => {
    document.body.innerHTML = '';
    localStorageMock = {};

    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn(async (key?: string | string[]) => {
            if (!key) return { ...localStorageMock };
            if (typeof key === 'string') return { [key]: localStorageMock[key] };
            const res: Record<string, unknown> = {};
            for (const k of key) {
              if (k in localStorageMock) res[k] = localStorageMock[k];
            }
            return res;
          }),
          set: vi.fn(async (items: Record<string, unknown>) => {
            Object.assign(localStorageMock, items);
          }),
          remove: vi.fn(async (keys: string | string[]) => {
            const arr = Array.isArray(keys) ? keys : [keys];
            for (const k of arr) delete localStorageMock[k];
          }),
          clear: vi.fn(async () => {
            localStorageMock = {};
          }),
        },
      },
    };

    await deleteDatabase(indexedDB);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await deleteDatabase(indexedDB);
  });

  // ==========================================================================
  // 1. Chrome Web Store Manifest & Packaging Verification
  // ==========================================================================
  describe('Chrome Web Store Package & Manifest Conformance', () => {
    const manifestPath = path.join(EXTENSION_ROOT, 'manifest.json');
    const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw);

    it('complies with Manifest V3 and CWS description limits', () => {
      expect(manifest.manifest_version).toBe(3);
      expect(manifest.name).toBe('ApplyKit - Job Application Copilot');
      expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(manifest.description.length).toBeLessThanOrEqual(132);
      expect(manifest.description.length).toBeGreaterThan(20);
    });

    it('declares and provides valid PNG icons for 16, 48, and 128 sizes', () => {
      expect(manifest.icons).toBeDefined();
      expect(manifest.icons['16']).toBe('icons/icon-16.png');
      expect(manifest.icons['48']).toBe('icons/icon-48.png');
      expect(manifest.icons['128']).toBe('icons/icon-128.png');

      const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

      for (const size of ['16', '48', '128']) {
        const iconPath = path.join(EXTENSION_ROOT, 'public', `icons/icon-${size}.png`);
        expect(fs.existsSync(iconPath), `Icon missing: ${iconPath}`).toBe(true);
        const iconBuf = fs.readFileSync(iconPath);
        expect(iconBuf.length).toBeGreaterThan(100);
        // Verify valid PNG binary magic bytes
        expect(iconBuf.subarray(0, 8).equals(pngSignature)).toBe(true);
      }
    });

    it('declares strict Content Security Policy avoiding remote code execution', () => {
      expect(manifest.content_security_policy.extension_pages).toBe(
        "script-src 'self'; object-src 'self'"
      );
    });

    it('contains valid release ZIP archive matching version', () => {
      const zipPath = path.join(RELEASE_DIR, `applykit-extension-v${manifest.version}.zip`);
      expect(fs.existsSync(zipPath), `Release zip missing: ${zipPath}`).toBe(true);

      const zipBuf = fs.readFileSync(zipPath);
      expect(zipBuf.length).toBeGreaterThan(1000); // Greater than 1KB
      expect(zipBuf.length).toBeLessThan(10 * 1024 * 1024); // Well under 10MB limit

      // Verify ZIP file signature: PK\x03\x04
      const zipSignature = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
      expect(zipBuf.subarray(0, 4).equals(zipSignature)).toBe(true);
    });
  });

  // ==========================================================================
  // 2. Full End-to-End Candidate Lifecycle Journey
  // ==========================================================================
  describe('Full End-to-End Candidate Journey Simulation', () => {
    it('executes complete lifecycle: onboarding -> extraction -> match -> plan -> gated review -> audit -> erasure', async () => {
      // ----------------------------------------------------------------------
      // Step 1: Initial Empty State
      // ----------------------------------------------------------------------
      const initialUsage = await getStorageUsageSummary(indexedDB);
      expect(initialUsage.hasProfile).toBe(false);
      expect(initialUsage.evidenceCount).toBe(0);
      expect(localStorageMock.applykit_onboarding_completed).toBeUndefined();

      // ----------------------------------------------------------------------
      // Step 2: First-Run Onboarding Wizard Setup
      // ----------------------------------------------------------------------
      const profileRepo = new IndexedDbProfileRepository(indexedDB);
      const profileId = createProfileId(DEFAULT_PROFILE_KEY);
      const baseProfile = createEmptyProfile(profileId);

      const onboardingProfile: CandidateProfile = {
        ...baseProfile,
        identity: {
          ...baseProfile.identity,
          legalFirstName: 'Ada',
          legalLastName: 'Lovelace',
          email: 'ada.lovelace@example.org',
          phone: '+1 (555) 123-4567',
          location: {
            city: 'London',
            country: 'United Kingdom',
          },
          workAuthorization: {
            isAuthorizedInCountry: true,
            requiresSponsorship: false,
            authorizedCountries: ['United Kingdom', 'United States'],
          },
        },
        professional: {
          ...baseProfile.professional,
          headline: 'Pioneer of Algorithmic Computation',
        },
        skills: [
          {
            id: createSkillId('skill-1'),
            name: 'TypeScript',
            normalizedName: 'typescript',
            category: 'language',
            proficiency: 'expert',
            evidenceRefs: [],
          },
          {
            id: createSkillId('skill-2'),
            name: 'Distributed Systems',
            normalizedName: 'distributed systems',
            category: 'framework',
            proficiency: 'expert',
            evidenceRefs: [],
          },
        ],
      };
      await profileRepo.saveProfile(onboardingProfile);

      // Ingest sample resume text into Evidence Graph
      const evidenceRepo = new IndexedDbEvidenceRepository(indexedDB);
      const evidenceItem: Evidence = {
        id: createEvidenceId('ev-e2e-001'),
        source: {
          type: 'resume_bullet',
          sourceId: 'analytical_engine_spec.pdf',
        },
        description: 'Architected the first analytical computation engine',
        textSnippet: 'Architected the first analytical computation engine processing complex algebraic sequences.',
        verificationStatus: 'verified',
        confidenceScore: 0.98,
        createdAt: new Date().toISOString(),
        tags: ['computation', 'algorithms', 'typescript', 'distributed systems'],
      };
      await evidenceRepo.saveEvidence(evidenceItem);

      const claims = deriveClaimsFromEvidence([evidenceItem]);
      for (const claim of claims) {
        await evidenceRepo.saveClaim(claim);
      }

      // Configure provider API key
      await setApiKey('openai', 'sk-proj-test-live-key-999');
      const keyStatus = await getApiKeysStatus();
      expect(keyStatus.openai).toBe(true);

      // Persist onboarding completion flag
      await chrome.storage.local.set({ applykit_onboarding_completed: true });
      expect(localStorageMock.applykit_onboarding_completed).toBe(true);

      profileRepo.close();
      evidenceRepo.close();

      // Verify intermediate storage state
      const postOnboardingUsage = await getStorageUsageSummary(indexedDB);
      expect(postOnboardingUsage.hasProfile).toBe(true);
      expect(postOnboardingUsage.candidateName).toBe('Ada Lovelace');
      expect(postOnboardingUsage.evidenceCount).toBeGreaterThanOrEqual(1);

      // ----------------------------------------------------------------------
      // Step 3: ATS Job Posting Extraction
      // ----------------------------------------------------------------------
      const jobRepo = new IndexedDbJobRepository(indexedDB);
      const targetJob: JobPosting = {
        id: createJobPostingId('job-applied-001'),
        url: 'https://boards.greenhouse.io/babbage/jobs/12345',
        title: 'Lead Computational Systems Architect',
        companyName: 'Babbage Analytical',
        location: 'London, UK',
        workplaceType: 'hybrid',
        employmentType: 'full_time',
        rawDescription:
          'Seeking an architect with deep knowledge of TypeScript and Distributed Systems.',
        parsedAt: new Date().toISOString(),
        requirements: [
          {
            id: createRequirementId('req-ts'),
            rawText: 'Expert knowledge of TypeScript architecture',
            normalizedSkillOrCompetency: 'TypeScript',
            category: 'technical_skill',
            importance: 'required',
            yearsRequired: 4,
            isRequired: true,
            matchedEvidenceIds: [],
          },
          {
            id: createRequirementId('req-dist'),
            rawText: 'Experience designing distributed systems',
            normalizedSkillOrCompetency: 'Distributed Systems',
            category: 'technical_skill',
            importance: 'required',
            yearsRequired: 3,
            isRequired: true,
            matchedEvidenceIds: [],
          },
          {
            id: createRequirementId('req-rust'),
            rawText: 'Experience with Rust systems programming',
            normalizedSkillOrCompetency: 'Rust',
            category: 'technical_skill',
            importance: 'preferred',
            yearsRequired: 2,
            isRequired: false,
            matchedEvidenceIds: [],
          },
        ],
        metadata: { ats: 'greenhouse' },
      };
      await jobRepo.saveJob(targetJob);
      jobRepo.close();

      // ----------------------------------------------------------------------
      // Step 4: Requirement Matching & Gap Analysis
      // ----------------------------------------------------------------------
      const evidenceGraph = buildEvidenceGraph([evidenceItem], claims);
      const matchResult = evaluateJobRequirements(
        targetJob.requirements,
        onboardingProfile,
        evidenceGraph
      );
      // TypeScript & Distributed Systems matched via profile skills, Rust not present
      expect(matchResult.matches.filter((m) => m.isMatched).length).toBe(2);
      expect(matchResult.matches.find((m) => !m.isMatched)?.matchTier).toBe('unmatched');
      // Both required skills grounded; the single unmatched Rust requirement is preferred-only
      expect(matchResult.requiredMetCount).toBe(2);
      expect(matchResult.requiredCount).toBe(2);
      expect(matchResult.hardGapsCount).toBe(0);
      expect(matchResult.softGapsCount).toBe(1);
      expect(matchResult.overallMatchScore).toBeGreaterThanOrEqual(60);

      // ----------------------------------------------------------------------
      // Step 5: Application Form Crawling & Field Detection
      // ----------------------------------------------------------------------
      const mockForm: ApplicationForm = {
        id: 'form-greenhouse-001',
        url: targetJob.url,
        detectedAts: 'greenhouse',
        isMultiStep: false,
        inspectedAt: new Date().toISOString(),
        fields: [
          {
            id: createFieldId('f_first_name'),
            name: 'first_name',
            label: 'First Name',
            fieldType: 'text',
            selector: 'input#first_name',
            isRequired: true,
            isHoneypotSuspect: false,
            confidenceScore: 0.99,
            inferredMappingKey: 'identity.legalFirstName',
          },
          {
            id: createFieldId('f_last_name'),
            name: 'last_name',
            label: 'Last Name',
            fieldType: 'text',
            selector: 'input#last_name',
            isRequired: true,
            isHoneypotSuspect: false,
            confidenceScore: 0.99,
            inferredMappingKey: 'identity.legalLastName',
          },
          {
            id: createFieldId('f_email'),
            name: 'email',
            label: 'Email',
            fieldType: 'text',
            selector: 'input#email',
            isRequired: true,
            isHoneypotSuspect: false,
            confidenceScore: 0.99,
            inferredMappingKey: 'identity.email',
          },
          {
            id: createFieldId('f_honeypot'),
            name: 'website_url_hp',
            label: 'Leave Empty',
            fieldType: 'text',
            selector: 'input.hp-trap',
            isRequired: false,
            isHoneypotSuspect: true,
            confidenceScore: 0.1,
          },
        ],
        submitButtonSelector: 'button[type="submit"]',
      };

      // ----------------------------------------------------------------------
      // Step 6: Dry-Run Plan Generation & Risk Tagging
      // ----------------------------------------------------------------------
      const dryRunPlan = generateDryRunPlan(mockForm, onboardingProfile);

      expect(dryRunPlan.actions.length).toBe(3); // First name, last name, email (honeypot excluded)
      expect(dryRunPlan.skippedFields.length).toBe(1);
      expect(dryRunPlan.skippedFields[0]?.reason).toBe('honeypot_trap');

      // ----------------------------------------------------------------------
      // Step 7: DOM Execution & Anti-Autonomous Submit Gate (ADR-0006)
      // ----------------------------------------------------------------------
      // Setup DOM inputs
      const fnInput = document.createElement('input');
      fnInput.id = 'first_name';
      document.body.appendChild(fnInput);

      const lnInput = document.createElement('input');
      lnInput.id = 'last_name';
      document.body.appendChild(lnInput);

      const emInput = document.createElement('input');
      emInput.id = 'email';
      document.body.appendChild(emInput);

      const submitBtn = document.createElement('button');
      submitBtn.type = 'submit';
      submitBtn.innerText = 'Submit Application';
      let submitClicked = false;
      submitBtn.addEventListener('click', () => {
        submitClicked = true;
      });
      document.body.appendChild(submitBtn);

      // Execute approved plan actions with instant pacing
      const executionOptions: ExecutionOptions = {
        pacingMode: 'instant',
        pacingDelayMs: 0,
        highlightElements: false,
      };
      const report = await executeBrowserPlan(dryRunPlan, document, executionOptions);

      // All three planned fill actions are low-risk and auto-confirmed
      expect(dryRunPlan.isApproved).toBe(true);
      expect(report.totalPlanned).toBe(3);
      expect(report.executedCount).toBe(3);
      expect(report.failedCount).toBe(0);
      expect(report.haltedAtSubmissionGate).toBe(true);
      expect(fnInput.value).toBe('Ada');
      expect(lnInput.value).toBe('Lovelace');
      expect(emInput.value).toBe('ada.lovelace@example.org');

      // VERIFY HARD GATE: Submit button was NEVER clicked automatically
      expect(submitClicked).toBe(false);

      // ----------------------------------------------------------------------
      // Step 8: Application Lifecycle Tracking & Audit Logging
      // ----------------------------------------------------------------------
      const appRepo = new IndexedDbApplicationRepository(indexedDB);
      const appId = createApplicationId('app-e2e-001');
      let appRecord = createApplicationRecord(appId, profileId, targetJob.id);
      await appRepo.saveApplication(appRecord);

      // Simulate a valid lifecycle walk from detection through human review and submission
      appRecord = transitionApplicationRecord(appRecord, 'detected_job');
      appRecord = transitionApplicationRecord(appRecord, 'extracting_job');
      appRecord = transitionApplicationRecord(appRecord, 'matching_profile');
      appRecord = transitionApplicationRecord(appRecord, 'ready_to_fill');
      appRecord = transitionApplicationRecord(appRecord, 'dry_run_review');
      appRecord = transitionApplicationRecord(appRecord, 'executing_actions');
      appRecord = transitionApplicationRecord(appRecord, 'awaiting_user_review');
      appRecord = transitionApplicationRecord(appRecord, 'submitted');
      await appRepo.saveApplication(appRecord);

      const savedApp = await appRepo.getApplicationById(appId);
      expect(savedApp?.currentStatus).toBe('submitted');
      appRepo.close();

      // ----------------------------------------------------------------------
      // Step 9: Right to Erasure (Complete Data Purge)
      // ----------------------------------------------------------------------
      const purgeResult = await purgeAllCandidateData(indexedDB);
      expect(purgeResult.success).toBe(true);
      expect(purgeResult.keysCleared).toBe(true);

      const finalUsage = await getStorageUsageSummary(indexedDB);
      expect(finalUsage.hasProfile).toBe(false);
      expect(finalUsage.evidenceCount).toBe(0);
      expect(finalUsage.applicationsCount).toBe(0);
      expect(finalUsage.jobsCount).toBe(0);
      expect(finalUsage.keysConfiguredCount).toBe(0);
      expect(localStorageMock[PROVIDER_KEYS_STORAGE_KEY]).toBeUndefined();
    });
  });
});
