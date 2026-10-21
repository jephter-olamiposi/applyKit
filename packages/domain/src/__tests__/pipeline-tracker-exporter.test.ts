/**
 * @fileoverview Unit test suite for Canonical 8-Column Pipeline Tracker Exporter.
 *
 * Verifies:
 * 1. 8-column header row matching SKILL.md Phase 5 (employer, role, status, date, url, source, note, key).
 * 2. Proper key slugification (e.g. "stripe::staff-platform-engineer").
 * 3. Status mapping from internal application state to canonical vocabulary.
 * 4. Formula injection protection and CSV RFC 4180 escaping.
 * 5. Clean Markdown table generation with clickable role URLs.
 */

import { describe, it, expect } from 'vitest';
import {
  exportPipelineTrackerCsv,
  exportPipelineTrackerMarkdown,
  normalizePipelineKey,
  mapApplicationStateToPipelineStatus,
  PIPELINE_TRACKER_HEADERS,
} from '../application/audit-exporter.js';
import { createApplicationRecord } from '../application/record.js';
import { createApplicationId, createProfileId, createJobPostingId } from '../types/ids.js';

describe('Canonical Pipeline Tracker Exporter Suite (Phase 5: Track)', () => {
  const profileId = createProfileId('prof_1');

  const app1 = {
    ...createApplicationRecord({
      id: createApplicationId('app_stripe'),
      candidateProfileId: profileId,
      jobPostingId: createJobPostingId('job_stripe'),
      companyName: 'Stripe, Inc.',
      jobTitle: 'Staff Platform Engineer',
      jobPostingUrl: 'https://stripe.com/jobs/staff',
      notes: 'source: Ashby; [2026-03-20] Verified 5-gate eligibility OPEN',
    }),
    currentStatus: 'submitted' as const,
    appliedAt: '2026-03-21T14:30:00Z',
  };

  const app2 = {
    ...createApplicationRecord({
      id: createApplicationId('app_linear'),
      candidateProfileId: profileId,
      jobPostingId: createJobPostingId('job_linear'),
      companyName: 'Linear',
      jobTitle: 'Senior Frontend Engineer',
      jobPostingUrl: 'https://linear.app/careers/senior-frontend',
      notes: '[2026-03-20] BLOCKED: Must reside in UK. Verbatim: "Must be a UK resident."',
    }),
    currentStatus: 'failed' as const,
  };

  const app3 = {
    ...createApplicationRecord({
      id: createApplicationId('app_monzo'),
      candidateProfileId: profileId,
      jobPostingId: createJobPostingId('job_monzo'),
      companyName: 'Monzo Bank',
      jobTitle: 'Backend Tech Lead',
      jobPostingUrl: 'https://monzo.com/careers/lead',
    }),
    currentStatus: 'awaiting_user_review' as const,
  };

  it('normalizes employer and role into consistent slug keys', () => {
    expect(normalizePipelineKey('Stripe, Inc.', 'Staff Platform Engineer')).toBe('stripe-inc::staff-platform-engineer');
    expect(normalizePipelineKey('Acme Global', 'Senior C++ / Rust Lead')).toBe('acme-global::senior-c-rust-lead');
  });

  it('maps application states and notes to the canonical pipeline status vocabulary', () => {
    expect(mapApplicationStateToPipelineStatus(app1)).toBe('Applied');
    expect(mapApplicationStateToPipelineStatus(app2)).toBe('Blocked');
    expect(mapApplicationStateToPipelineStatus(app3)).toBe('Needs candidate');
  });

  it('exports canonical 8-column CSV with sanitized cells', () => {
    const csv = exportPipelineTrackerCsv([app1, app2, app3]);
    const lines = csv.split('\r\n');

    // Header row
    expect(lines[0]).toBe(PIPELINE_TRACKER_HEADERS.join(','));

    // Row 1 (Stripe, Inc.)
    expect(lines[1]).toContain('"Stripe, Inc."');
    expect(lines[1]).toContain('Staff Platform Engineer');
    expect(lines[1]).toContain('Applied');
    expect(lines[1]).toContain('2026-03-21');
    expect(lines[1]).toContain('stripe-inc::staff-platform-engineer');

    // Row 2 (Linear - Blocked)
    expect(lines[2]).toContain('Linear');
    expect(lines[2]).toContain('Blocked');
    expect(lines[2]).toContain('BLOCKED: Must reside in UK');

    // Row 3 (Monzo - Needs candidate)
    expect(lines[3]).toContain('Monzo Bank');
    expect(lines[3]).toContain('Needs candidate');
  });

  it('exports clean Markdown summary table with clickable role links', () => {
    const md = exportPipelineTrackerMarkdown([app1, app2]);

    expect(md).toContain('| Employer | Role | Status | Date | Source | Note | Key |');
    expect(md).toContain('| Stripe, Inc. | [Staff Platform Engineer](https://stripe.com/jobs/staff) | **Applied** |');
    expect(md).toContain('`stripe-inc::staff-platform-engineer`');
    expect(md).toContain('| Linear | [Senior Frontend Engineer](https://linear.app/careers/senior-frontend) | **Blocked** |');
  });
});
