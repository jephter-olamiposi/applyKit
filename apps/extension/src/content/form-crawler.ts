/**
 * @fileoverview DOM Crawler and Form Field Inspector for Content Scripts.
 *
 * Traverses third-party application forms, extracts field attributes and choice options,
 * identifies submit buttons for anti-autonomous gating, and produces virtual ApplicationForm aggregates.
 */

import {
  createFieldId,
  classifyFormField,
  isHoneypotField,
  type ApplicationForm,
  type ApplicationField,
  type SelectOption,
  type FieldType,
  type AtsPlatform,
  type RawFieldAttributes,
} from '@applykit/domain';
import {
  generateElementSelector,
  extractElementLabel,
  extractGroupQuestionLabel,
  isElementRequired,
  extractNativeSelectOptions,
  isSubmitElement,
  cleanLabelText,
} from './adapters/form-crawler-helpers.js';
import {
  findMatchingFormAdapter,
  inspectPageWithAtsAdapters,
} from './adapters/form/index.js';

export {
  generateElementSelector,
  extractElementLabel,
  extractGroupQuestionLabel,
  isElementRequired,
  extractNativeSelectOptions,
  isSubmitElement,
  cleanLabelText,
};

/**
 * Detects the ATS platform architecture from page URL and DOM markers.
 */
export function detectAtsPlatform(doc: Document, url: string): AtsPlatform {
  const normUrl = url.toLowerCase();

  if (normUrl.includes('greenhouse.io') || normUrl.includes('gh_jid')) {
    return 'greenhouse';
  }
  if (normUrl.includes('jobs.lever.co') || normUrl.includes('lever.co')) {
    return 'lever';
  }
  if (normUrl.includes('myworkdayjobs.com') || normUrl.includes('workday.com')) {
    return 'workday';
  }
  if (normUrl.includes('ashbyhq.com') || normUrl.includes('ashby')) {
    return 'ashby';
  }
  if (normUrl.includes('smartrecruiters.com')) {
    return 'smartrecruiters';
  }

  // Check DOM markers if custom domain is used
  if (doc.querySelector('#grnhse_app, form#application_form, [data-greenhouse]')) {
    return 'greenhouse';
  }
  if (doc.querySelector('.lever-form, [data-qa="lever-application"], .postings-btn-wrapper')) {
    return 'lever';
  }
  if (doc.querySelector('[data-automation-id*="workday"], [data-automation-id="workdayApplication"]')) {
    return 'workday';
  }
  if (doc.querySelector('[data-ashby], #ashby-application-form, .ashby-application-form')) {
    return 'ashby';
  }
  if (doc.querySelector('[data-smartrecruiters], .smartr-form')) {
    return 'smartrecruiters';
  }

  return 'generic';
}



/**
 * Inspects a form or application container element to produce an ApplicationForm virtual aggregate.
 *
 * @param container Form or root application element.
 * @param doc Document owner.
 * @returns Virtual representation of the application form and constituent fields.
 */
export function crawlFormContainer(
  container: HTMLElement,
  doc: Document
): ApplicationForm {
  const atsPlatform = detectAtsPlatform(doc, doc.location ? doc.location.href : '');
  const fields: ApplicationField[] = [];
  let submitButtonSelector: string | undefined;

  // Find submit button
  const buttons = container.querySelectorAll<HTMLElement>('button, input[type="submit"], a.btn-submit, [role="button"]');
  for (const btn of Array.from(buttons)) {
    if (isSubmitElement(btn)) {
      submitButtonSelector = generateElementSelector(btn, container);
      break;
    }
  }

  // 1. Process Radio Button Groups
  const radioInputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
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

    const label = extractGroupQuestionLabel(radios, container) || extractElementLabel(firstRadio, container);
    const required = radios.some((r) => isElementRequired(r, label));
    const selector = `input[type="radio"][name="${CSS.escape(name)}"]`;

    const options: SelectOption[] = radios.map((r) => {
      const optLabel = extractElementLabel(r, container) || r.value;
      return {
        value: r.value,
        label: optLabel,
      };
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

  // 2. Process Standard Inputs, Textareas, Selects, and File Uploaders
  const interactiveElements = container.querySelectorAll<HTMLElement>(
    'input:not([type="radio"]):not([type="submit"]):not([type="button"]):not([type="image"]), textarea, select, [role="combobox"]'
  );

  for (const el of Array.from(interactiveElements)) {
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const name = el.getAttribute('name') || undefined;
    const id = el.id || undefined;
    const label = extractElementLabel(el, container);
    const placeholder = (el as HTMLInputElement).placeholder || undefined;
    const autocomplete = el.getAttribute('autocomplete') || undefined;
    const ariaLabel = el.getAttribute('aria-label') || undefined;
    const required = isElementRequired(el, label);
    const selector = generateElementSelector(el, container);

    // Determine field type
    let fieldType: FieldType = 'text';
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
    } else if (type === 'hidden') {
      fieldType = 'hidden';
    }

    // Skip purely hidden inputs unless suspected of being honeypots
    const rawAttrs: RawFieldAttributes = {
      tag,
      type,
      name,
      id,
      label,
      placeholder,
      autocomplete,
      ariaLabel,
    };

    const isSuspectHoneypot = isHoneypotField(rawAttrs);
    if (fieldType === 'hidden' && !isSuspectHoneypot) {
      continue;
    }

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
      isHoneypotSuspect: isSuspectHoneypot,
    });
  }

  const formAction = container instanceof HTMLFormElement ? container.action : undefined;
  const formMethod = container instanceof HTMLFormElement ? container.method : undefined;

  if (!doc.location) {
    throw new Error('Cannot crawl application form without a document location.');
  }
  const parsedUrl = new URL(doc.location.href);
  const adapter = findMatchingFormAdapter(parsedUrl, doc);
  const authBarrier = adapter.detectAuthBarrier ? adapter.detectAuthBarrier(doc) : null;
  const wizardState = adapter.detectWizardState ? adapter.detectWizardState(doc) : null;
  const validationErrors = adapter.detectValidationErrors ? adapter.detectValidationErrors(doc) : [];

  return {
    id: container.id || `form_${Date.now()}`,
    url: doc.location ? doc.location.href : '',
    detectedAts: atsPlatform,
    formAction,
    formMethod,
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

/**
 * Crawls the entire document to discover all application forms and field groups.
 *
 * Traverses standard <form> tags, shadow roots, and standalone application wrappers.
 *
 * @param doc Webpage document object.
 * @returns Discovered virtual ApplicationForms.
 */
export function inspectPageForms(doc: Document): readonly ApplicationForm[] {
  // First, execute specialized ATS form adapter inspection
  const adapterForms = inspectPageWithAtsAdapters(doc);
  if (adapterForms.length > 0) {
    return adapterForms;
  }

  const forms: ApplicationForm[] = [];

  // 1. Explicit <form> elements
  const formElements = Array.from(doc.querySelectorAll<HTMLFormElement>('form'));
  if (formElements.length > 0) {
    for (const formEl of formElements) {
      // Ignore tiny non-application forms (e.g. search bars, language switchers)
      const inputs = formEl.querySelectorAll('input, select, textarea');
      if (inputs.length >= 2) {
        forms.push(crawlFormContainer(formEl, doc));
      }
    }
  }

  // 2. Standalone application containers (Single Page App frameworks without <form> wrappers)
  if (forms.length === 0) {
    const appContainer = doc.querySelector<HTMLElement>(
      '#application, [data-qa="job-application"], .application-form, main, [role="main"]'
    );
    if (appContainer) {
      const inputs = appContainer.querySelectorAll('input, select, textarea');
      if (inputs.length >= 2) {
        forms.push(crawlFormContainer(appContainer, doc));
      }
    }
  }

  // 3. Fallback to doc.body if elements exist
  if (forms.length === 0) {
    const bodyInputs = doc.body.querySelectorAll('input, select, textarea');
    if (bodyInputs.length >= 2) {
      forms.push(crawlFormContainer(doc.body, doc));
    }
  }

  return forms;
}
