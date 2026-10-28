/**
 * @fileoverview Reads dropdown options the service worker tagged onto the page.
 *
 * React dropdowns keep their options in component state, which the content script's
 * isolated world cannot reach. Before a scan the service worker copies them onto each
 * combobox as JSON (background/page-widgets.ts); the crawlers read them back here.
 */

import type { SelectOption } from '@applykit/domain';

/** Attribute written by `annotateReactSelectOptionsInPage`. */
export const PAGE_OPTIONS_ATTRIBUTE = 'data-applykit-options';

/**
 * Returns the tagged options for a combobox, or undefined when it was not tagged or
 * the attribute is malformed. The attribute lives in page DOM, so it is parsed
 * defensively: only string label/value pairs survive, and the list is capped.
 */
export function readTaggedOptions(element: Element): readonly SelectOption[] | undefined {
  const raw = element.getAttribute(PAGE_OPTIONS_ATTRIBUTE);
  if (!raw || raw.length > 200_000) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return undefined;
    const options: SelectOption[] = [];
    for (const item of parsed.slice(0, 400)) {
      if (!item || typeof item !== 'object') continue;
      const { value, label } = item as Record<string, unknown>;
      if (typeof label !== 'string' || label.trim() === '') continue;
      options.push({ value: typeof value === 'string' ? value : label, label: label.trim() });
    }
    return options.length > 0 ? options : undefined;
  } catch {
    return undefined;
  }
}

/**
 * True for inputs that belong to a widget's internals rather than to a question:
 * the phone-country search box, and the hidden "required" mirror react-select places
 * beside its combobox. Listing them would show the candidate unlabeled extra fields.
 */
export function isWidgetInternalInput(element: Element): boolean {
  if (!(element instanceof HTMLInputElement)) return false;
  if (element.type === 'search') return true;
  if (element.closest('.iti__dropdown-content, .iti__search-input-wrapper')) return true;
  const shell = element.closest('.select-shell, [class*="select__"]');
  if (shell && element.getAttribute('role') !== 'combobox' && !element.id && !element.name) return true;
  return false;
}

/** The page's own character limit for a text field, so drafts can be written to fit. */
export function readMaxLength(element: Element): { maxLength?: number } {
  const value = (element as HTMLInputElement | HTMLTextAreaElement).maxLength;
  return typeof value === 'number' && value > 0 && value < 1_000_000 ? { maxLength: value } : {};
}
