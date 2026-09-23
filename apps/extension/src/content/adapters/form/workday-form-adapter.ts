/**
 * @fileoverview Workday ATS Form Adapter.
 *
 * Provides specialized form extraction, multi-step wizard progression tracking,
 * authentication barrier detection, and custom prompt dropdown resolution for Workday applications.
 *
 * Invariants:
 * - Anti-Autonomous Submit Hard Gate (ADR-0006): Distinguishes "Save & Continue" step buttons
 *   from final submission buttons. The submission button on the review step is strictly gated.
 */

import {
  createFieldId,
  classifyFormField,
  isHoneypotField,
  type ApplicationForm,
  type ApplicationField,
  type AuthBarrierInfo,
  type StepProgressionInfo,
  type AtsValidationMessage,
  type SelectOption,
  type RawFieldAttributes,
} from '@applykit/domain';
import type { AtsFormAdapter } from './form-adapter.js';
import {
  generateElementSelector,
  extractElementLabel,
  extractGroupQuestionLabel,
  isElementRequired,
  isSubmitElement,
} from '../form-crawler-helpers.js';

/**
 * Workday ATS Form Adapter.
 */
export class WorkdayFormAdapter implements AtsFormAdapter {
  readonly id = 'workday' as const;
  readonly name = 'Workday Application Wizard';
  readonly priority = 40;

  matches(url: URL, doc: Document): boolean {
    const host = url.hostname.toLowerCase();
    if (host.includes('myworkdayjobs.com') || host.includes('workday.com')) {
      return true;
    }

    return Boolean(
      doc.querySelector(
        '[data-automation-id*="workday"], [data-automation-id="workdayApplication"], [data-automation-id="compositeHeader"], [data-automation-id="pageHeader"]'
      )
    );
  }

  detectAuthBarrier(doc: Document): AuthBarrierInfo | null {
    // Check for explicit sign in or account registration screens
    const isSignIn = Boolean(
      doc.querySelector(
        '[data-automation-id="signInPage"], [data-automation-id="createAccountPage"], form[data-automation-id="signInForm"]'
      )
    );

    const hasPasswordField = Boolean(
      doc.querySelector('input[type="password"], input[data-automation-id="password"]')
    );

    const hasJobFields = Boolean(
      doc.querySelector(
        '[data-automation-id*="legalName"], [data-automation-id*="addressSection"], [data-automation-id*="workHistory"], [data-automation-id="workdayApplication"]'
      )
    );

    // If password field exists without job application inputs, candidate must sign in first
    if (isSignIn || (hasPasswordField && !hasJobFields)) {
      const signInBtn = doc.querySelector<HTMLElement>(
        'button[data-automation-id="signInSubmitButton"], button[data-automation-id="createAccountSubmitButton"], button[type="submit"]'
      );

      return {
        isBlocked: true,
        barrierType: isSignIn ? 'login' : 'login',
        message:
          'Workday requires signing in or creating an account before continuing with this application.',
        signInButtonSelector: signInBtn
          ? generateElementSelector(signInBtn, doc)
          : undefined,
      };
    }

    return null;
  }

  detectWizardState(doc: Document): StepProgressionInfo | null {
    // Workday step indicators
    const stepItems = Array.from(
      doc.querySelectorAll<HTMLElement>(
        '[data-automation-id^="step-"], [data-automation-id*="stepItem"], li[data-automation-id*="step"], [data-automation-id="progressBar"] li'
      )
    );

    // Step text in header (e.g. "Step 2 of 5: My Experience")
    const headerText =
      doc.querySelector('[data-automation-id="compositeHeader"], [data-automation-id="pageHeader"]')?.textContent ||
      '';
    const stepRegex = /step\s+(\d+)\s+of\s+(\d+)/i;
    const match = headerText.match(stepRegex);

    let currentStep = 1;
    let totalSteps = 1;
    let stepName: string | undefined;

    if (match && match[1] && match[2]) {
      currentStep = parseInt(match[1], 10);
      totalSteps = parseInt(match[2], 10);
      const namePart = headerText.split(/[-:–]/);
      if (namePart.length > 1 && namePart[1]) {
        stepName = namePart[1].trim();
      }
    } else if (stepItems.length > 0) {
      totalSteps = stepItems.length;
      stepItems.forEach((item, idx) => {
        if (
          item.getAttribute('aria-current') === 'step' ||
          item.classList.contains('active') ||
          item.getAttribute('data-automation-id')?.includes('current')
        ) {
          currentStep = idx + 1;
          stepName = item.textContent?.trim() || undefined;
        }
      });
    } else {
      // Not a detected multi-step wizard
      return null;
    }

    const isFinalStep =
      currentStep === totalSteps ||
      (stepName ? /review|submit/i.test(stepName) : false);

    // Next button in Workday wizard
    let nextStepButtonSelector: string | undefined;
    if (!isFinalStep) {
      const nextBtn = doc.querySelector<HTMLElement>(
        'button[data-automation-id="bottom-navigation-next-button"], button[data-automation-id="nextButton"], button[data-automation-id="saveAndContinueButton"]'
      );
      if (nextBtn) {
        nextStepButtonSelector = generateElementSelector(nextBtn, doc);
      }
    }

    return {
      isMultiStep: true,
      currentStepIndex: currentStep,
      totalSteps,
      stepName,
      stepNames: stepItems.map((s) => s.textContent?.trim() || '').filter(Boolean),
      nextStepButtonSelector,
      isFinalStep,
    };
  }

  detectValidationErrors(doc: Document): readonly AtsValidationMessage[] {
    const errors: AtsValidationMessage[] = [];
    const errorElements = Array.from(
      doc.querySelectorAll<HTMLElement>(
        '[data-automation-id="errorMessage"], [data-automation-id="formError"], div.wd-error, [data-automation-id="errorBanner"]'
      )
    );

    for (const el of errorElements) {
      const msg = el.textContent?.trim();
      if (msg) {
        errors.push({
          fieldSelector: generateElementSelector(el, doc),
          message: msg,
        });
      }
    }

    return errors;
  }

  crawlForm(doc: Document, container?: HTMLElement): ApplicationForm | null {
    const root =
      container ||
      doc.querySelector<HTMLElement>('[data-automation-id="workdayApplication"]') ||
      doc.querySelector<HTMLElement>('[data-automation-id="pageHeader"]')?.parentElement ||
      doc.querySelector<HTMLElement>('main, form') ||
      doc.body;

    const wizardState = this.detectWizardState(doc);
    const authBarrier = this.detectAuthBarrier(doc);
    const validationErrors = this.detectValidationErrors(doc);

    // Identify submit button (strictly on review/final step)
    let submitButtonSelector: string | undefined;
    const isFinal = wizardState ? wizardState.isFinalStep : true;

    if (isFinal) {
      const submitBtn = root.querySelector<HTMLElement>(
        'button[data-automation-id="submitButton"], button[data-automation-id="bottom-navigation-submit-button"], button[type="submit"]'
      );
      if (submitBtn && isSubmitElement(submitBtn)) {
        submitButtonSelector = generateElementSelector(submitBtn, root);
      }
    }

    const fields: ApplicationField[] = [];

    // 1. Process Radio Button Groups in Workday
    const radioInputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    const radioGroups = new Map<string, HTMLInputElement[]>();
    for (const radio of radioInputs) {
      const name = radio.name || radio.getAttribute('data-automation-id') || 'unnamed_radio';
      const group = radioGroups.get(name) || [];
      group.push(radio);
      radioGroups.set(name, group);
    }

    for (const [name, radios] of radioGroups.entries()) {
      const firstRadio = radios[0];
      if (!firstRadio) continue;

      const label = extractGroupQuestionLabel(radios, root) || extractElementLabel(firstRadio, root);
      const required = radios.some((r) => isElementRequired(r, label));
      const selector = `input[type="radio"][name="${CSS.escape(firstRadio.name || name)}"]`;

      const options: SelectOption[] = radios.map((r) => {
        const optLabel = extractElementLabel(r, root) || r.value;
        return { value: r.value, label: optLabel };
      });

      const rawAttrs: RawFieldAttributes = {
        tag: 'input',
        type: 'radio',
        name,
        id: firstRadio.id,
        label,
        dataAutomationId: firstRadio.getAttribute('data-automation-id') || undefined,
      };

      const classification = classifyFormField(rawAttrs);

      fields.push({
        id: createFieldId(),
        selector,
        fieldType: 'radio',
        label: label || name,
        name,
        isRequired: required,
        options,
        confidenceScore: classification.confidence,
        inferredMappingKey: classification.inferredProfilePath,
      });
    }

    // 2. Process Standard Inputs, Textareas, and Native Selects
    const standardInputs = root.querySelectorAll<HTMLElement>(
      'input:not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="image"]), textarea, select'
    );

    for (const el of Array.from(standardInputs)) {
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const name = el.getAttribute('name') || undefined;
      const id = el.id || undefined;
      const dataAutomationId = el.getAttribute('data-automation-id') || undefined;
      const label = extractElementLabel(el, root);
      const placeholder = (el as HTMLInputElement).placeholder || undefined;
      const required = isElementRequired(el, label);
      const selector = generateElementSelector(el, root);

      let fieldType = 'text' as ApplicationField['fieldType'];
      let options: readonly SelectOption[] | undefined;

      if (tag === 'textarea') {
        fieldType = 'textarea';
      } else if (tag === 'select') {
        fieldType = 'select';
        options = Array.from((el as HTMLSelectElement).options).map((opt) => ({
          value: opt.value,
          label: opt.text.trim() || opt.value,
        }));
      } else if (type === 'checkbox') {
        fieldType = 'checkbox';
      } else if (type === 'file') {
        fieldType = 'file_upload';
      } else if (type === 'email') {
        fieldType = 'email';
      } else if (type === 'tel') {
        fieldType = 'tel';
      } else if (type === 'number') {
        fieldType = 'number';
      } else if (type === 'date') {
        fieldType = 'date';
      }

      const rawAttrs: RawFieldAttributes = {
        tag,
        type,
        name,
        id,
        label,
        placeholder,
        dataAutomationId,
      };

      const isHoneypot = isHoneypotField(rawAttrs);
      if (type === 'hidden' && !isHoneypot) continue;

      const classification = classifyFormField(rawAttrs);

      fields.push({
        id: createFieldId(),
        selector,
        fieldType,
        label: label || placeholder || dataAutomationId || name || id || 'Input Field',
        placeholder,
        name,
        isRequired: required,
        options,
        currentValue: (el as HTMLInputElement).value || undefined,
        confidenceScore: classification.confidence,
        inferredMappingKey: classification.inferredProfilePath,
        isHoneypotSuspect: isHoneypot,
      });
    }

    // 3. Process Workday Custom Prompt Search Buttons / Dropdown Grids
    const customDropdowns = root.querySelectorAll<HTMLElement>(
      'button[data-automation-id="searchBox"], button[data-automation-id="promptOption"], div[data-automation-id="multiselectInputContainer"], [data-automation-id*="dropdown"]'
    );

    for (const dropdown of Array.from(customDropdowns)) {
      const dataAutomationId = dropdown.getAttribute('data-automation-id') || '';
      const selector = generateElementSelector(dropdown, root);

      // Check if we already registered an input with this selector
      if (fields.some((f) => f.selector === selector)) continue;

      const label = extractElementLabel(dropdown, root);
      const required = isElementRequired(dropdown, label);

      const rawAttrs: RawFieldAttributes = {
        tag: 'button',
        type: 'button',
        id: dropdown.id,
        label,
        dataAutomationId,
      };

      const classification = classifyFormField(rawAttrs);

      fields.push({
        id: createFieldId(),
        selector,
        fieldType: 'select',
        label: label || dataAutomationId || 'Workday Selection Field',
        isRequired: required,
        currentValue: dropdown.textContent?.trim() || undefined,
        confidenceScore: Math.max(classification.confidence, 0.85),
        inferredMappingKey: classification.inferredProfilePath,
      });
    }

    if (fields.length === 0 && !authBarrier && !submitButtonSelector && !wizardState) {
      return null;
    }

    return {
      id: `workday_form_${Date.now()}`,
      url: doc.location ? doc.location.href : '',
      detectedAts: this.id,
      fields,
      submitButtonSelector,
      isMultiStep: wizardState?.isMultiStep || false,
      currentStepIndex: wizardState?.currentStepIndex,
      totalSteps: wizardState?.totalSteps,
      authBarrier: authBarrier || undefined,
      stepProgression: wizardState || undefined,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
      inspectedAt: new Date().toISOString(),
    };
  }
}
