/**
 * @fileoverview Ashby ATS Form Adapter.
 *
 * Provides specialized form extraction for Ashby's React-based application forms,
 * handling custom ARIA comboboxes, dynamic validation error tracking, multi-select tags,
 * and custom file upload dropzones.
 *
 * Invariants:
 * - Anti-Autonomous Submit Hard Gate (ADR-0006): Identifies Ashby's submit button and blocks automated clicks.
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
 * Ashby ATS Form Adapter.
 */
export class AshbyFormAdapter implements AtsFormAdapter {
  readonly id = 'ashby' as const;
  readonly name = 'Ashby Application Form';
  readonly priority = 30;

  matches(url: URL, doc: Document): boolean {
    const host = url.hostname.toLowerCase();
    if (host.includes('ashbyhq.com') || host.includes('jobs.ashbyhq.com')) {
      return true;
    }

    return Boolean(
      doc.querySelector(
        '[data-ashby], #ashby-application-form, .ashby-application-form, [data-testid*="ashby"], div[class*="_ashbyContainer"]'
      )
    );
  }

  detectAuthBarrier(_doc: Document): AuthBarrierInfo | null {
    return null;
  }

  detectWizardState(doc: Document): StepProgressionInfo | null {
    const stepIndicators = Array.from(
      doc.querySelectorAll<HTMLElement>('[role="progressbar"], .ashby-step, div[class*="_stepIndicator"]')
    );

    if (stepIndicators.length > 1) {
      let currentStep = 1;
      stepIndicators.forEach((s, i) => {
        if (s.getAttribute('aria-current') === 'step' || s.classList.contains('active')) {
          currentStep = i + 1;
        }
      });

      const nextBtn = doc.querySelector<HTMLElement>('button[data-testid*="next"], button.ashby-next-button');
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
        '[aria-invalid="true"], [data-invalid="true"], .ashby-form-field-error, div[class*="_errorMessage"]'
      )
    );

    for (const el of errorContainers) {
      const msg = el.textContent?.trim() || el.getAttribute('data-error-message');
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
        '#ashby-application-form, .ashby-application-form, [data-testid="application-form"], form'
      ) ||
      doc.body;

    const fields: ApplicationField[] = [];
    const validationErrors = this.detectValidationErrors(doc);
    const wizardState = this.detectWizardState(doc);

    // Identify submit button
    let submitButtonSelector: string | undefined;
    const submitBtn = root.querySelector<HTMLElement>(
      'button[data-testid="submit-application-button"], button[type="submit"], button.ashby-submit'
    );
    if (submitBtn && isSubmitElement(submitBtn)) {
      submitButtonSelector = generateElementSelector(submitBtn, root);
    }

    // 1. Process Radio Button Groups
    const radioInputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    const radioGroups = new Map<string, HTMLInputElement[]>();
    for (const radio of radioInputs) {
      const name = radio.name || 'unnamed_ashby_radio';
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
        // Extract rendered options if listbox is present
        const listboxId = el.getAttribute('aria-controls');
        if (listboxId) {
          const listbox = doc.getElementById(listboxId);
          if (listbox) {
            options = Array.from(listbox.querySelectorAll('[role="option"]')).map((opt) => ({
              value: opt.getAttribute('data-value') || opt.textContent?.trim() || '',
              label: opt.textContent?.trim() || '',
            }));
          }
        }
      } else if (type === 'checkbox') {
        fieldType = 'checkbox';
      } else if (type === 'file') {
        fieldType = 'file_upload';
      } else if (type === 'email') {
        fieldType = 'email';
      } else if (type === 'tel') {
        fieldType = 'tel';
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

    if (fields.length === 0) {
      return null;
    }

    return {
      id: root.id || `ashby_form_${Date.now()}`,
      url: doc.location ? doc.location.href : '',
      detectedAts: this.id,
      fields,
      submitButtonSelector,
      isMultiStep: wizardState?.isMultiStep || false,
      currentStepIndex: wizardState?.currentStepIndex,
      totalSteps: wizardState?.totalSteps,
      stepProgression: wizardState || undefined,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
      inspectedAt: new Date().toISOString(),
    };
  }
}
