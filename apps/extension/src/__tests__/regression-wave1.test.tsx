/**
 * @fileoverview Regression tests for Wave 1 production defect fixes.
 *
 * 1. W1.1 - GET_CANDIDATE_PROFILE_SUMMARY must always resolve (no side panel hang)
 *    when profile summary retrieval fails in the background service worker.
 * 2. W1.2 - The onboarding wizard must merge candidate identity over the
 *    resume-derived profile instead of overwriting it with fabricated skills
 *    (zero-hallucination invariant, ADR-0004).
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import type { CandidateProfile } from '@applykit/domain';

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

// --------------------------------------------------------------------------
// Shared chrome mock surface for background module import
// --------------------------------------------------------------------------
function installChromeMock() {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      lastError: null,
      onMessage: {
        addListener: vi.fn(),
      },
    },
    storage: {
      local: {
        get: vi.fn().mockResolvedValue({}),
        set: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
      },
    },
    tabs: {
      query: vi.fn().mockResolvedValue([]),
      sendMessage: vi.fn(),
    },
    scripting: {
      executeScript: vi.fn(),
    },
  };
}

describe('W1.1 Background profile summary handler resolves on failure', () => {
  let listener: ((
    message: unknown,
    _sender: unknown,
    sendResponse: (res?: unknown) => void
  ) => boolean | undefined) | undefined;
  let bridgeModule: typeof import('../messages/bridge.js');

  beforeEach(async () => {
    installChromeMock();
    const chromeMock = globalThis.chrome as unknown as {
      runtime: { onMessage: { addListener: (fn: NonNullable<typeof listener>) => void } };
    };
    chromeMock.runtime.onMessage.addListener = vi.fn((fn) => {
      listener = fn;
    });

    bridgeModule = await import('../messages/bridge.js');

    // Import the background worker now that chrome is mocked; its listener
    // registration is captured into `listener`.
    await import('../background/index.js');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('responds with an error result when profile summary retrieval throws', async () => {
    expect(listener).toBeDefined();

    // Force getProfileSummary() to fail at the repository layer.
    const background = await import('../background/index.js');
    vi.spyOn(background.profileRepo, 'getProfileSummary').mockRejectedValue(
      new Error('simulated db failure')
    );

    const sendResponse = vi.fn();

    // Execute the message handler without an active await on the response.
    const keepsAlive = listener!(
      { type: 'GET_CANDIDATE_PROFILE_SUMMARY' },
      null,
      sendResponse
    );

    // The handler returns true (async) so the port stays open, and by the time
    // the mocked rejection settles, sendResponse must have been invoked exactly once.
    expect(keepsAlive).toBe(true);
    await vi.waitFor(() => {
      expect(sendResponse).toHaveBeenCalled();
    });

    const payload = sendResponse.mock.calls[0]![0] as {
      type?: string;
      summary?: unknown;
      error?: string;
    };
    expect(payload.type).toBe('CANDIDATE_PROFILE_SUMMARY_RESULT');
    expect(payload.summary).toBeUndefined();
    expect(payload.error).toContain('simulated db failure');
  });
});

// --------------------------------------------------------------------------
// W1.2 OnboardingWizard merge regression
// --------------------------------------------------------------------------
vi.mock('../messages/bridge.js', () => ({
  sendToBackground: vi.fn(),
}));

import * as bridge from '../messages/bridge.js';
import { OnboardingWizard } from '../sidepanel/components/OnboardingWizard.js';
import type { ExtensionResponse } from '../messages/contracts.js';

const mockedSend = vi.mocked(bridge.sendToBackground);

/**
 * Routes mocked background messages to fixed responses, mirroring the real
 * bridge response contract so the wizard under test sees typed payloads.
 */
function installBridgeMock(
  handlers: Record<string, (msg: Record<string, unknown>) => ExtensionResponse>
): void {
  mockedSend.mockImplementation(
    async (msg: { type: string }): Promise<ExtensionResponse> => {
      const handler = handlers[msg.type];
      if (!handler) {
        throw new Error(`Unexpected message type in onboarding test: ${msg.type}`);
      }
      return handler(msg as unknown as Record<string, unknown>);
    }
  );
}

/**
 * Sets a controlled React input value while preserving the framework value tracker.
 */
function setInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
}

function resumeDerivedProfile(profileId: string): CandidateProfile {
  const now = new Date().toISOString();
  return {
    id: profileId as CandidateProfile['id'],
    version: 1,
    createdAt: now,
    updatedAt: now,
    identity: {
      legalFirstName: '',
      legalLastName: '',
      email: '',
      phone: '',
      location: { city: '', country: '' },
      workAuthorization: { isAuthorizedInCountry: true, requiresSponsorship: false, authorizedCountries: [] },
    },
    professional: {
      headline: '',
      summary: '',
      totalYearsOfExperience: 0,
      primaryRoles: [],
      targetRoles: [],
      preferredLocations: [],
      workplacePreference: 'remote',
      isOpenToRelocation: false,
    },
    experiences: [],
    projects: [],
    education: [],
    skills: [
      {
        id: 'sk_go' as CandidateProfile['skills'][number]['id'],
        name: 'Go',
        normalizedName: 'go',
        category: 'language',
        proficiency: 'advanced',
        yearsOfExperience: 4,
        evidenceRefs: ['ev_go' as CandidateProfile['skills'][number]['evidenceRefs'][number]],
      },
      {
        id: 'sk_kafka' as CandidateProfile['skills'][number]['id'],
        name: 'Kafka',
        normalizedName: 'kafka',
        category: 'library',
        proficiency: 'intermediate',
        evidenceRefs: ['ev_kafka' as CandidateProfile['skills'][number]['evidenceRefs'][number]],
      },
    ],
    links: { customLinks: [] },
    documents: [],
    savedAnswers: [],
    claims: [],
  };
}

describe('W1.2 OnboardingWizard preserves resume-derived profile', () => {
  let container: HTMLDivElement;
  let root: Root;
  let savedProfile: CandidateProfile | undefined;
  let onComplete: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    savedProfile = undefined;
    onComplete = vi.fn();
    mockedSend.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('merges typed identity over resume-derived skills and never fabricates expert claims', async () => {
    const parsedProfile = resumeDerivedProfile('default_candidate');

    installBridgeMock({
      GET_CANDIDATE_PROFILE: () => ({
        type: 'CANDIDATE_PROFILE_RESULT',
        profile: parsedProfile,
      }),
      SAVE_CANDIDATE_PROFILE: (msg) => {
        savedProfile = (msg as { profile: CandidateProfile }).profile;
        return { type: 'SAVE_CANDIDATE_PROFILE_RESULT', success: true };
      },
      SET_API_KEY: () => ({
        type: 'SET_API_KEY_RESULT',
        success: true,
        provider: 'openai',
      }),
    });

    await act(async () => {
      root.render(<OnboardingWizard onComplete={onComplete} />);
    });

    // --- Step 1: identity ---
    setInputValue(document.getElementById('first-name') as HTMLInputElement, 'Jane');
    setInputValue(document.getElementById('last-name') as HTMLInputElement, 'Developer');
    setInputValue(document.getElementById('email') as HTMLInputElement, 'jane.dev@example.org');

    await act(async () => {
      (document.querySelector('form') as HTMLFormElement).requestSubmit();
    });

    // --- Step 2: skip resume text and continue ---
    await act(async () => {
      Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Continue to AI Setup')
      )?.click();
    });

    // --- Step 3: skip API key setup ---
    await act(async () => {
      const skipToggle = Array.from(
        document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
      ).find((c) => c.closest('.skip-key-toggle'));
      skipToggle?.click();
    });
    await act(async () => {
      Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Review & Complete')
      )?.click();
    });

    // --- Step 4: finish onboarding ---
    await act(async () => {
      Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Launch ApplyKit Copilot')
      )?.click();
    });

    expect(savedProfile).toBeDefined();
    // Identity typed on step 1 is applied.
    expect(savedProfile!.identity.legalFirstName).toBe('Jane');
    expect(savedProfile!.identity.legalLastName).toBe('Developer');
    expect(savedProfile!.identity.email).toBe('jane.dev@example.org');
    // Evidence-derived skills survive the merge.
    expect(savedProfile!.skills.map((s) => s.name)).toEqual(['Go', 'Kafka']);
    // Zero-hallucination: no fabricated expert skills are introduced.
    expect(savedProfile!.skills).not.toContainEqual(
      expect.objectContaining({ proficiency: 'expert' })
    );
    // No fabricated default headline either.
    expect(savedProfile!.professional.headline).toBe('');
  });

  it('falls back to a clean empty profile when no prior profile exists', async () => {
    installBridgeMock({
      GET_CANDIDATE_PROFILE: () => ({
        type: 'CANDIDATE_PROFILE_RESULT',
        profile: null,
      }),
      SAVE_CANDIDATE_PROFILE: (msg) => {
        savedProfile = (msg as { profile: CandidateProfile }).profile;
        return { type: 'SAVE_CANDIDATE_PROFILE_RESULT', success: true };
      },
      SET_API_KEY: () => ({
        type: 'SET_API_KEY_RESULT',
        success: true,
        provider: 'openai',
      }),
    });

    await act(async () => {
      root.render(<OnboardingWizard onComplete={onComplete} />);
    });

    setInputValue(document.getElementById('first-name') as HTMLInputElement, 'Grace');
    setInputValue(document.getElementById('last-name') as HTMLInputElement, 'Hopper');
    setInputValue(document.getElementById('email') as HTMLInputElement, 'grace@example.org');

    await act(async () => {
      (document.querySelector('form') as HTMLFormElement).requestSubmit();
    });
    await act(async () => {
      Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Continue to AI Setup')
      )?.click();
    });
    await act(async () => {
      Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Review & Complete')
      )?.click();
    });
    await act(async () => {
      Array.from(document.querySelectorAll('button')).find((b) =>
        b.textContent?.includes('Launch ApplyKit Copilot')
      )?.click();
    });

    expect(savedProfile).toBeDefined();
    expect(savedProfile!.skills).toEqual([]);
    expect(savedProfile!.identity.legalFirstName).toBe('Grace');
  });
});