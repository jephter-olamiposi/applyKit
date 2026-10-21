/**
 * @fileoverview Integration test suite for ATS Sourcing Engine, 5-Gate Eligibility in Match Analysis,
 * and Canonical 8-Column Pipeline Tracker Exporter.
 *
 * @vitest-environment happy-dom
 */

import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import {
  createEmptyProfile,
  createProfileId,
  type CandidateProfile,
  type JobPosting,
} from '@applykit/domain';
import { AtsSourcingEngine } from '../sidepanel/components/AtsSourcingEngine.js';
import { MatchAnalysis } from '../sidepanel/components/MatchAnalysis.js';
import * as bridge from '../messages/bridge.js';

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

vi.mock('../messages/bridge.js', () => ({
  sendToBackground: vi.fn(),
}));

const mockedSend = vi.mocked(bridge.sendToBackground);

function buildTestCandidateProfile(): CandidateProfile {
  const profileId = createProfileId('prof_pipeline_test');
  const empty = createEmptyProfile(profileId);
  return {
    ...empty,
    identity: {
      legalFirstName: 'Jane',
      legalLastName: 'Developer',
      email: 'jane@example.org',
      phone: '+1 (555) 019-2834',
      location: { city: 'London', country: 'United Kingdom' },
      workAuthorization: {
        isAuthorizedInCountry: true,
        requiresSponsorship: false,
        authorizedCountries: ['United Kingdom'],
      },
    },
    professional: {
      headline: 'Senior Distributed Systems Engineer',
      summary: 'Passionate about high-throughput Go and Rust systems.',
      currentTitle: 'Senior Distributed Systems Engineer',
      totalYearsOfExperience: 8,
      primaryRoles: ['Backend Engineer'],
      targetRoles: ['Staff Distributed Systems Engineer', 'Senior Infrastructure Engineer'],
      preferredLocations: ['Remote'],
      workplacePreference: 'remote' as const,
      isOpenToRelocation: false,
    },
    skills: [
      {
        id: 's1' as any,
        name: 'Go',
        normalizedName: 'go',
        category: 'language',
        proficiency: 'expert',
        evidenceRefs: [],
      },
      {
        id: 's2' as any,
        name: 'Rust',
        normalizedName: 'rust',
        category: 'language',
        proficiency: 'expert',
        evidenceRefs: [],
      },
    ],
  };
}

describe('Sourcing Engine & Pipeline Verification UI Suite (SKILL.md Phase 1 & 2)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders targeted ATS search dorks with candidate profile and allows clipboard copy', async () => {
    const profile = buildTestCandidateProfile();
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: writeTextMock,
      },
      configurable: true,
      writable: true,
    });

    await act(async () => {
      root.render(<AtsSourcingEngine profile={profile} initialExpanded={true} />);
    });

    // Check title and platforms
    expect(container.textContent).toContain('Direct ATS Job Sourcing Engine (Phase 1)');
    expect(container.textContent).toContain('Ashby');
    expect(container.textContent).toContain('Greenhouse');
    expect(container.textContent).toContain('Lever');

    // Click first Copy button
    const copyButtons = Array.from(container.querySelectorAll('button')).filter(
      (b) => b.textContent?.includes('Copy')
    );
    expect(copyButtons.length).toBeGreaterThan(0);

    await act(async () => {
      copyButtons[0]?.click();
    });

    expect(writeTextMock).toHaveBeenCalledTimes(1);
    expect(writeTextMock.mock.calls[0]?.[0]).toContain('site:jobs.ashbyhq.com');
  });

  it('renders 5-Gate Eligibility card and displays verdict in Match Analysis', async () => {
    const profile = buildTestCandidateProfile();

    mockedSend.mockImplementation(async (msg: any): Promise<any> => {
      if (msg.type === 'GET_CANDIDATE_PROFILE') {
        return { type: 'GET_CANDIDATE_PROFILE_RESULT', success: true, profile };
      }
      if (msg.type === 'MATCH_JOB_REQUIREMENTS') {
        return {
          type: 'MATCH_JOB_REQUIREMENTS_RESULT',
          success: true,
          matchMatrix: {
            jobPostingId: 'job_test_1',
            candidateProfileId: profile.id,
            evaluatedAt: new Date().toISOString(),
            overallMatchScore: 85,
            requiredMetCount: 2,
            requiredCount: 2,
            preferredMetCount: 1,
            preferredCount: 1,
            experienceShortfallsCount: 0,
            matches: [],
          },
          gapAnalysis: {
            jobPostingId: 'job_test_1',
            evaluatedAt: new Date().toISOString(),
            summary: 'Candidate satisfies all required skills with strong evidence.',
            totalGaps: 0,
            criticalGapsCount: 0,
            moderateGapsCount: 0,
            minorGapsCount: 0,
            gaps: [],
          },
          highlightSuggestions: [],
        };
      }
      return { success: false, error: 'Unknown message' };
    });

    const jobPosting: JobPosting = {
      id: 'job_test_1' as any,
      url: 'https://example.com/jobs/1',
      title: 'Senior Backend Engineer',
      companyName: 'Acme Global',
      workplaceType: 'remote',
      employmentType: 'full_time',
      location: 'Remote (Worldwide)',
      rawDescription: 'We are hiring a Senior Backend Engineer. Work from anywhere in the world. Flexible hours.',
      parsedAt: new Date().toISOString(),
      requirements: [
        {
          id: 'req_1' as any,
          rawText: '5+ years experience with Go or Rust',
          normalizedSkillOrCompetency: 'Go / Rust',
          category: 'technical_skill',
          importance: 'required',
          isRequired: true,
          matchedEvidenceIds: [],
        },
      ],
      metadata: {},
    };

    await act(async () => {
      root.render(<MatchAnalysis jobPosting={jobPosting} onNavigateToTab={() => {}} />);
    });

    // Wait for async background effects
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(container.textContent).toContain('Eligibility: OPEN');
    expect(container.textContent).toContain('5-Gate Status');
    expect(container.textContent).toContain('85%');
  });

  it('renders direct unauthenticated ATS API endpoint probes in AtsSourcingEngine', async () => {
    const profile = buildTestCandidateProfile();

    await act(async () => {
      root.render(<AtsSourcingEngine profile={profile} initialExpanded={true} />);
    });

    const probesToggle = Array.from(container.querySelectorAll('span')).find(
      (s) => s.textContent?.includes('Unauthenticated ATS Board API Probes')
    );
    expect(probesToggle).toBeDefined();

    // Click to expand drawer
    await act(async () => {
      probesToggle?.parentElement?.click();
    });

    expect(container.textContent).toContain('Greenhouse');
    expect(container.textContent).toContain('boards-api.greenhouse.io');
    expect(container.textContent).toContain('api.ashbyhq.com');
  });

  it('triggers canonical tracker CSV and Markdown exports from ApplicationTracker', async () => {
    const mockApp = {
      id: 'app_1' as any,
      jobPostingId: 'job_1' as any,
      jobTitle: 'Staff Backend Engineer',
      companyName: 'Stripe',
      jobPostingUrl: 'https://boards.greenhouse.io/stripe/jobs/12345',
      currentStatus: 'awaiting_user_review' as const,
      formId: 'form_1' as any,
      tailoredResumeId: 'resume_1' as any,
      createdAt: '2026-10-01T12:00:00.000Z',
      updatedAt: '2026-10-01T12:30:00.000Z',
      notes: 'source: Ashby',
      executedActions: [],
      fieldValues: [],
      statusHistory: [],
    };

    let requestedFormat: string | null = null;
    mockedSend.mockImplementation(async (msg: any): Promise<any> => {
      if (msg.type === 'LIST_APPLICATIONS') {
        return { type: 'LIST_APPLICATIONS_RESULT', success: true, applications: [mockApp] };
      }
      if (msg.type === 'EXPORT_AUDIT_LOG') {
        requestedFormat = msg.format;
        return {
          type: 'EXPORT_AUDIT_LOG_RESULT',
          success: true,
          content: 'header1,header2\nval1,val2',
          filename: `applykit-pipeline-tracker.${msg.format}`,
          mimeType: 'text/csv',
        };
      }
      return { success: false, error: 'Unknown message' };
    });

    // Mock URL.createObjectURL and revokeObjectURL
    const createObjectUrlMock = vi.fn().mockReturnValue('blob:test');
    const revokeObjectUrlMock = vi.fn();
    globalThis.URL.createObjectURL = createObjectUrlMock;
    globalThis.URL.revokeObjectURL = revokeObjectUrlMock;

    const { ApplicationTracker } = await import('../sidepanel/components/ApplicationTracker.js');

    await act(async () => {
      root.render(<ApplicationTracker onNavigateToTab={() => {}} />);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(container.textContent).toContain('Application Tracker');
    expect(container.textContent).toContain('Tracker CSV');
    expect(container.textContent).toContain('Summary MD');

    // Click Tracker CSV button
    const csvBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Tracker CSV')
    );
    expect(csvBtn).toBeDefined();

    await act(async () => {
      csvBtn?.click();
    });

    expect(requestedFormat).toBe('tracker-csv');

    // Click Summary MD button
    const mdBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.textContent?.includes('Summary MD')
    );
    expect(mdBtn).toBeDefined();

    await act(async () => {
      mdBtn?.click();
    });

    expect(requestedFormat).toBe('tracker-md');
  });
});
