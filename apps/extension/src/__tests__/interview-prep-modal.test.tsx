/**
 * @fileoverview Test suite for Evidence-Grounded Role Interview Prep Modal (Phase 25).
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { InterviewPrepModal } from '../sidepanel/components/InterviewPrepModal.js';
import {
  createApplicationRecord,
  createApplicationId,
  createJobPostingId,
  createProfileId,
  createExperienceId,
  createEvidenceId,
  buildEvidenceGraph,
  createEmptyProfile,
} from '@applykit/domain';

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('InterviewPrepModal Component Test Suite', () => {
  let container: HTMLDivElement;
  let root: Root;

  const mockApp = createApplicationRecord({
    id: createApplicationId('app_prep_test'),
    candidateProfileId: createProfileId('prof_1'),
    jobPostingId: createJobPostingId('job_1'),
    companyName: 'Canonical',
    jobTitle: 'Distributed Systems Engineer',
    jobPostingUrl: 'https://canonical.com/careers/4581200',
    jobDescriptionSnapshot: 'We build Ubuntu and distributed systems with Go, Kafka, and Linux.',
  });

  const mockProfile = {
    ...createEmptyProfile(createProfileId('prof_1')),
    experiences: [
      {
        id: createExperienceId('exp_1'),
        company: 'CloudStream',
        title: 'Lead Architect',
        employmentType: 'full_time' as const,
        location: 'London',
        isRemote: true,
        startDate: '2021-01',
        isCurrent: true,
        description: 'Engineered Raft streaming pipelines.',
        technologiesUsed: ['Go', 'Kafka'],
        evidenceRefs: [],
        highlights: [
          'Engineered low-latency Raft consensus streaming engine in Go processing 300,000 events/sec.',
        ],
      },
    ],
  };

  const ev1 = {
    id: createEvidenceId('ev_raft'),
    source: { type: 'resume_bullet' as const, sourceId: 'exp_1' },
    description: 'Raft consensus in Go',
    textSnippet: 'Engineered low-latency Raft consensus streaming engine in Go processing 300,000 events/sec.',
    verificationStatus: 'verified' as const,
    confidenceScore: 1.0,
    createdAt: '2026-09-29T00:00:00Z',
    tags: ['Go', 'Kafka'],
  };

  const mockGraph = buildEvidenceGraph([ev1], []);

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders role and company header with 100% evidence grounded badge', () => {
    const handleClose = vi.fn();

    act(() => {
      root.render(
        <InterviewPrepModal
          application={mockApp}
          candidateProfile={mockProfile}
          evidenceGraph={mockGraph}
          onClose={handleClose}
        />
      );
    });

    expect(container.textContent).toContain('Distributed Systems Engineer @ Canonical');
    expect(container.textContent).toContain('100% Evidence Grounded');
    expect(container.textContent).toContain('Company Focus:');
  });

  it('displays verified STAR behavioral narratives with Situation, Task, Action, Result', () => {
    act(() => {
      root.render(
        <InterviewPrepModal
          application={mockApp}
          candidateProfile={mockProfile}
          evidenceGraph={mockGraph}
          onClose={() => {}}
        />
      );
    });

    expect(container.textContent).toContain('STAR Behavioral Stories');
    expect(container.textContent).toContain('CloudStream');
    expect(container.textContent).toContain('Engineered low-latency Raft consensus');
    expect(container.textContent).toContain('Copy STAR');
  });

  it('allows switching to questions to ask interviewer and triggers close', () => {
    const handleClose = vi.fn();

    act(() => {
      root.render(
        <InterviewPrepModal
          application={mockApp}
          candidateProfile={mockProfile}
          evidenceGraph={mockGraph}
          onClose={handleClose}
        />
      );
    });

    // Switch tab to reverse questions
    const reverseTabBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Questions to Ask')
    );
    expect(reverseTabBtn).toBeDefined();

    act(() => {
      reverseTabBtn?.click();
    });

    expect(container.textContent).toContain('Stand out as a thoughtful engineering candidate');
    expect(container.textContent).toContain('Canonical');

    // Click close button
    const closeBtn = Array.from(container.querySelectorAll('button')).find((btn) =>
      btn.textContent?.includes('Close Prep Kit')
    );
    act(() => {
      closeBtn?.click();
    });

    expect(handleClose).toHaveBeenCalledTimes(1);
  });
});
