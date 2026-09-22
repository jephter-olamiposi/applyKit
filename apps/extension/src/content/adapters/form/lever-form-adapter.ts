/**
 * @fileoverview Lever ATS Form Adapter.
 *
 * Provides specialized form extraction, dynamic custom questionnaire section parsing,
 * explicit candidate portfolio/social links mapping, and consent checkbox detection for Lever forms.
 *
 * Invariants:
 * - Anti-Autonomous Submit Hard Gate (ADR-0006): Identifies #btn-submit and blocks automated clicks.
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
 * Lever ATS Form Adapter.
 */
export class LeverFormAdapter implements AtsFormAdapter {
  readonly id = 'lever' as const;
  readonly name = 'Lever Application Form';
  readonly priority = 30;

  matches(url: URL, doc: Document): boolean {
    const host = url.hostname.toLowerCase();
    if (host.includes('jobs.lever.co') || host.includes('lever.co')) {
      return true;
    }

    return Boolean(
      doc.querySelector('.lever-form, form#application-form, [data-qa="lever-application"], .application-page')
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
    const errorContainers = Array.from(
      doc.querySelectorAll<HTMLElement>('.application-error, .error-message, .invalid')
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
      doc.querySelector<HTMLElement>('.lever-form, form#application-form, [data-qa="lever-application"]') ||
      doc.body;

    const fields: ApplicationField[] = [];
    const validationErrors = this.detectValidationErrors(doc);

    // Identify submit button
    let submitButtonSelector: string | undefined;
    const submitBtn = root.querySelector<HTMLElement>(
      'button#btn-submit, button.postings-btn-submit, [data-qa="btn-submit"], input[type="submit"]'
    );
    if (submitBtn && isSubmitElement(submitBtn)) {
      submitButtonSelector = generateElementSelector(submitBtn, root);
    }

    // 1. Process Radio Button Groups (e.g. EEO or yes/no custom questions)
    const radioInputs = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    const radioGroups = new Map<string, HTMLInputElement[]>();
    for (const radio of radioInputs) {
      const name = radio.name || 'unnamed_lever_radio';
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

    // 2. Standard Inputs, Textareas, Selects, File Uploaders
    const interactiveElements = root.querySelectorAll<HTMLElement>(
      'input:not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="image"]), textarea, select'
    );

    for (const el of Array.from(interactiveElements)) {
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const name = el.getAttribute('name') || undefined;
      const id = el.id || undefined;
      let label = extractElementLabel(el, root);
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

      // Check if inside a Lever question section
      const questionSection = el.closest('.application-question, .application-additional');
      if (questionSection && !label) {
        const qTitle = questionSection.querySelector('.text, .application-label, h4');
        if (qTitle?.textContent?.trim()) {
          label = qTitle.textContent.trim();
        }
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

      let classification = classifyFormField(rawAttrs);

      // Lever specific URL mappings (urls[LinkedIn], urls[GitHub], urls[Portfolio])
      if (name && name.startsWith('urls[')) {
        const linkType = name.slice(5, -1).toLowerCase();
        if (linkType === 'linkedin') {
          classification = {
            canonicalKey: 'linkedin_url',
            confidence: 0.98,
            inferredProfilePath: 'links.linkedin',
            rationale: 'Lever explicit LinkedIn input name',
          };
        } else if (linkType === 'github') {
          classification = {
            canonicalKey: 'github_url',
            confidence: 0.98,
            inferredProfilePath: 'links.github',
            rationale: 'Lever explicit GitHub input name',
          };
        } else if (linkType === 'portfolio' || linkType === 'other') {
          classification = {
            canonicalKey: 'portfolio_url',
            confidence: 0.98,
            inferredProfilePath: 'links.portfolio',
            rationale: 'Lever explicit portfolio input name',
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
      id: root.id || `lever_form_${Date.now()}`,
      url: doc.location ? doc.location.href : '',
      detectedAts: this.id,
      fields,
      submitButtonSelector,
      isMultiStep: false,
      validationErrors: validationErrors.length > 0 ? validationErrors : undefined,
      inspectedAt: new Date().toISOString(),
    };
  }
}
