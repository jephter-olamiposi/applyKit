/**
 * @fileoverview Recruitee ATS Form Adapter.
 *
 * Dedicated form crawler for Recruitee application forms (#offer-application-form).
 * Accurately parses candidate name, email, resume/cover letter file inputs, radio choice
 * questions (e.g. skill self-assessments), and custom text/number open questions.
 *
 * Invariants:
 * - Anti-Autonomous Submit Hard Gate (ADR-0006): Identifies the 'Send' submit button
 *   and strictly prevents automated clicking.
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
  type FieldType,
} from '@applykit/domain';
import type { AtsFormAdapter } from './form-adapter.js';
import {
  generateElementSelector,
  extractElementLabel,
  extractGroupQuestionLabel,
  isElementRequired,
  isSubmitElement,
  cleanLabelText,
} from '../form-crawler-helpers.js';

/**
 * Recruitee ATS Form Adapter.
 */
export class RecruiteeFormAdapter implements AtsFormAdapter {
  readonly id = 'recruitee' as const;
  readonly name = 'Recruitee Application Form';
  readonly priority = 25;

  matches(url: URL, doc: Document): boolean {
    const host = url.hostname.toLowerCase();
    if (host.includes('recruitee.com')) {
      return true;
    }
    return Boolean(
      doc.querySelector('#offer-application-form, form[action*="recruitee"], [data-recruitee-form]')
    );
  }

  detectAuthBarrier(_doc: Document): AuthBarrierInfo | null {
    return null;
  }

  detectWizardState(_doc: Document): StepProgressionInfo | null {
    return null;
  }

  detectValidationErrors(doc: Document): readonly AtsValidationMessage[] {
    const errors: AtsValidationMessage[] = [];
    const errorEls = doc.querySelectorAll('.field-error, [class*="error-message"], .has-error');
    for (const el of Array.from(errorEls)) {
      const text = el.textContent?.trim();
      if (text) {
        errors.push({
          fieldSelector: generateElementSelector(el as HTMLElement, doc),
          message: text,
        });
      }
    }
    return errors;
  }

  crawlForm(doc: Document): ApplicationForm | null {
    const formEl =
      (doc.querySelector('#offer-application-form') as HTMLElement) ||
      (doc.querySelector('form[action*="recruitee"]') as HTMLElement) ||
      (doc.querySelector('form') as HTMLElement);

    if (!formEl) {
      return null;
    }

    const fields: ApplicationField[] = [];
    let submitButtonSelector: string | undefined;

    // 1. Locate Application Submission Control ('Send' button)
    const submitBtn =
      formEl.querySelector('button[type="submit"]') ||
      formEl.querySelector('input[type="submit"]') ||
      Array.from(formEl.querySelectorAll('button')).find((b) =>
        isSubmitElement(b as HTMLElement) || /send/i.test(b.textContent || '')
      );

    if (submitBtn) {
      submitButtonSelector = generateElementSelector(submitBtn as HTMLElement, formEl);
    }

    // 2. Process Radio Groups First
    const radioInputs = Array.from(formEl.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    const processedRadioNames = new Set<string>();

    for (const radio of radioInputs) {
      const groupName = radio.getAttribute('name') || '';
      if (!groupName || processedRadioNames.has(groupName)) {
        continue;
      }
      processedRadioNames.add(groupName);

      const groupList = radioInputs.filter((r) => r.getAttribute('name') === groupName);
      const firstRadio = groupList[0];
      if (!firstRadio) continue;

      let groupQuestionLabel = extractGroupQuestionLabel(groupList, formEl);

      // On Recruitee, radio questions typically have a preceding <legend>
      if (!groupQuestionLabel || groupQuestionLabel === groupName) {
        let parentContainer = firstRadio.parentElement;
        while (parentContainer && parentContainer !== formEl) {
          if (groupList.every((r) => parentContainer?.contains(r))) {
            const legend = parentContainer.previousElementSibling;
            if (legend && legend.textContent) {
              groupQuestionLabel = cleanLabelText(legend.textContent);
            }
            break;
          }
          parentContainer = parentContainer.parentElement;
        }
      }

      const required = isElementRequired(firstRadio, groupQuestionLabel);
      const selector = `input[type="radio"][name="${CSS.escape(groupName)}"]`;

      const options: SelectOption[] = groupList.map((r) => {
        let optLabel = r.value;
        const parentDiv = r.parentElement;
        if (parentDiv && parentDiv.textContent && parentDiv.textContent.trim()) {
          optLabel = cleanLabelText(parentDiv.textContent);
        } else {
          optLabel = extractElementLabel(r, formEl) || r.value;
        }
        return {
          value: r.value,
          label: optLabel,
        };
      });

      const rawAttrs: RawFieldAttributes = {
        tag: 'input',
        type: 'radio',
        name: groupName,
        id: firstRadio.id,
        label: groupQuestionLabel,
      };

      const classification = classifyFormField(rawAttrs);

      fields.push({
        id: createFieldId(),
        selector,
        fieldType: 'radio',
        label: groupQuestionLabel || groupName,
        name: groupName,
        isRequired: required,
        options,
        confidenceScore: classification.confidence,
        inferredMappingKey: classification.inferredProfilePath,
      });
    }

    // 3. Process Interactive Text, Number, Textarea, and File Inputs
    const interactiveEls = formEl.querySelectorAll<HTMLElement>(
      'input:not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="hidden"]), textarea, select'
    );

    for (const el of Array.from(interactiveEls)) {
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const name = el.getAttribute('name') || undefined;
      const id = el.id || undefined;
      let label = extractElementLabel(el, formEl);

      // Recruitee-specific container label fallback for open questions
      if (!label && el.parentElement) {
        const container = el.closest('[class*="sc-"], .field, .form-group') || el.parentElement;
        const header = container.querySelector('label, h3, h4, h5, p, span');
        if (header && header !== el && !header.contains(el) && header.textContent) {
          label = cleanLabelText(header.textContent);
        }
      }

      const placeholder =
        (el as HTMLInputElement).placeholder || el.getAttribute('data-placeholder') || undefined;
      const required = isElementRequired(el, label);
      const selector = generateElementSelector(el, formEl);

      let fieldType: FieldType = 'text';
      if (tag === 'textarea') {
        fieldType = 'textarea';
      } else if (type === 'file') {
        fieldType = 'file_upload';
      } else if (type === 'email') {
        fieldType = 'email';
      } else if (type === 'tel') {
        fieldType = 'tel';
      } else if (type === 'number') {
        fieldType = 'number';
      } else if (type === 'checkbox') {
        fieldType = 'checkbox';
      }

      const rawAttrs: RawFieldAttributes = {
        tag,
        type,
        name,
        id,
        label,
        placeholder,
      };

      if (isHoneypotField(rawAttrs)) {
        fields.push({
          id: createFieldId(),
          selector,
          fieldType,
          label: label || name || 'Security Field',
          name,
          isRequired: false,
          isHoneypotSuspect: true,
          confidenceScore: 0.99,
        });
        continue;
      }

      const classification = classifyFormField(rawAttrs);

      fields.push({
        id: createFieldId(),
        selector,
        fieldType,
        label: label || name || 'Input Field',
        name,
        placeholder,
        isRequired: required,
        currentValue: (el as HTMLInputElement).value || undefined,
        confidenceScore: classification.confidence,
        inferredMappingKey: classification.inferredProfilePath,
      });
    }

    return {
      id: formEl.id || `recruitee_form_${Date.now()}`,
      url: doc.location ? doc.location.href : '',
      detectedAts: 'recruitee',
      fields,
      submitButtonSelector,
      isMultiStep: false,
      inspectedAt: new Date().toISOString(),
    };
  }
}
