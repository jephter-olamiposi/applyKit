/**
 * @fileoverview Unit and DOM interaction tests for Action Interpreter (Phase 9).
 *
 * Verifies:
 * 1. Native Property Setter Bypasses for React/Vue value tracking.
 * 2. Complete synthetic event lifecycles (pointerdown, focus, input, change, blur).
 * 3. Anti-Autonomous Submission Hard Gate (ADR-0006): zero automated clicks on submit controls.
 * 4. Human-paced plan execution and execution report generation.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  setNativeInputValue,
  setNativeCheckboxChecked,
  simulateTextInput,
  simulateSelectOption,
  simulateClick,
  simulateCheckbox,
  simulateFileUpload,
  executeSingleAction,
  executeBrowserPlan,
} from '../content/action-interpreter.js';
import type { DryRunPlan, DryRunAction, PlanId, ActionId } from '@applykit/domain';

describe('Browser Action Interpreter & Event Simulator (Phase 9)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Native Property Setter Bypasses', () => {
    it('sets input value directly and triggers native setter', () => {
      const input = document.createElement('input');
      input.type = 'text';
      document.body.appendChild(input);

      setNativeInputValue(input, 'Jane Doe');
      expect(input.value).toBe('Jane Doe');
    });

    it('sets textarea value directly', () => {
      const textarea = document.createElement('textarea');
      document.body.appendChild(textarea);

      setNativeInputValue(textarea, 'Experienced software architect.');
      expect(textarea.value).toBe('Experienced software architect.');
    });

    it('sets checkbox checked state via native setter', () => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      document.body.appendChild(checkbox);

      expect(checkbox.checked).toBe(false);
      setNativeCheckboxChecked(checkbox, true);
      expect(checkbox.checked).toBe(true);
      setNativeCheckboxChecked(checkbox, false);
      expect(checkbox.checked).toBe(false);
    });
  });

  describe('Synthetic Event Lifecycles', () => {
    it('dispatches full event sequence during simulateTextInput', () => {
      const input = document.createElement('input');
      input.type = 'text';
      document.body.appendChild(input);

      const dispatchedEvents: string[] = [];
      const trackEvent = (e: Event) => dispatchedEvents.push(e.type);

      ['pointerdown', 'mousedown', 'focus', 'focusin', 'input', 'change', 'blur', 'focusout'].forEach(
        (eventType) => input.addEventListener(eventType, trackEvent)
      );

      simulateTextInput(input, 'Senior Engineer');

      expect(input.value).toBe('Senior Engineer');
      expect(dispatchedEvents).toEqual([
        'pointerdown',
        'mousedown',
        'focus',
        'focusin',
        'input',
        'change',
        'blur',
        'focusout',
      ]);
    });

    it('selects option and dispatches input and change events in simulateSelectOption', () => {
      const select = document.createElement('select');
      select.innerHTML = `
        <option value="">Choose...</option>
        <option value="us_citizen">US Citizen</option>
        <option value="visa">Requires Visa</option>
      `;
      document.body.appendChild(select);

      let changeFired = false;
      select.addEventListener('change', () => {
        changeFired = true;
      });

      simulateSelectOption(select, 'us_citizen');

      expect(select.value).toBe('us_citizen');
      expect(changeFired).toBe(true);
      const chosenOption = select.querySelector<HTMLOptionElement>('option[value="us_citizen"]');
      expect(chosenOption?.selected).toBe(true);
    });

    it('toggles checkbox and fires click, input, and change events in simulateCheckbox', () => {
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      document.body.appendChild(checkbox);

      const fired: string[] = [];
      checkbox.addEventListener('click', () => fired.push('click'));
      checkbox.addEventListener('input', () => fired.push('input'));
      checkbox.addEventListener('change', () => fired.push('change'));

      simulateCheckbox(checkbox, true);

      expect(checkbox.checked).toBe(true);
      expect(fired).toContain('click');
      expect(fired).toContain('change');
    });

    it('attaches synthetic file and dispatches change events in simulateFileUpload', () => {
      const fileInput = document.createElement('input');
      fileInput.type = 'file';
      document.body.appendChild(fileInput);

      let changeFired = false;
      fileInput.addEventListener('change', () => {
        changeFired = true;
      });

      simulateFileUpload(fileInput, 'my_resume.pdf');

      expect(changeFired).toBe(true);
    });
  });

  describe('Anti-Autonomous Submission Hard Gate (ADR-0006)', () => {
    it('allows clicks on non-submission controls', () => {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'add_education';
      button.textContent = 'Add School';
      document.body.appendChild(button);

      let clicked = false;
      button.addEventListener('click', () => {
        clicked = true;
      });

      expect(() => simulateClick(button)).not.toThrow();
      expect(clicked).toBe(true);
    });

    it('blocks simulated clicks on button[type="submit"]', () => {
      const submitBtn = document.createElement('button');
      submitBtn.type = 'submit';
      submitBtn.textContent = 'Submit Application';
      document.body.appendChild(submitBtn);

      expect(() => simulateClick(submitBtn)).toThrow(
        /Autonomous submission blocked/
      );
    });

    it('blocks simulated clicks on inputs with submit value', () => {
      const submitInput = document.createElement('input');
      submitInput.type = 'submit';
      submitInput.value = 'Apply Now';
      document.body.appendChild(submitInput);

      expect(() => simulateClick(submitInput)).toThrow(
        /Autonomous submission blocked/
      );
    });

    it('blocks simulated clicks on buttons with submission text labels', () => {
      const submitBtn = document.createElement('button');
      submitBtn.type = 'button';
      submitBtn.textContent = 'Submit Application Now';
      document.body.appendChild(submitBtn);

      expect(() => simulateClick(submitBtn)).toThrow(
        /Autonomous submission blocked/
      );
    });
  });

  describe('Single Action Execution (executeSingleAction)', () => {
    it('executes a text fill action and updates target element', async () => {
      document.body.innerHTML = `
        <form id="app_form">
          <input id="candidate_email" type="email" />
        </form>
      `;

      const action: DryRunAction = {
        id: 'action-1' as ActionId,
        action: {
          actionType: 'fill_text',
          selector: '#candidate_email',
          value: 'test@example.com',
          description: 'Fill candidate email',
          requiresUserConfirmation: false,
        },
        fieldId: 'email-field' as any,
        riskLevel: 'low',
        userConfirmed: true,
        confidence: 1.0,
        currentValue: '',
        candidateValueUsed: 'test@example.com',
        diffExplanation: 'Populate email address',
      };

      await executeSingleAction(action, document, { pacingDelayMs: 0, highlightElements: false });

      const input = document.getElementById('candidate_email') as HTMLInputElement;
      expect(input.value).toBe('test@example.com');
    });

    it('throws error if target selector cannot be resolved in document', async () => {
      const action: DryRunAction = {
        id: 'action-missing' as ActionId,
        action: {
          actionType: 'fill_text',
          selector: '#non_existent_input',
          value: 'Hello',
          description: 'Fill missing input',
          requiresUserConfirmation: false,
        },
        fieldId: 'field-1' as any,
        riskLevel: 'low',
        userConfirmed: true,
        confidence: 1.0,
        currentValue: '',
        candidateValueUsed: 'Hello',
        diffExplanation: 'Missing target',
      };

      await expect(
        executeSingleAction(action, document, { pacingDelayMs: 0, highlightElements: false })
      ).rejects.toThrow(/Target DOM element not found/);
    });

    it('blocks execution when action targets a submission control', async () => {
      document.body.innerHTML = `
        <button id="final_submit_btn" type="submit">Submit Application</button>
      `;

      const action: DryRunAction = {
        id: 'action-submit' as ActionId,
        action: {
          actionType: 'click',
          selector: '#final_submit_btn',
          description: 'Click Submit Application',
          requiresUserConfirmation: true,
        },
        fieldId: 'field-sub' as any,
        riskLevel: 'high',
        userConfirmed: true,
        confidence: 1.0,
        currentValue: '',
        candidateValueUsed: '',
        diffExplanation: 'Dangerous submit click',
      };

      await expect(
        executeSingleAction(action, document, { pacingDelayMs: 0, highlightElements: false })
      ).rejects.toThrow(/(Autonomous submission blocked|Action prohibited by safety policy)/);
    });
  });

  describe('Full Dry Run Plan Execution (executeBrowserPlan)', () => {
    it('executes only approved actions and reports completion metrics', async () => {
      document.body.innerHTML = `
        <form id="lever_form">
          <input id="full_name" type="text" />
          <input id="email_address" type="email" />
          <input id="phone_num" type="tel" />
        </form>
      `;

      const plan: DryRunPlan = {
        id: 'plan-123' as PlanId,
        formId: 'form-123',
        formUrl: 'https://jobs.lever.co/test/apply',
        detectedAts: 'lever',
        isApproved: false,
        actions: [
          {
            id: 'action-1' as ActionId,
            action: {
              actionType: 'fill_text',
              selector: '#full_name',
              value: 'Alex Mercer',
              description: 'Fill Full Name',
              requiresUserConfirmation: false,
            },
            fieldId: 'name-field' as any,
            riskLevel: 'low',
            userConfirmed: true, // Approved
            confidence: 1.0,
            currentValue: '',
            candidateValueUsed: 'Alex Mercer',
            diffExplanation: 'Fill verified name',
          },
          {
            id: 'action-2' as ActionId,
            action: {
              actionType: 'fill_text',
              selector: '#email_address',
              value: 'alex@example.com',
              description: 'Fill Email',
              requiresUserConfirmation: false,
            },
            fieldId: 'email-field' as any,
            riskLevel: 'low',
            userConfirmed: true, // Approved
            confidence: 1.0,
            currentValue: '',
            candidateValueUsed: 'alex@example.com',
            diffExplanation: 'Fill verified email',
          },
          {
            id: 'action-3' as ActionId,
            action: {
              actionType: 'fill_text',
              selector: '#phone_num',
              value: '+15551234567',
              description: 'Fill Phone Number',
              requiresUserConfirmation: true,
            },
            fieldId: 'phone-field' as any,
            riskLevel: 'high',
            userConfirmed: false, // NOT approved
            confidence: 0.8,
            currentValue: '',
            candidateValueUsed: '+15551234567',
            diffExplanation: 'Unconfirmed phone fill',
          },
        ],
        skippedFields: [],
        stats: {
          totalActions: 3,
          lowRiskCount: 2,
          mediumRiskCount: 0,
          highRiskCount: 1,
          requiresConfirmationCount: 1,
          unmappedRequiredCount: 0,
        },
        createdAt: new Date().toISOString(),
      };

      const report = await executeBrowserPlan(plan, document, {
        pacingDelayMs: 0,
        highlightElements: false,
      });

      // Verifies only user-confirmed actions executed
      expect(report.totalPlanned).toBe(2);
      expect(report.executedCount).toBe(2);
      expect(report.failedCount).toBe(0);
      expect(report.haltedAtSubmissionGate).toBe(true);

      const nameInput = document.getElementById('full_name') as HTMLInputElement;
      const emailInput = document.getElementById('email_address') as HTMLInputElement;
      const phoneInput = document.getElementById('phone_num') as HTMLInputElement;

      expect(nameInput.value).toBe('Alex Mercer');
      expect(emailInput.value).toBe('alex@example.com');
      // Unconfirmed field must remain empty
      expect(phoneInput.value).toBe('');
    });

    it('captures failed action details without halting entire execution batch', async () => {
      document.body.innerHTML = `
        <form id="greenhouse_form">
          <input id="first_name" type="text" />
        </form>
      `;

      const plan: DryRunPlan = {
        id: 'plan-err' as PlanId,
        formId: 'form-err',
        formUrl: 'https://boards.greenhouse.io/test/jobs/1',
        detectedAts: 'greenhouse',
        isApproved: true,
        actions: [
          {
            id: 'action-fail' as ActionId,
            action: {
              actionType: 'fill_text',
              selector: '#non_existent_element',
              value: 'Ghost',
              description: 'Fill Missing',
              requiresUserConfirmation: false,
            },
            fieldId: 'ghost-field' as any,
            riskLevel: 'low',
            userConfirmed: true,
            confidence: 1.0,
            currentValue: '',
            candidateValueUsed: 'Ghost',
            diffExplanation: 'Ghost field',
          },
          {
            id: 'action-ok' as ActionId,
            action: {
              actionType: 'fill_text',
              selector: '#first_name',
              value: 'Samantha',
              description: 'Fill First Name',
              requiresUserConfirmation: false,
            },
            fieldId: 'name-field' as any,
            riskLevel: 'low',
            userConfirmed: true,
            confidence: 1.0,
            currentValue: '',
            candidateValueUsed: 'Samantha',
            diffExplanation: 'Fill first name',
          },
        ],
        skippedFields: [],
        stats: {
          totalActions: 2,
          lowRiskCount: 2,
          mediumRiskCount: 0,
          highRiskCount: 0,
          requiresConfirmationCount: 0,
          unmappedRequiredCount: 0,
        },
        createdAt: new Date().toISOString(),
      };

      const report = await executeBrowserPlan(plan, document, {
        pacingDelayMs: 0,
        highlightElements: false,
      });

      expect(report.totalPlanned).toBe(2);
      expect(report.executedCount).toBe(1);
      expect(report.failedCount).toBe(1);
      expect(report.failedActions[0]?.selector).toBe('#non_existent_element');

      const nameInput = document.getElementById('first_name') as HTMLInputElement;
      expect(nameInput.value).toBe('Samantha');
    });
  });
});
