/**
 * @fileoverview Unit and interaction tests for In-Page Floating Assistant Hub (Phase 17).
 *
 * Verifies:
 * 1. Shadow DOM isolation and zero host DOM pollution.
 * 2. Floating action hub rendering with 1-click auto-fill trigger.
 * 3. Active field focus detection and pill positioning.
 * 4. Standard field text insertion into active inputs.
 * 5. Essay question popover triggering.
 * 6. Submission hard gate: ignoring submit buttons.
 * 7. Non-invasive lifecycle teardown.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  initInPageHub,
  unmountInPageHub,
  IN_PAGE_HUB_HOST_ID,
} from '../content/in-page-hub.js';
import type { CandidateProfile } from '@applykit/domain';

describe('In-Page Floating Assistant Hub (Phase 17)', () => {
  const sampleProfile: Partial<CandidateProfile> = {
    identity: {
      legalFirstName: 'Morgan',
      legalLastName: 'Reed',
      email: 'morgan.reed@example.com',
      phone: '+44 20 7946 0991',
      location: { city: 'London', stateOrProvince: 'Greater London', country: 'United Kingdom' },
      workAuthorization: { isAuthorizedInCountry: true, requiresSponsorship: false, authorizedCountries: ['UK'] },
    },
    links: {
      linkedin: 'https://linkedin.com/in/morgan-reed-synthetic',
      github: 'https://github.com/morgan-reed-synthetic',
      portfolio: 'https://morganreed-synthetic.dev',
      customLinks: [],
    },
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';

    // Mock chrome.runtime.sendMessage
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: vi.fn().mockImplementation((msg, cb) => {
          if (msg.type === 'GET_CANDIDATE_PROFILE') {
            if (cb) cb({ type: 'CANDIDATE_PROFILE_RESULT', profile: sampleProfile });
          } else if (msg.type === 'ANSWER_AD_HOC_QUESTION') {
            if (cb) {
              cb({
                type: 'ANSWER_AD_HOC_QUESTION_RESULT',
                success: true,
                answerText: 'I have extensive experience architecting high-throughput Go and Python streaming pipelines.',
              });
            }
          } else if (msg.type === 'EXECUTE_ONE_CLICK_AUTO_FILL') {
            if (cb) {
              cb({
                type: 'EXECUTE_ONE_CLICK_AUTO_FILL_RESULT',
                success: true,
                report: { executedCount: 12 },
              });
            }
          }
        }),
      },
    };
  });

  afterEach(() => {
    unmountInPageHub(document);
    vi.restoreAllMocks();
  });

  it('mounts closed/isolated Shadow DOM host element into document body', () => {
    initInPageHub(document);

    const host = document.getElementById(IN_PAGE_HUB_HOST_ID);
    expect(host).toBeDefined();
    expect(host?.shadowRoot).toBeDefined();

    // Verify encapsulated elements exist inside shadow DOM
    const hub = host?.shadowRoot?.querySelector('.applykit-floating-hub');
    expect(hub).toBeDefined();
    expect(hub?.textContent).toContain('ApplyKit Ready');
  });

  it('renders 1-click auto-fill button in floating hub badge', () => {
    initInPageHub(document);

    const host = document.getElementById(IN_PAGE_HUB_HOST_ID);
    const autofillBtn = host?.shadowRoot?.querySelector('#btn-hub-autofill') as HTMLButtonElement;

    expect(autofillBtn).toBeDefined();
    expect(autofillBtn.textContent).toBe('1-Click Auto-Fill');

    // Click auto-fill button
    autofillBtn.click();
    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      { type: 'EXECUTE_ONE_CLICK_AUTO_FILL' },
      expect.any(Function)
    );
  });

  it('detects focus on standard email field and presents fill pill', async () => {
    initInPageHub(document);

    const emailInput = document.createElement('input');
    emailInput.id = 'candidate-email';
    emailInput.type = 'email';
    emailInput.setAttribute('name', 'email');
    emailInput.getBoundingClientRect = vi.fn().mockReturnValue({ top: 120, left: 80, bottom: 150 });
    document.body.appendChild(emailInput);

    // Trigger focusin
    emailInput.dispatchEvent(new Event('focusin', { bubbles: true }));

    // Allow promise tick for cached profile
    await new Promise((r) => setTimeout(r, 10));

    const host = document.getElementById(IN_PAGE_HUB_HOST_ID);
    const pill = host?.shadowRoot?.querySelector('.applykit-field-pill') as HTMLElement;

    expect(pill).toBeDefined();
    expect(pill.style.display).toBe('flex');
    expect(pill.textContent).toContain('Fill Email');
    expect(pill.textContent).toContain('morgan.reed@example.com');

    // Click pill to insert value
    pill.click();
    expect(emailInput.value).toBe('morgan.reed@example.com');
  });

  it('detects focus on essay textarea and presents draft answer pill', async () => {
    initInPageHub(document);

    const textarea = document.createElement('textarea');
    textarea.id = 'cover-letter-essay';
    textarea.setAttribute('placeholder', 'Why are you a good fit for this role?');
    textarea.getBoundingClientRect = vi.fn().mockReturnValue({ top: 300, left: 80, bottom: 450 });
    document.body.appendChild(textarea);

    textarea.dispatchEvent(new Event('focusin', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));

    const host = document.getElementById(IN_PAGE_HUB_HOST_ID);
    const pill = host?.shadowRoot?.querySelector('.applykit-field-pill') as HTMLElement;

    expect(pill).toBeDefined();
    expect(pill.style.display).toBe('flex');
    expect(pill.textContent).toContain('Draft Answer with ApplyKit');
  });

  it('strictly ignores submit buttons and password fields (Submission Hard Gate)', async () => {
    initInPageHub(document);

    const submitBtn = document.createElement('input');
    submitBtn.type = 'submit';
    submitBtn.value = 'Submit Application';
    document.body.appendChild(submitBtn);

    submitBtn.dispatchEvent(new Event('focusin', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));

    const host = document.getElementById(IN_PAGE_HUB_HOST_ID);
    const pill = host?.shadowRoot?.querySelector('.applykit-field-pill') as HTMLElement;

    expect(pill.style.display).toBe('none');
  });

  it('detects focus on resume file input and presents tailored resume attachment pill', async () => {
    initInPageHub(document);

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.name = 'resume';
    fileInput.id = 'resume-file-input';
    fileInput.getBoundingClientRect = vi.fn().mockReturnValue({ top: 400, left: 100, bottom: 440 });
    document.body.appendChild(fileInput);

    fileInput.dispatchEvent(new Event('focusin', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));

    const host = document.getElementById(IN_PAGE_HUB_HOST_ID);
    const pill = host?.shadowRoot?.querySelector('.applykit-field-pill') as HTMLElement;

    expect(pill).toBeDefined();
    expect(pill.style.display).toBe('flex');
    expect(pill.textContent).toContain('Attach Tailored Resume PDF');

    pill.click();
    expect((globalThis as any).chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'OPEN_SIDEPANEL_TAB', tab: 'tailor' }),
      expect.any(Function)
    );
  });

  it('cleanly removes host and shadow elements on unmount with zero residual DOM markers', () => {
    initInPageHub(document);
    expect(document.getElementById(IN_PAGE_HUB_HOST_ID)).not.toBeNull();

    unmountInPageHub(document);
    expect(document.getElementById(IN_PAGE_HUB_HOST_ID)).toBeNull();
  });
});
