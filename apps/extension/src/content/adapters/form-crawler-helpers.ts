/**
 * @fileoverview Form Crawler Utilities and DOM Inspection Helpers.
 *
 * Provides pure DOM inspection functions for element label extraction, unambiguous CSS selector
 * generation, requirement detection, and submit button identification (ADR-0006).
 */

import { isSubmissionIntent, type SelectOption } from '@applykit/domain';

/**
 * Strips asterisk asterisms, colons, and formatting clutter from raw label text.
 */
export function cleanLabelText(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/[*:\t\r\n]+/g, '')
    .trim();
}

/**
 * Generates an unambiguous CSS selector targeting an element within the root container.
 *
 * @param element Target DOM element.
 * @param root Container root or Document.
 * @returns Precise CSS selector string.
 */
export function generateElementSelector(element: Element, root: Element | Document): string {
  // Strategy 1: Valid unique element ID
  if (element.id && /^[\w-]+$/.test(element.id)) {
    const matching = root.querySelectorAll(`#${CSS.escape(element.id)}`);
    if (matching.length === 1) {
      return `#${CSS.escape(element.id)}`;
    }
  }

  // Strategy 2: Data test or automation attributes
  const testAttrs = ['data-testid', 'data-automation-id', 'data-qa', 'data-cy'];
  for (const attr of testAttrs) {
    const val = element.getAttribute(attr);
    if (val) {
      const sel = `[${attr}="${CSS.escape(val)}"]`;
      if (root.querySelectorAll(sel).length === 1) {
        return sel;
      }
    }
  }

  // Strategy 3: Name attribute
  const name = element.getAttribute('name');
  if (name) {
    const sel = `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
    if (root.querySelectorAll(sel).length === 1) {
      return sel;
    }
  }

  // Strategy 4: Unique semantic class names
  if (element.classList && element.classList.length > 0) {
    for (const cls of Array.from(element.classList)) {
      if (cls && !cls.startsWith('ng-') && !cls.startsWith('jsx-')) {
        const sel = `${element.tagName.toLowerCase()}.${CSS.escape(cls)}`;
        if (root.querySelectorAll(sel).length === 1) {
          return sel;
        }
      }
    }
  }

  // Strategy 5: Fallback to nth-of-type hierarchy
  const path: string[] = [];
  let curr: Element | null = element;

  while (curr && curr !== root && curr !== document.body) {
    let selector = curr.tagName.toLowerCase();
    if (curr.id && /^[\w-]+$/.test(curr.id)) {
      selector = `#${CSS.escape(curr.id)}`;
      path.unshift(selector);
      break;
    } else {
      let siblingIndex = 1;
      let sibling = curr.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === curr.tagName) {
          siblingIndex++;
        }
        sibling = sibling.previousElementSibling;
      }
      selector += `:nth-of-type(${siblingIndex})`;
    }
    path.unshift(selector);
    curr = curr.parentElement;
  }

  return path.join(' > ') || element.tagName.toLowerCase();
}

/**
 * Resolves human-visible label text for an input control.
 *
 * Precedence Hierarchy (ADR-0023):
 * 1. Explicit <label for="elementId">: highest human-intent indicator.
 * 2. Enclosing wrapping <label>.
 * 3. aria-labelledby and aria-label attributes.
 * 4. Immediate field container label (e.g. .form-group > label, .field > label).
 * 5. Preceding sibling label or heading.
 * 6. Fallback to placeholder or title attribute.
 * 7. Fieldset legend ONLY as a last resort if not an overarching section container.
 *
 * @param element Target input control.
 * @param root Container root or Document.
 * @returns Cleaned label string.
 */
export function extractElementLabel(element: HTMLElement, root: Element | Document): string {
  // 1. Explicit <label for="elementId">
  if (element.id) {
    const explicitLabel = root.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (explicitLabel && explicitLabel.textContent && explicitLabel.textContent.trim()) {
      return cleanLabelText(explicitLabel.textContent);
    }
  }

  // 2. Enclosing wrapping <label>
  const enclosingLabel = element.closest('label');
  if (enclosingLabel && enclosingLabel.textContent) {
    const clone = enclosingLabel.cloneNode(true) as HTMLElement;
    const inputs = clone.querySelectorAll('input, select, textarea, button');
    inputs.forEach((i) => i.remove());
    if (clone.textContent && clone.textContent.trim()) {
      return cleanLabelText(clone.textContent);
    }
  }

  // 3. aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const ids = labelledBy.split(/\s+/);
    const parts: string[] = [];
    for (const id of ids) {
      const ref = root.querySelector(`#${CSS.escape(id)}`);
      if (ref && ref.textContent) {
        parts.push(ref.textContent.trim());
      }
    }
    if (parts.length > 0) {
      return cleanLabelText(parts.join(' '));
    }
  }

  // 4. aria-label
  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel && ariaLabel.trim()) {
    return cleanLabelText(ariaLabel);
  }

  // 5. Immediate field container label/header (bounded to field-level containers)
  let parent = element.parentElement;
  for (let depth = 0; depth < 3 && parent && parent !== root && parent !== document.body; depth++) {
    // Avoid checking massive section containers that hold multiple fields
    const siblingInputs = parent.querySelectorAll('input:not([type="hidden"]), textarea, select');
    if (siblingInputs.length <= 2) {
      const header = parent.querySelector('label, [class*="label"], [class*="title"], [class*="header"]');
      if (header && header !== element && !header.contains(element) && header.textContent && header.textContent.trim()) {
        return cleanLabelText(header.textContent);
      }
    }
    parent = parent.parentElement;
  }

  // 6. Preceding sibling element label or legend
  const prevSibling = element.previousElementSibling;
  if (prevSibling && prevSibling.textContent && prevSibling.textContent.trim()) {
    if (['LABEL', 'LEGEND', 'H3', 'H4', 'H5', 'P', 'SPAN', 'DIV'].includes(prevSibling.tagName)) {
      return cleanLabelText(prevSibling.textContent);
    }
  }

  // 7. Placeholder / Title fallback
  const placeholder = (element as HTMLInputElement).placeholder || element.getAttribute('title');
  if (placeholder && placeholder.trim()) {
    return cleanLabelText(placeholder);
  }

  // 8. Fieldset legend fallback ONLY if fieldset wraps solely this field
  const fieldset = element.closest('fieldset');
  if (fieldset) {
    const inputs = fieldset.querySelectorAll('input:not([type="hidden"]), textarea, select');
    if (inputs.length <= 1) {
      const legend = fieldset.querySelector('legend');
      if (legend && legend.textContent && legend.textContent.trim()) {
        return cleanLabelText(legend.textContent);
      }
    }
  }

  return '';
}

/**
 * Resolves the question or prompt title for a cohesive group of radio or checkbox inputs.
 *
 * @param inputs Collection of radio or checkbox inputs in the same named group.
 * @param root Container root or Document.
 * @returns Cleaned group question title.
 */
export function extractGroupQuestionLabel(
  inputs: readonly HTMLInputElement[],
  root: Element | Document
): string {
  if (inputs.length === 0) return '';
  const first = inputs[0];
  if (!first) return '';

  // 1. Check if first input is in a dedicated fieldset where inputs share the group's name
  const fieldset = first.closest('fieldset, [role="radiogroup"], [role="group"]');
  if (fieldset) {
    const fieldsetInputs = Array.from(fieldset.querySelectorAll('input:not([type="hidden"]), textarea, select'));
    const isDedicatedGroup =
      fieldsetInputs.length <= inputs.length ||
      fieldsetInputs.every((i) => (i as HTMLInputElement).name === first.name);
    if (isDedicatedGroup) {
      const legend = fieldset.querySelector('legend, .question-title, h3, h4');
      if (legend && legend.textContent && legend.textContent.trim()) {
        return cleanLabelText(legend.textContent);
      }
    }
  }

  // 2. Find common container across group inputs
  let container: HTMLElement | null = first.parentElement;
  while (container && container !== root && container !== document.body) {
    if (inputs.every((i) => container?.contains(i))) {
      break;
    }
    container = container.parentElement;
  }

  if (container) {
    // Prefer a legend/heading INSIDE the shared container over trailing heuristics.
    // This prevents stealing the label of an unrelated preceding sibling form group.
    const innerHeading = container.querySelector(
      'legend, .question-title, h3, h4, h5, [class*="title"]:not([class*="hint"]), [class*="question-text"], [class*="field-label"]'
    );
    if (
      innerHeading &&
      innerHeading.textContent &&
      innerHeading.textContent.trim() &&
      !inputs.some((i) => innerHeading.contains(i))
    ) {
      return cleanLabelText(innerHeading.textContent);
    }

    // Check preceding sibling of container
    const prev = container.previousElementSibling;
    if (prev && ['LEGEND', 'LABEL', 'H3', 'H4', 'H5', 'DIV'].includes(prev.tagName)) {
      if (prev.textContent && prev.textContent.trim()) {
        return cleanLabelText(prev.textContent);
      }
    }

    // Check parent's preceding sibling
    const parentPrev = container.parentElement?.previousElementSibling;
    if (parentPrev && ['LEGEND', 'LABEL', 'H3', 'H4', 'H5', 'DIV'].includes(parentPrev.tagName)) {
      if (parentPrev.textContent && parentPrev.textContent.trim()) {
        return cleanLabelText(parentPrev.textContent);
      }
    }

    // Check header inside container parent
    const header = container.parentElement?.querySelector(
      'legend, .question-title, h3, h4, h5, [class*="title"], [class*="label"]'
    );
    if (
      header &&
      header.textContent &&
      header.textContent.trim() &&
      !inputs.some((i) => header.contains(i))
    ) {
      return cleanLabelText(header.textContent);
    }
  }

  // Fallback to name or individual label
  return cleanLabelText(first.getAttribute('name') || '');
}

/**
 * Checks whether an element indicates mandatory requirement status.
 *
 * @param element Target DOM element.
 * @param labelText Visual label text.
 * @returns True if required.
 */
export function isElementRequired(element: HTMLElement, labelText: string): boolean {
  if (element.hasAttribute('required')) return true;
  if (element.getAttribute('aria-required') === 'true') return true;
  if (/\b(?:required|\*)\b/i.test(labelText)) return true;
  return false;
}

/**
 * Extracts options from a native <select> element.
 *
 * @param select Target HTMLSelectElement.
 * @returns Array of SelectOption objects.
 */
export function extractNativeSelectOptions(select: HTMLSelectElement): readonly SelectOption[] {
  const options: SelectOption[] = [];
  for (let i = 0; i < select.options.length; i++) {
    const opt = select.options[i];
    if (opt) {
      options.push({
        value: opt.value,
        label: opt.text.trim() || opt.value,
      });
    }
  }
  return options;
}

/**
 * Evaluates whether an element serves as an application submission control.
 *
 * Security Invariant (ADR-0006): The extension must identify submit controls to explicitly exclude
 * them from automated execution planners.
 *
 * @param element Target interactive element.
 * @returns True if the element represents an application submission trigger.
 */
export function isSubmitElement(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  const type = (element.getAttribute('type') || '').toLowerCase();

  if (type === 'submit') {
    return true;
  }

  if (tag === 'button' || tag === 'input' || tag === 'a') {
    const text = element.textContent || (element as HTMLInputElement).value || '';
    const selector = generateElementSelector(element, element.ownerDocument);
    if (isSubmissionIntent(selector, text)) {
      return true;
    }
  }

  return false;
}
