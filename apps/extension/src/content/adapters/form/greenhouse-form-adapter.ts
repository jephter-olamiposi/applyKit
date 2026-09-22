/**
 * @fileoverview Greenhouse ATS Form Adapter.
 *
 * Provides specialized form extraction, demographic disclosure (EEO) classification,
 * custom resume/cover letter file upload detection, and dynamic question mapping for Greenhouse forms.
 *
 * Invariants:
 * - Anti-Autonomous Submit Hard Gate (ADR-0006): Identifies #submit_app and blocks automated clicks.
 * - Human Verification for Sensitive Data (ADR-0003): Marks EEO and demographic disclosures
 *   for mandatory candidate review.
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
  isElementRequired,
  isSubmitElement,
  extractNativeSelectOptions,
} from '../form-crawler-helpers.js';

/**
 * Greenhouse ATS Form Adapter.
 */
export class GreenhouseFormAdapter implements AtsFormAdapter {
  readonly id = 'greenhouse' as const;
  readonly name = 'Greenhouse Application Form';
  readonly priority = 30;

  matches(url: URL, doc: Document): boolean {
    const host = url.hostname.toLowerCase();
    const search = url.search.toLowerCase();

    if (host.includes('greenhouse.io') || search.includes('gh_jid')) {
      return true;
    }

    return Boolean(
      doc.querySelector('#grnhse_app, form#application_form, [data-greenhouse], #main_fields, #eeo_questions')
    );
  }

  detectAuthBarrier(_doc: Document): AuthBarrierInfo | null {
    // Greenhouse standard forms are publicly accessible without candidate sign-in walls.
    return null;
  }

  detectWizardState(doc: Document): StepProgressionInfo | null {
    // Check for rare multi-page Greenhouse embed setups
    const stepIndicators = Array.from(doc.querySelectorAll<HTMLElement>('.step-item, .wizard-step, .nav-step'));
    if (stepIndicators.length > 1) {
      let currentStep = 1;
      stepIndicators.forEach((s, i) => {
        if (s.classList.contains('active') || s.classList.contains('current')) {
          currentStep = i + 1;
        }
      });

      const nextBtn = doc.querySelector<HTMLElement>('button.btn-next, .next-step-btn');
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
      doc.querySelectorAll<HTMLElement>('.field-error, .error-message, [aria-invalid="true"], .invalid-feedback')
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
      doc.querySelector<HTMLElement>('#grnhse_app, form#application_form, #main_fields') ||
      doc.body;

    const fields: ApplicationField[] = [];
    const validationErrors = this.detectValidationErrors(doc);
    const wizardState = this.detectWizardState(doc);

    // Identify submit button (e.g. #submit_app)
    let submitButtonSelector: string | undefined;
    const submitBtn = root.querySelector<HTMLElement>(
      'input#submit_app, button#submit_app, input[type="submit"], [data-qa="submit-button"]'
    );
    if (submitBtn && isSubmitElement(submitBtn)) {
      submitButtonSelector = generateElementSelector(submitBtn, root);
    }

    // 1. Radio Button Groups (including EEO yes/no radios)
    const radioInputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    const radioGroups = new Map<string, HTMLInputElement[]>();
    for (const radio of radioInputs) {
      const name = radio.name || 'unnamed_radio';
      const group = radioGroups.get(name) || [];
      group.push(radio);
      radioGroups.set(name, group);
    }

    for (const [name, radios] of radioGroups.entries()) {
      const firstRadio = radios[0];
      if (!firstRadio) continue;

      const label = extractElementLabel(firstRadio, root);
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
      'input:not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="image"]), textarea, select'
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
      } else if (type === 'checkbox') {
        fieldType = 'checkbox';
      } else if (type === 'file') {
        fieldType = 'file_upload';
      } else if (type === 'email') {
        fieldType = 'email';
      } else if (type === 'tel') {
        fieldType = 'tel';
      }

      // Check if inside Greenhouse EEO demographic container
      const isEeoField = Boolean(el.closest('#eeo_questions, #eeo_fields, .eeo-section'));

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

      let classification = classifyFormField(rawAttrs);

      // Boost EEO classification if inside EEO container
      if (isEeoField && (!classification.inferredProfilePath || classification.confidence < 0.7)) {
        const lowerLabel = (label || name || '').toLowerCase();
        if (lowerLabel.includes('gender') || lowerLabel.includes('sex')) {
          classification = {
            canonicalKey: 'eeo_gender',
            confidence: 0.95,
            inferredProfilePath: 'identity.eeo.gender',
            rationale: 'Greenhouse EEO container gender field',
          };
        } else if (lowerLabel.includes('race') || lowerLabel.includes('ethnicity')) {
          classification = {
            canonicalKey: 'eeo_race',
            confidence: 0.95,
            inferredProfilePath: 'identity.eeo.race',
            rationale: 'Greenhouse EEO container race field',
          };
        } else if (lowerLabel.includes('veteran')) {
          classification = {
            canonicalKey: 'eeo_veteran',
            confidence: 0.95,
            inferredProfilePath: 'identity.eeo.veteranStatus',
            rationale: 'Greenhouse EEO container veteran field',
          };
        } else if (lowerLabel.includes('disability')) {
          classification = {
            canonicalKey: 'eeo_disability',
            confidence: 0.95,
            inferredProfilePath: 'identity.eeo.disabilityStatus',
            rationale: 'Greenhouse EEO container disability field',
          };
        }
      }

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
      id: root.id || `greenhouse_form_${Date.now()}`,
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
