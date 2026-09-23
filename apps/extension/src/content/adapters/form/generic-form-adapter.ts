/**
 * @fileoverview Generic Fallback ATS Form Adapter.
 *
 * Provides universal HTML5 form inspection, multi-step progress bar heuristics,
 * fieldset decomposition, and submit control gating for standard web forms and bespoke career portals.
 *
 * Invariants:
 * - Anti-Autonomous Submit Hard Gate (ADR-0006): Identifies submit buttons and prevents automated submission.
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
  extractNativeSelectOptions,
} from '../form-crawler-helpers.js';

/**
 * Generic Fallback ATS Form Adapter.
 */
export class GenericFormAdapter implements AtsFormAdapter {
  readonly id = 'generic' as const;
  readonly name = 'Standard Web Application Form';
  readonly priority = 10;

  matches(_url: URL, _doc: Document): boolean {
    return true;
  }

  detectAuthBarrier(doc: Document): AuthBarrierInfo | null {
    const hasPassword = Boolean(doc.querySelector('input[type="password"]'));
    const hasJobFields = Boolean(
      doc.querySelector(
        'input[name*="resume"], input[name*="cv"], textarea, input[name*="experience"], input[name*="education"]'
      )
    );

    if (hasPassword && !hasJobFields) {
      const signInBtn = doc.querySelector<HTMLElement>('button[type="submit"], input[type="submit"]');
      return {
        isBlocked: true,
        barrierType: 'login',
        message: 'This application requires signing in to an existing account before proceeding.',
        signInButtonSelector: signInBtn ? generateElementSelector(signInBtn, doc) : undefined,
      };
    }

    return null;
  }

  detectWizardState(doc: Document): StepProgressionInfo | null {
    const stepIndicators = Array.from(
      doc.querySelectorAll<HTMLElement>(
        'ol.steps li, ul.wizard-steps li, [role="progressbar"], .step-item, .progress-step'
      )
    );

    if (stepIndicators.length > 1) {
      let currentStep = 1;
      stepIndicators.forEach((s, i) => {
        if (s.classList.contains('active') || s.classList.contains('current') || s.getAttribute('aria-current') === 'step') {
          currentStep = i + 1;
        }
      });

      const nextBtn = doc.querySelector<HTMLElement>(
        'button.btn-next, button.next-step, input[value*="Next" i], input[value*="Continue" i]'
      );

      return {
        isMultiStep: true,
        currentStepIndex: currentStep,
        totalSteps: stepIndicators.length,
        nextStepButtonSelector: nextBtn ? generateElementSelector(nextBtn, doc) : undefined,
        isFinalStep: currentStep === stepIndicators.length,
      };
    }

    return null;
  }

  detectValidationErrors(doc: Document): readonly AtsValidationMessage[] {
    const errors: AtsValidationMessage[] = [];
    const errorContainers = Array.from(
      doc.querySelectorAll<HTMLElement>(
        '[aria-invalid="true"], .invalid-feedback, .error-message, .field-error, .text-danger'
      )
    );

    for (const el of errorContainers) {
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
      doc.querySelector<HTMLElement>(
        'form#application, form.application, [data-qa="job-application"], main form, form'
      ) ||
      doc.body;

    const fields: ApplicationField[] = [];
    const validationErrors = this.detectValidationErrors(doc);
    const wizardState = this.detectWizardState(doc);
    const authBarrier = this.detectAuthBarrier(doc);

    // Identify submit button
    let submitButtonSelector: string | undefined;
    const buttons = root.querySelectorAll<HTMLElement>('button, input[type="submit"], a.btn-submit');
    for (const btn of Array.from(buttons)) {
      if (isSubmitElement(btn)) {
        submitButtonSelector = generateElementSelector(btn, root);
        break;
      }
    }

    // 1. Process Radio Button Groups
    const radioInputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    const radioGroups = new Map<string, HTMLInputElement[]>();
    for (const radio of radioInputs) {
      const name = radio.name || 'unnamed_radio_group';
      const group = radioGroups.get(name) || [];
      group.push(radio);
      radioGroups.set(name, group);
    }

    for (const [name, radios] of radioGroups.entries()) {
      const firstRadio = radios[0];
      if (!firstRadio) continue;

      const label = extractGroupQuestionLabel(radios, root) || extractElementLabel(firstRadio, root);
      const required = radios.some((r) => isElementRequired(r, label));
      const selector = `input[type="radio"][name="${CSS.escape(name)}"]`;

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

    // 2. Standard Inputs, Textareas, Native Selects, File Uploaders
    const interactiveElements = root.querySelectorAll<HTMLElement>(
      'input:not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="image"]), textarea, select, [role="combobox"]'
    );

    for (const el of Array.from(interactiveElements)) {
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const name = el.getAttribute('name') || undefined;
      const id = el.id || undefined;
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
        options = extractNativeSelectOptions(el as HTMLSelectElement);
      } else if (el.getAttribute('role') === 'combobox') {
        fieldType = 'select';
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
      };

      const isHoneypot = isHoneypotField(rawAttrs);
      if (type === 'hidden' && !isHoneypot) continue;

      const classification = classifyFormField(rawAttrs);

      fields.push({
        id: createFieldId(),
        selector,
        fieldType,
        label: label || placeholder || name || id || 'Input Field',
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

    if (fields.length === 0 && !authBarrier) {
      return null;
    }

    return {
      id: root instanceof HTMLElement && root.id ? root.id : `generic_form_${Date.now()}`,
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
