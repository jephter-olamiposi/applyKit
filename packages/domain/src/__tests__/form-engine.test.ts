import { describe, it, expect } from 'vitest';
import {
  isTextualField,
  isChoiceField,
  isSubmissionIntent,
  validateBrowserActionSafety,
  validateDryRunPlan,
  createActionId,
  type BrowserAction,
  type DryRunAction,
} from '../index.js';

describe('Form Engine & Browser Action Protocol', () => {
  it('correctly categorizes textual and choice fields', () => {
    expect(isTextualField('text')).toBe(true);
    expect(isTextualField('textarea')).toBe(true);
    expect(isTextualField('select')).toBe(false);

    expect(isChoiceField('select')).toBe(true);
    expect(isChoiceField('radio')).toBe(true);
    expect(isChoiceField('checkbox')).toBe(true);
    expect(isChoiceField('text')).toBe(false);
  });

  it('detects and blocks submission intents in browser actions', () => {
    expect(isSubmissionIntent('button[type="submit"]')).toBe(true);
    expect(isSubmissionIntent('button.submit-btn')).toBe(true);
    expect(isSubmissionIntent('input#first_name', 'Submit Application')).toBe(true);
    expect(isSubmissionIntent('input#first_name', 'Fill First Name')).toBe(false);

    const submitAction: BrowserAction = {
      actionType: 'click',
      selector: 'button#submit-application',
      description: 'Submit Application Now',
      requiresUserConfirmation: true,
    };

    const safetyCheck = validateBrowserActionSafety(submitAction);
    expect(safetyCheck.isProhibited).toBe(true);
    expect(safetyCheck.reason).toContain('Automated submission is strictly prohibited');
  });

  it('prohibits javascript: pseudo-protocol in action values', () => {
    const maliciousAction: BrowserAction = {
      actionType: 'fill_text',
      selector: 'input#website',
      value: 'javascript:alert(1)',
      description: 'Fill website URL',
      requiresUserConfirmation: false,
    };

    const safetyCheck = validateBrowserActionSafety(maliciousAction);
    expect(safetyCheck.isProhibited).toBe(true);
    expect(safetyCheck.reason).toContain('javascript: pseudo-protocol');
  });

  it('validates dry run plans and flags prohibited actions', () => {
    const safeAction: DryRunAction = {
      id: createActionId('act_1'),
      action: {
        actionType: 'fill_text',
        selector: 'input#email',
        value: 'candidate@example.com',
        description: 'Fill Email Address',
        requiresUserConfirmation: false,
      },
      currentValue: '',
      candidateValueUsed: 'candidate@example.com',
      confidence: 1.0,
      riskLevel: 'low',
      userConfirmed: true,
    };

    const unsafeAction: DryRunAction = {
      id: createActionId('act_2'),
      action: {
        actionType: 'click',
        selector: 'button[type="submit"]',
        description: 'Submit application',
        requiresUserConfirmation: true,
      },
      currentValue: '',
      candidateValueUsed: '',
      confidence: 0.9,
      riskLevel: 'high',
      userConfirmed: false,
    };

    const validation = validateDryRunPlan([safeAction, unsafeAction]);
    expect(validation.isValid).toBe(false);
    expect(validation.prohibitedActions).toHaveLength(1);
    expect(validation.prohibitedActions[0]?.actionId).toBe(unsafeAction.id);
    expect(validation.requiresConfirmationCount).toBe(1);
  });
});
