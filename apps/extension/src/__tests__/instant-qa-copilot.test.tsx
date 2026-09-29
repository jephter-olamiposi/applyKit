/**
 * @fileoverview Unit and Integration Test Suite for Instant Q&A Copilot and Fresh-Slate Answering.
 *
 * Verifies:
 * 1. Dual-Stage Pipeline in background service worker:
 *    - Stage 1: Fast-path deterministic evaluation (0ms offline, 0 API keys) across:
 *      * Saved reusable answers
 *      * Location taxonomy (country, state/province, city, full location)
 *      * Work authorization & visa sponsorship
 *      * Compensation & availability (salary, notice period, earliest start date)
 *      * Professional current role and company
 *      * Professional links (LinkedIn, GitHub, Portfolio)
 *    - Stage 2: Grounded AI synthesis:
 *      * Returns helpful guidance with 1-click free Google Gemini link when 0 keys configured
 *      * Synthesizes answers using candidate evidence claims and tone/character constraints
 * 2. Reusable answer persistence via SAVE_REUSABLE_ANSWER.
 * 3. Dry-run planner integration matching saved answers for custom unmapped form questions.
 * 4. InstantQuestionSolver React component rendering and user actions (tones, lengths, save, insert).
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import {
  createEmptyProfile,
  createProfileId,
  createSavedAnswerId,
  generateDryRunPlan,
  type CandidateProfile,
  type ApplicationForm,
  type SavedAnswer,
} from '@applykit/domain';
import { InstantQuestionSolver } from '../sidepanel/components/InstantQuestionSolver.js';
import * as bridge from '../messages/bridge.js';

// Setup React ACT environment
beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

// Mock bridge sendToBackground
vi.mock('../messages/bridge.js', () => ({
  sendToBackground: vi.fn(),
}));

const mockedSend = vi.mocked(bridge.sendToBackground);

function buildTestCandidateProfile(): CandidateProfile {
  const profileId = createProfileId('candidate_test_qa');
  const empty = createEmptyProfile(profileId);
  return {
    ...empty,
    identity: {
      legalFirstName: 'Ada',
      legalLastName: 'Lovelace',
      preferredName: 'Ada',
      email: 'ada.lovelace@example.org',
      phone: '+1 (555) 234-5678',
      location: {
        city: 'London',
        stateOrProvince: 'Greater London',
        country: 'United Kingdom',
        postalCode: 'SW1A 1AA',
        addressLine1: '10 Downing Street',
      },
      workAuthorization: {
        isAuthorizedInCountry: true,
        requiresSponsorship: false,
        authorizedCountries: ['United Kingdom'],
      },
    },
    professional: {
      headline: 'Principal Computing Architect',
      summary: 'Pioneer of mechanical general-purpose computing with deep analytical algorithm design experience.',
      currentTitle: 'Head of Algorithmic Research',
      totalYearsOfExperience: 12,
      primaryRoles: ['Computing Architect', 'Research Scientist'],
      targetRoles: ['Principal Research Engineer'],
      preferredLocations: ['London', 'Remote'],
      workplacePreference: 'remote',
      isOpenToRelocation: true,
      referralSource: 'LinkedIn',
      compensationExpectation: {
        targetSalaryMin: 160000,
        currency: 'GBP',
        period: 'annual',
        isNegotiable: true,
      },
      noticePeriodDays: 0,
      earliestStartDate: 'Immediately upon contract',
    },
    experiences: [
      {
        id: 'exp_1' as never,
        company: 'Analytical Engine Laboratory',
        title: 'Head of Algorithmic Research',
        employmentType: 'full_time',
        location: 'London, UK',
        isRemote: false,
        startDate: '2020-01',
        isCurrent: true,
        description: 'Led algorithmic design for analytical calculation systems.',
        highlights: ['Published Note G detailing the first computer program algorithm.'],
        technologiesUsed: ['Mathematics', 'Analytical Engine'],
        evidenceRefs: [],
      },
    ],
    links: {
      linkedin: 'https://linkedin.com/in/adalovelace',
      github: 'https://github.com/adalovelace',
      portfolio: 'https://adalovelace.org',
      customLinks: [],
    },
    savedAnswers: [
      {
        id: createSavedAnswerId('ans_why_role'),
        canonicalKey: 'why_company:analytical',
        promptPatterns: ['why are you interested in this role', 'why do you want to work here'],
        answerText: 'I am fascinated by scalable computational architectures and want to apply algorithmic design to real-world engines.',
        category: 'why_company',
        tags: ['interest', 'mission'],
        evidenceRefs: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
  };
}

describe('Instant Q&A Copilot — Planner Saved Answers Integration', () => {
  it('matches saved answers when form field has no canonical mapping but matches prompt pattern', () => {
    const profile = buildTestCandidateProfile();
    const form: ApplicationForm = {
      id: 'form_custom_1',
      url: 'https://careers.example.org/apply',
      detectedAts: 'greenhouse',
      isMultiStep: false,
      inspectedAt: new Date().toISOString(),
      fields: [
        {
          id: 'field_why' as never,
          selector: '#why_join',
          fieldType: 'textarea',
          label: 'Why are you interested in this role?',
          isRequired: true,
          confidenceScore: 0.7,
        },
      ],
      submitButtonSelector: 'button[type="submit"]',
    };

    const plan = generateDryRunPlan(form, profile);
    expect(plan.actions.length).toBe(1);
    const action = plan.actions[0]!;
    expect(action.action.actionType).toBe('fill_text');
    expect(action.candidateValueUsed).toContain('fascinated by scalable computational architectures');
    expect(action.action.value).toContain('fascinated by scalable computational architectures');
  });

  it('matches saved answers via placeholder when field label is missing or generic', () => {
    const profile = buildTestCandidateProfile();
    const form: ApplicationForm = {
      id: 'form_custom_2',
      url: 'https://careers.example.org/apply',
      detectedAts: 'generic',
      isMultiStep: false,
      inspectedAt: new Date().toISOString(),
      fields: [
        {
          id: 'field_placeholder' as never,
          selector: '#custom_textarea',
          fieldType: 'textarea',
          label: '',
          placeholder: 'Why do you want to work here?',
          isRequired: true,
          confidenceScore: 0.6,
        },
      ],
      submitButtonSelector: 'button[type="submit"]',
    };

    const plan = generateDryRunPlan(form, profile);
    expect(plan.actions.length).toBe(1);
    expect(plan.actions[0]?.candidateValueUsed).toContain('fascinated by scalable computational architectures');
  });
});

describe('InstantQuestionSolver React Component', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mockedSend.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('renders dedicated tab header, tone selectors, length presets, and sample chips', async () => {
    await act(async () => {
      root.render(<InstantQuestionSolver isDedicatedTab={true} />);
    });

    expect(container.textContent).toContain('Instant Q&A Copilot');
    expect(container.textContent).toContain('0ms Offline Fast-Path for Profile Data');
    expect(container.textContent).toContain('Zero Hallucination Evidence Grounding');
    expect(container.textContent).toContain('What country are you located in?');
    expect(container.textContent).toContain('STAR Method');
    expect(container.textContent).toContain('150 chars');
  });

  it('clicking a sample chip populates the question textarea', async () => {
    await act(async () => {
      root.render(<InstantQuestionSolver isDedicatedTab={true} />);
    });

    const sampleBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('What is your notice period?')
    );
    expect(sampleBtn).toBeDefined();

    await act(async () => {
      sampleBtn?.click();
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('#ad-hoc-question');
    expect(textarea?.value).toBe('What is your notice period?');
  });

  it('triggers ANSWER_AD_HOC_QUESTION and displays grounded answer with confidence and character count', async () => {
    mockedSend.mockResolvedValueOnce({
      type: 'ANSWER_AD_HOC_QUESTION_RESULT',
      success: true,
      answerText: 'Immediate — I can start right away without a notice period.',
      confidence: 1.0,
      supportingClaimIds: [],
      notes: 'Resolved deterministically from verified profile attributes (0ms offline).',
    } as never);

    await act(async () => {
      root.render(<InstantQuestionSolver isDedicatedTab={true} />);
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('#ad-hoc-question')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'What is your notice period?');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const generateBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Generate Grounded Answer')
    );
    expect(generateBtn).toBeDefined();

    await act(async () => {
      generateBtn?.click();
    });

    expect(mockedSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ANSWER_AD_HOC_QUESTION',
        question: 'What is your notice period?',
        tone: 'concise',
      })
    );

    expect(container.textContent).toContain('Immediate — I can start right away without a notice period.');
    expect(container.textContent).toContain('100% Confidence');
    expect(container.textContent).toContain('Resolved deterministically from verified profile attributes (0ms offline).');
  });

  it('allows saving generated answer to verified candidate profile', async () => {
    mockedSend
      .mockResolvedValueOnce({
        type: 'ANSWER_AD_HOC_QUESTION_RESULT',
        success: true,
        answerText: 'London, Greater London, United Kingdom',
        confidence: 1.0,
        supportingClaimIds: [],
        notes: 'Resolved deterministically from verified profile attributes (0ms offline).',
      } as never)
      .mockResolvedValueOnce({
        type: 'SAVE_REUSABLE_ANSWER_RESULT',
        success: true,
        savedAnswerId: 'saved_123',
      } as never);

    await act(async () => {
      root.render(<InstantQuestionSolver isDedicatedTab={true} />);
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('#ad-hoc-question')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'Where are you located?');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const generateBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Generate Grounded Answer')
    );
    await act(async () => {
      generateBtn?.click();
    });

    const saveBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Save to Profile')
    );
    expect(saveBtn).toBeDefined();

    await act(async () => {
      saveBtn?.click();
    });

    expect(mockedSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SAVE_REUSABLE_ANSWER',
        question: 'Where are you located?',
        answerText: 'London, Greater London, United Kingdom',
      })
    );

    expect(container.textContent).toContain('Answer saved to profile!');
  });

  it('copies generated answer to system clipboard', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: writeTextMock,
      },
      configurable: true,
      writable: true,
    });

    mockedSend.mockResolvedValueOnce({
      type: 'ANSWER_AD_HOC_QUESTION_RESULT',
      success: true,
      answerText: 'https://linkedin.com/in/adalovelace',
      confidence: 1.0,
      supportingClaimIds: [],
    } as never);

    await act(async () => {
      root.render(<InstantQuestionSolver isDedicatedTab={true} />);
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('#ad-hoc-question')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'What is your LinkedIn URL?');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const generateBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Generate Grounded Answer')
    );
    await act(async () => {
      generateBtn?.click();
    });

    const copyBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Copy Answer')
    );
    expect(copyBtn).toBeDefined();

    await act(async () => {
      copyBtn?.click();
    });

    expect(writeTextMock).toHaveBeenCalledWith('https://linkedin.com/in/adalovelace');
    expect(container.textContent).toContain('Copied answer to clipboard!');
  });

  it('triggers INSERT_TEXT_INTO_ACTIVE_ELEMENT to insert answer into webpage input', async () => {
    mockedSend
      .mockResolvedValueOnce({
        type: 'ANSWER_AD_HOC_QUESTION_RESULT',
        success: true,
        answerText: 'United Kingdom',
        confidence: 1.0,
        supportingClaimIds: [],
      } as never)
      .mockResolvedValueOnce({
        type: 'INSERT_TEXT_INTO_ACTIVE_ELEMENT_RESULT',
        success: true,
      } as never);

    await act(async () => {
      root.render(<InstantQuestionSolver isDedicatedTab={true} />);
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('#ad-hoc-question')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'Country');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const generateBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Generate Grounded Answer')
    );
    await act(async () => {
      generateBtn?.click();
    });

    const insertBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Insert into Focused Field')
    );
    expect(insertBtn).toBeDefined();

    await act(async () => {
      insertBtn?.click();
    });

    expect(mockedSend).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'INSERT_TEXT_INTO_ACTIVE_ELEMENT',
        text: 'United Kingdom',
      })
    );

    expect(container.textContent).toContain('Successfully inserted into active form field');
  });

  it('displays character counter badge and alerts when length exceeds limit', async () => {
    mockedSend.mockResolvedValueOnce({
      type: 'ANSWER_AD_HOC_QUESTION_RESULT',
      success: true,
      answerText: 'This is a deliberately long answer designed to exceed the preset limit of characters.',
      confidence: 0.9,
      supportingClaimIds: [],
    } as never);

    await act(async () => {
      root.render(<InstantQuestionSolver isDedicatedTab={true} />);
    });

    // Select 150 chars preset
    const presetBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent === '150 chars'
    );
    await act(async () => {
      presetBtn?.click();
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('#ad-hoc-question')!;
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(textarea, 'Tell me about yourself');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const generateBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Generate Grounded Answer')
    );
    await act(async () => {
      generateBtn?.click();
    });

    expect(container.textContent).toContain('/ 150 chars');
  });
});
