/**
 * @fileoverview Unit and compliance tests for Extension Security, Anti-Detection Pacing, and Right to Erasure.
 *
 * Verifies critical safety and compliance invariants:
 * 1. Manifest V3 Content Security Policy and minimal privilege permissions (ADR-0021).
 * 2. Static source code audit for forbidden dynamic code evaluation (eval, Function) and telemetry SDKs.
 * 3. Human Pacing Engine keystroke cadence, spatial coordinate jitter, and synthetic event lifecycles.
 * 4. Anti-Detection Non-Poisoning Invariant (ADR-0014, ADR-0021): zero DOM property or prototype tampering.
 * 5. GDPR / CCPA Right to Erasure Data Purge Engine and storage usage audit telemetry (ADR-0001, ADR-0021).
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
  createClaimId,
  createApplicationRecord,
  type CandidateProfile,
  type JobPosting,
  type Evidence,
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
  PROVIDER_KEYS_STORAGE_KEY,
} from '../storage/credential-store.js';
import {
  calculateRandomDelay,
  calculateElementClickCoordinates,
  dispatchRealisticPointerSequence,
  typeTextProgressively,
  sleep,
} from '../content/pacing-engine.js';

// Resolve directory paths for file inspection
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const EXTENSION_ROOT = path.resolve(__dirname, '..', '..');

describe('Security, Compliance & Anti-Detection Suite (Phase 14 - ADR-0021)', () => {
  let localStorageMock: Record<string, unknown> = {};

  beforeEach(async () => {
    document.body.innerHTML = '';
    localStorageMock = {};

    // Mock chrome.storage.local for isolated testing
    (globalThis as unknown as { chrome: unknown }).chrome = {
      storage: {
        local: {
          get: vi.fn(async (key?: string | string[]) => {
            if (!key) return { ...localStorageMock };
            if (typeof key === 'string') {
              return { [key]: localStorageMock[key] };
            }
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
            for (const k of arr) {
              delete localStorageMock[k];
            }
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
  // 1. Manifest V3 Content Security Policy & Permissions Audit
  // ==========================================================================
  describe('Manifest V3 Security & Content Security Policy', () => {
    const manifestPath = path.join(EXTENSION_ROOT, 'manifest.json');
    const manifestRaw = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(manifestRaw);

    it('enforces Manifest V3 specification', () => {
      expect(manifest.manifest_version).toBe(3);
    });

    it('enforces strict self-hosted Content Security Policy without unsafe-eval or remote origins', () => {
      expect(manifest.content_security_policy).toBeDefined();
      expect(manifest.content_security_policy.extension_pages).toBe(
        "script-src 'self'; object-src 'self'"
      );
    });

    it('does not request high-risk or unnecessary surveillance permissions', () => {
      const dangerousPermissions = [
        'webRequestBlocking',
        'cookies',
        'debugger',
        'management',
        'privacy',
        'proxy',
        'webNavigation',
      ];

      for (const dangerous of dangerousPermissions) {
        expect(manifest.permissions).not.toContain(dangerous);
      }
    });

    it('limits host permissions to prevent unauthorized background surveillance', () => {
      // Must never request broad <all_urls> host surveillance
      if (manifest.host_permissions) {
        expect(manifest.host_permissions).not.toContain('<all_urls>');
        expect(manifest.host_permissions).not.toContain('*://*/*');
      }
    });
  });

  // ==========================================================================
  // 2. Static Codebase Audit for Forbidden Patterns & Telemetry
  // ==========================================================================
  function getAllSourceFiles(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__' && entry.name !== 'dist' && entry.name !== 'node_modules') {
          results.push(...getAllSourceFiles(fullPath));
        }
      } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
        if (!entry.name.endsWith('.test.ts') && !entry.name.endsWith('.test.tsx')) {
          results.push(fullPath);
        }
      }
    }
    return results;
  }

  const srcDir = path.join(EXTENSION_ROOT, 'src');

  describe('Static Codebase Integrity Audit', () => {
    const sourceFiles = getAllSourceFiles(srcDir);

    it('contains zero dynamic code evaluation (eval / new Function) in production paths', () => {
      const evalPattern = /\beval\s*\(/;
      const functionConstructorPattern = /new\s+Function\s*\(/;

      for (const file of sourceFiles) {
        const content = fs.readFileSync(file, 'utf8');
        expect(
          evalPattern.test(content),
          `Forbidden eval() detected in ${path.relative(EXTENSION_ROOT, file)}`
        ).toBe(false);
        expect(
          functionConstructorPattern.test(content),
          `Forbidden new Function() detected in ${path.relative(EXTENSION_ROOT, file)}`
        ).toBe(false);
      }
    });

    it('contains zero commercial tracking or telemetry SDK imports', () => {
      const forbiddenTrackingPackages = [
        'google-analytics',
        '@segment/',
        'mixpanel',
        'amplitude',
        '@sentry/',
        'logrocket',
        'posthog-js',
      ];

      for (const file of sourceFiles) {
        const content = fs.readFileSync(file, 'utf8');
        for (const pkg of forbiddenTrackingPackages) {
          expect(
            content.includes(pkg),
            `Forbidden telemetry import "${pkg}" found in ${path.relative(EXTENSION_ROOT, file)}`
          ).toBe(false);
        }
      }
    });
  });

  // ==========================================================================
  // 3. Human Pacing Engine & Spatial Jitter
  // ==========================================================================
  describe('Human Pacing Engine (ADR-0014, ADR-0021)', () => {
    it('calculates randomized delays strictly within configured bounds', () => {
      for (let i = 0; i < 50; i++) {
        const delay = calculateRandomDelay(25, 75);
        expect(delay).toBeGreaterThanOrEqual(25);
        expect(delay).toBeLessThanOrEqual(75);
      }
    });

    it('handles inverted delay bounds gracefully', () => {
      const delay = calculateRandomDelay(100, 50);
      expect(delay).toBeGreaterThanOrEqual(50);
      expect(delay).toBeLessThanOrEqual(100);
    });

    it('computes exact element center coordinates when jitter is disabled', () => {
      const btn = document.createElement('button');
      btn.getBoundingClientRect = () => ({
        left: 100,
        top: 200,
        width: 80,
        height: 40,
        right: 180,
        bottom: 240,
        x: 100,
        y: 200,
        toJSON: () => {},
      });
      document.body.appendChild(btn);

      const coords = calculateElementClickCoordinates(btn, false);
      expect(coords.clientX).toBe(140); // 100 + 40
      expect(coords.clientY).toBe(220); // 200 + 20
      expect(coords.screenX).toBe(160);
      expect(coords.screenY).toBe(300);
    });

    it('applies spatial coordinate jitter bounded within element perimeter', () => {
      const btn = document.createElement('button');
      btn.getBoundingClientRect = () => ({
        left: 100,
        top: 200,
        width: 80,
        height: 40,
        right: 180,
        bottom: 240,
        x: 100,
        y: 200,
        toJSON: () => {},
      });
      document.body.appendChild(btn);

      for (let i = 0; i < 20; i++) {
        const coords = calculateElementClickCoordinates(btn, true);
        // Jitter must remain strictly inside the button bounds
        expect(coords.clientX).toBeGreaterThanOrEqual(100);
        expect(coords.clientX).toBeLessThanOrEqual(180);
        expect(coords.clientY).toBeGreaterThanOrEqual(200);
        expect(coords.clientY).toBeLessThanOrEqual(240);
        expect(coords.clientX).not.toBe(0);
        expect(coords.clientY).not.toBe(0);
      }
    });

    it('dispatches complete realistic W3C pointer and mouse sequence', () => {
      const btn = document.createElement('button');
      document.body.appendChild(btn);

      const eventsFired: string[] = [];
      const eventTypes = [
        'pointerover',
        'mouseover',
        'pointerdown',
        'mousedown',
        'click',
        'mouseup',
        'pointerup',
      ];

      for (const type of eventTypes) {
        btn.addEventListener(type, (e) => {
          eventsFired.push(e.type);
          expect((e as MouseEvent).clientX).toBe(123);
          expect((e as MouseEvent).clientY).toBe(456);
        });
      }

      dispatchRealisticPointerSequence(btn, {
        clientX: 123,
        clientY: 456,
        screenX: 143,
        screenY: 536,
      });

      expect(eventsFired).toEqual(eventTypes);
    });

    it('types text progressively character-by-character with natural cadence', async () => {
      const input = document.createElement('input');
      input.type = 'text';
      document.body.appendChild(input);

      const inputValues: string[] = [];
      input.addEventListener('input', (e) => {
        inputValues.push(input.value);
        expect((e as InputEvent).inputType).toBe('insertText');
      });

      await typeTextProgressively(input, 'Ada', {
        pacingMode: 'natural',
        minKeystrokeDelayMs: 1,
        maxKeystrokeDelayMs: 3,
      });

      expect(input.value).toBe('Ada');
      // Must have recorded incremental progress
      expect(inputValues).toEqual(['A', 'Ad', 'Ada']);
    });

    it('supports instant pacing mode for rapid execution without delay', async () => {
      const input = document.createElement('input');
      input.type = 'text';
      document.body.appendChild(input);

      const inputValues: string[] = [];
      input.addEventListener('input', () => {
        inputValues.push(input.value);
      });

      await typeTextProgressively(input, 'Fast Cadence', {
        pacingMode: 'instant',
      });

      expect(input.value).toBe('Fast Cadence');
      expect(inputValues).toEqual(['Fast Cadence']);
    });
  });

  // ==========================================================================
  // 4. Anti-Detection Non-Poisoning Invariant
  // ==========================================================================
  describe('Anti-Detection Non-Poisoning Invariant (ADR-0014, ADR-0021)', () => {
    it('guarantees zero navigator or prototype property tampering across extension source code', () => {
      // Anti-bot detection engines (Cloudflare Turnstile, Kasada, DataDome) inspect navigator and prototypes.
      // Extensions that attempt to fake navigator.webdriver or override DOM prototypes via Object.defineProperty
      // trigger immediate heuristic flags. ApplyKit strictly forbids this anti-pattern.
      const sourceFiles = getAllSourceFiles(srcDir);
      const tamperingPatterns = [
        /Object\.defineProperty\s*\(\s*navigator/i,
        /Object\.defineProperty\s*\(\s*Navigator\.prototype/i,
        /delete\s+navigator\.webdriver/i,
        /navigator\.webdriver\s*=/i,
        /Object\.defineProperty\s*\(\s*window\s*,\s*['"]chrome['"]/i,
      ];

      for (const file of sourceFiles) {
        const content = fs.readFileSync(file, 'utf8');
        for (const pattern of tamperingPatterns) {
          expect(
            pattern.test(content),
            `Prototype poisoning pattern ${pattern} found in ${path.relative(EXTENSION_ROOT, file)}`
          ).toBe(false);
        }
      }
    });

    it('does not tamper with fundamental Object, Function, or Element prototypes', () => {
      // Invariant: ApplyKit must never inject prototype methods
      expect((Object.prototype as unknown as Record<string, unknown>).__applykit_injected).toBeUndefined();
      expect((Element.prototype as unknown as Record<string, unknown>).__applykit_injected).toBeUndefined();
    });
  });

  // ==========================================================================
  // 5. Local-First Storage Audit & Right to Erasure
  // ==========================================================================
  describe('Right to Erasure & Storage Audit (ADR-0001, ADR-0021)', () => {
    it('correctly audits local storage metrics and records before purge', async () => {
      // 1. Populate Profile
      const profileRepo = new IndexedDbProfileRepository(indexedDB);
      const profileId = createProfileId(DEFAULT_PROFILE_KEY);
      const baseProfile = createEmptyProfile(profileId);
      const customProfile: CandidateProfile = {
        ...baseProfile,
        identity: {
          ...baseProfile.identity,
          legalFirstName: 'Ada',
          legalLastName: 'Lovelace',
          email: 'ada@example.org',
        },
      };
      await profileRepo.saveProfile(customProfile);

      // 2. Populate Evidence
      const evidenceRepo = new IndexedDbEvidenceRepository(indexedDB);
      const evidence1: Evidence = {
        id: createEvidenceId('ev-001'),
        source: {
          type: 'resume_bullet',
          sourceId: 'Lovelace_CV.pdf',
        },
        description: 'Pioneered algorithmic computing',
        textSnippet: 'Pioneered algorithmic computing.',
        verificationStatus: 'verified',
        confidenceScore: 0.98,
        createdAt: '2026-09-22T00:00:00Z',
        tags: ['computing', 'algorithms'],
      };
      const evidence2: Evidence = {
        id: createEvidenceId('ev-002'),
        source: {
          type: 'manual_input',
          sourceId: 'manual-notes',
        },
        description: 'Invented the first computer program',
        textSnippet: 'Invented the first computer program.',
        verificationStatus: 'verified',
        confidenceScore: 0.95,
        createdAt: '2026-09-22T00:00:00Z',
        tags: ['programming'],
      };
      await evidenceRepo.saveEvidence(evidence1);
      await evidenceRepo.saveEvidence(evidence2);

      // 3. Populate Job
      const jobRepo = new IndexedDbJobRepository(indexedDB);
      const job: JobPosting = {
        id: createJobPostingId('job-001'),
        title: 'Analytical Engine Architect',
        companyName: 'Babbage Institute',
        location: 'London, UK',
        workplaceType: 'onsite',
        employmentType: 'full_time',
        rawDescription: 'Design mechanical computer architecture.',
        parsedAt: '2026-09-22T00:00:00Z',
        url: 'https://careers.example.org/engine-architect',
        requirements: [],
        metadata: {},
      };
      await jobRepo.saveJob(job);

      // 4. Populate Application
      const appRepo = new IndexedDbApplicationRepository(indexedDB);
      const appRecord = createApplicationRecord(
        createApplicationId('app-001'),
        profileId,
        job.id
      );
      await appRepo.saveApplication(appRecord);

      // 5. Populate Secure Provider Key
      await setApiKey('openai', 'sk-test-secret-key-12345');

      // 6. Query Storage Audit Telemetry
      profileRepo.close();
      evidenceRepo.close();
      jobRepo.close();
      appRepo.close();

      const audit = await getStorageUsageSummary(indexedDB);

      expect(audit.hasProfile).toBe(true);
      expect(audit.candidateName).toBe('Ada Lovelace');
      expect(audit.evidenceCount).toBe(2);
      expect(audit.jobsCount).toBe(1);
      expect(audit.applicationsCount).toBe(1);
      expect(audit.keysConfiguredCount).toBe(1);
    });

    it('atomically purges all candidate data, IndexedDB stores, and encrypted credentials', async () => {
      // Setup candidate data
      const profileRepo = new IndexedDbProfileRepository(indexedDB);
      const profileId = createProfileId(DEFAULT_PROFILE_KEY);
      await profileRepo.saveProfile(createEmptyProfile(profileId));
      profileRepo.close();

      await setApiKey('openai', 'sk-test-secret-key-12345');
      await setApiKey('anthropic', 'sk-ant-test-999');

      // Execute Right to Erasure Purge
      const purgeResult = await purgeAllCandidateData(indexedDB);

      expect(purgeResult.success).toBe(true);
      expect(purgeResult.storesPurged).toContain('profiles');
      expect(purgeResult.storesPurged).toContain('evidence');
      expect(purgeResult.storesPurged).toContain('applications');
      expect(purgeResult.storesPurged).toContain('jobs');
      expect(purgeResult.storesPurged).toContain('claims');
      expect(purgeResult.keysCleared).toBe(true);

      // Verify complete erasure across IndexedDB
      const postAudit = await getStorageUsageSummary(indexedDB);
      expect(postAudit.hasProfile).toBe(false);
      expect(postAudit.evidenceCount).toBe(0);
      expect(postAudit.applicationsCount).toBe(0);
      expect(postAudit.jobsCount).toBe(0);
      expect(postAudit.keysConfiguredCount).toBe(0);

      // Verify extension-local storage cleared
      expect(localStorageMock[PROVIDER_KEYS_STORAGE_KEY]).toBeUndefined();
    });
  });
});

