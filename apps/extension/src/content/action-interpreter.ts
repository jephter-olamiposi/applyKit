/**
 * @fileoverview Browser Action Content Script Interpreter & Event Simulator.
 *
 * Safely executes declarative BrowserActions on the active webpage DOM (ADR-0003):
 * 1. Native Property Setter Bypasses for React 16+, Vue, and Angular internal value tracking.
 * 2. Complete synthetic event lifecycles (pointerdown, focus, input, change, blur).
 * 3. Human-paced execution delay (ADR-0014 pacing engine) and visual focus highlighting.
 * 4. Anti-Autonomous Submission Hard Gate: zero automated clicks on submit controls (ADR-0006).
 */

import {
  isSubmissionIntent,
  validateBrowserActionSafety,
  type DryRunPlan,
  type DryRunAction,
  type ExecutionOptions,
  type ExecutionReport,
  type ActionId,
  type FailedActionDetail,
} from '@applykit/domain';
import { isSubmitElement, hasSubmissionControl } from './form-crawler.js';
import {
  calculateElementClickCoordinates,
  dispatchRealisticPointerSequence,
  typeTextProgressively,
} from './pacing-engine.js';

import { PAGE_OPTIONS_ATTRIBUTE } from './page-widget-options.js';
/**
 * Sleeps for a designated millisecond interval to ensure reactive framework state updates
 * and mimic natural human pacing.
 */
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Bypasses React 15/16+ and Vue synthetic property setter interception by invoking the
 * native HTMLInputElement / HTMLTextAreaElement prototype descriptor setter.
 *
 * In modern component frameworks, direct assignment `el.value = val` is intercepted by
 * an internal value tracker. Without invoking the prototype setter, dispatching an 'input'
 * event causes React to consider the value unchanged and discard the input upon blur.
 *
 * @param element Textual HTML input or textarea.
 * @param value New text value to assign.
 */
export function setNativeInputValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string
): void {
  const proto =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;

  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (descriptor && descriptor.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

/**
 * Bypasses component framework setters for checkbox and radio input elements.
 *
 * @param element Target input element.
 * @param checked Target boolean checked state.
 */
export function setNativeCheckboxChecked(
  element: HTMLInputElement,
  checked: boolean
): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'checked'
  );

  if (descriptor && descriptor.set) {
    descriptor.set.call(element, checked);
  } else {
    element.checked = checked;
  }
}

/**
 * Simulates a realistic human keystroke/text entry interaction on an input element.
 *
 * Dispatches full synthetic event chain:
 * pointerdown -> focus -> focusin -> native setter -> input -> change -> blur -> focusout.
 *
 * @param element Textual HTML input or textarea.
 * @param text Content to insert.
 */
export function simulateTextInput(
  element: HTMLInputElement | HTMLTextAreaElement,
  text: string
): void {
  element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
  element.focus();

  // Clear existing pre-filled values (e.g. intl-tel-input geo-IP country codes like '+855') to prevent value corruption
  if (element.value && element.value !== text) {
    setNativeInputValue(element, '');
    element.dispatchEvent(
      new InputEvent('input', { bubbles: true, composed: true, data: '', inputType: 'deleteContentBackward' })
    );
  }

  setNativeInputValue(element, text);

  element.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: text,
      inputType: 'insertText',
    })
  );
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

  element.blur();
}

/**
 * Simulates option selection on a native HTMLSelectElement.
 *
 * @param selectElement Target select dropdown.
 * @param optionValue Desired option value.
 */
export function simulateSelectOption(
  selectElement: HTMLSelectElement,
  optionValue: string
): void {
  selectElement.focus();

  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    'value'
  );
  if (descriptor && descriptor.set) {
    descriptor.set.call(selectElement, optionValue);
  } else {
    selectElement.value = optionValue;
  }

  // Synchronize matching <option selected>
  for (const option of Array.from(selectElement.options)) {
    option.selected = option.value === optionValue;
  }

  selectElement.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  selectElement.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  selectElement.blur();
}

/**
 * Simulates option selection on a custom ARIA combobox, listbox, or button dropdown.
 *
 * Used for modern ATS component frameworks (Ashby React comboboxes, Workday prompt popups).
 *
 * @param element Target combobox input, button, or container.
 * @param optionValue Desired option value or label.
 */
export function simulateCustomComboboxSelect(
  element: HTMLElement,
  optionValue: string
): void {
  element.focus();

  if (element instanceof HTMLInputElement) {
    // Simulate typing the search query into the combobox input
    simulateTextInput(element, optionValue);
  } else {
    // Trigger popup click
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  }

  // Only look inside this dropdown's own list. Pages often keep other option lists in
  // the DOM permanently (Greenhouse keeps ~240 hidden phone-country options), so a
  // page-wide [role="option"] search picks an answer from the wrong question.
  const root = element.ownerDocument || document;
  const OPTION_SELECTOR = '[role="option"], .select-option, [data-automation-id="promptOption"], li[data-value]';
  const findScope = (): ParentNode | null => {
    const listboxId = element.getAttribute('aria-controls') || element.getAttribute('aria-owns');
    const listbox = listboxId ? root.getElementById(listboxId) : null;
    if (listbox) return listbox;
    // Walk up to the edge of this question and no further.
    let node = element.parentElement;
    for (let depth = 0; node && depth < 8; depth += 1) {
      if (node.querySelector(OPTION_SELECTOR)) return node;
      if (node.matches('.field-wrapper, fieldset, form, [role="group"], body')) break;
      node = node.parentElement;
    }
    // Workday renders its prompt options in a page-level popup that belongs to
    // whichever prompt was opened last; nothing else is trusted page-wide.
    return root.querySelector('[data-automation-id="promptOption"]') ? root : null;
  };
  const scope = findScope();
  const options = scope
    ? Array.from(scope.querySelectorAll<HTMLElement>(scope === root ? '[data-automation-id="promptOption"]' : OPTION_SELECTOR))
    : [];

  const target = optionValue.trim().toLowerCase();
  const matched =
    options.find((opt) => (opt.textContent || '').trim().toLowerCase() === target || (opt.getAttribute('data-value') || '').toLowerCase() === target) ??
    options.find((opt) => (opt.textContent || '').trim().toLowerCase().includes(target));

  if (!matched || isSubmitElement(matched)) {
    // Undo the search text so the box is left as the candidate found it.
    if (element instanceof HTMLInputElement) {
      setNativeInputValue(element, '');
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: '', inputType: 'deleteContentBackward' }));
    }
    element.blur();
    // Typing the answer into the box would look filled but submit nothing.
    throw new Error(`Could not pick "${optionValue}" in this dropdown. Choose it yourself.`);
  }

  matched.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
  matched.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));

  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  element.blur();
}

/**
 * Simulates a mouse click interaction on a DOM element.
 *
 * Security Invariant (ADR-0006): Programmatically refuses to click any element classified
 * as a submit button or exhibiting submission semantics.
 *
 * @param element Target DOM element.
 */
export function simulateClick(element: HTMLElement, options?: ExecutionOptions): void {
  if (isSubmitElement(element)) {
    throw new Error('Autonomous submission blocked: clicking submit controls is forbidden.');
  }

  const coords = calculateElementClickCoordinates(element, options?.addCoordinateJitter !== false);
  dispatchRealisticPointerSequence(element, coords);
}

/**
 * Simulates toggling a checkbox input.
 *
 * @param checkbox Target checkbox element.
 * @param checked Desired checked state.
 */
export function simulateCheckbox(
  checkbox: HTMLInputElement,
  checked: boolean
): void {
  checkbox.focus();
  if (checkbox.checked !== checked) {
    checkbox.click();
  }
  setNativeCheckboxChecked(checkbox, checked);
  checkbox.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  checkbox.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  checkbox.blur();
}

/**
 * Simulates attaching a file to an HTML input[type="file"] via DataTransfer.
 *
 * @param fileInput Target file input element.
 * @param fileName Name of the candidate document to attach.
 */
export function simulateFileUpload(
  fileInput: HTMLInputElement,
  fileName: string
): void {
  fileInput.focus();

  // Construct synthetic File representation
  const file = new File(['[Verified Candidate Document Attachment]'], fileName, {
    type: 'application/pdf',
    lastModified: Date.now(),
  });

  if (typeof DataTransfer !== 'undefined') {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    fileInput.files = dataTransfer.files;
  }

  fileInput.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  fileInput.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  fileInput.blur();
}

/**
 * Temporarily highlights a target DOM element with a subtle green outline to provide
 * transparent visual cues during automated form filling.
 *
 * @param element Element being modified.
 * @returns Cleanup function that removes the outline.
 */
function applyVisualHighlight(element: HTMLElement): () => void {
  const previousOutline = element.style.outline;
  const previousOffset = element.style.outlineOffset;
  const previousTransition = element.style.transition;

  element.style.outline = '2px solid #10b981';
  element.style.outlineOffset = '2px';
  element.style.transition = 'outline 0.2s ease-in-out';

  if (typeof element.scrollIntoView === 'function') {
    try {
      element.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch {
      // Ignore scroll failures in test or iframe boundaries
    }
  }

  return () => {
    element.style.outline = previousOutline;
    element.style.outlineOffset = previousOffset;
    element.style.transition = previousTransition;
  };
}

/**
 * Page-world operations the content script cannot do itself. The content entry point
 * wires these to the service worker; tests pass fakes or leave them out.
 */
export interface PageHooks {
  /** Picks an option on a React dropdown (see background/page-widgets). */
  readonly pickPageOption?: (selector: string, wanted: string) => Promise<{ ok: boolean; chosenLabel?: string; reason?: string }>;
}

/**
 * Executes a single DryRunAction against the document DOM.
 *
 * @param action Planned action item.
 * @param doc Host document.
 * @param options Execution configuration.
 */
export async function executeSingleAction(
  action: DryRunAction,
  doc: Document,
  options: ExecutionOptions = {},
  hooks: PageHooks = {}
): Promise<void> {
  const browserAction = action.action;

  // Submission Hard Gate: verify action against safety policies and block automated form submission.
  const safety = validateBrowserActionSafety(browserAction);
  if (safety.isProhibited) {
    throw new Error(`Action prohibited by safety policy: ${safety.reason}`);
  }

  if (
    browserAction.actionType === 'click' &&
    isSubmissionIntent(browserAction.selector, browserAction.description)
  ) {
    throw new Error('Autonomous submission blocked: clicking submit controls is forbidden.');
  }

  const element = doc.querySelector<HTMLElement>(browserAction.selector);
  if (!element) {
    throw new Error(`Target DOM element not found for selector: ${browserAction.selector}`);
  }

  if (isSubmitElement(element)) {
    throw new Error('Autonomous submission blocked: target is classified as a submit element.');
  }

  const cleanupHighlight = options.highlightElements !== false
    ? applyVisualHighlight(element)
    : () => {};

  try {
    switch (browserAction.actionType) {
      case 'fill_text': {
        const input = element as HTMLInputElement | HTMLTextAreaElement;
        // Non-Overwrite Invariant (SKILL.md Line 159 & Line 232):
        // If a field already holds non-empty text typed by the candidate, never overwrite it.
        if (
          options.preserveExistingValues !== false &&
          typeof input.value === 'string' &&
          input.value.trim().length > 0
        ) {
          break;
        }

        if (options.pacingMode === 'natural' && options.simulateKeystrokes !== false) {
          await typeTextProgressively(input, browserAction.value || '', options);
        } else {
          simulateTextInput(input, browserAction.value || '');
        }
        break;
      }

      case 'select_option': {
        if (element instanceof HTMLSelectElement) {
          simulateSelectOption(element, browserAction.value || '');
        } else if (element.hasAttribute(PAGE_OPTIONS_ATTRIBUTE)) {
          if (!hooks.pickPageOption) {
            throw new Error('This dropdown can only be set from the page. Choose it yourself.');
          }
          const picked = await hooks.pickPageOption(browserAction.selector, browserAction.value || '');
          if (!picked.ok) {
            throw new Error(`Could not pick "${browserAction.value ?? ''}" in this dropdown (${picked.reason ?? 'unknown'}). Choose it yourself.`);
          }
        } else {
          simulateCustomComboboxSelect(element, browserAction.value || '');
        }
        break;
      }

      case 'click': {
        simulateClick(element, options);
        break;
      }

      case 'check':
      case 'uncheck': {
        const checkbox = element as HTMLInputElement;
        simulateCheckbox(checkbox, browserAction.actionType === 'check');
        break;
      }

      case 'upload_file': {
        throw new Error('Document upload is manual only. Download the approved DOCX and attach it yourself.');
      }

      case 'scroll_into_view': {
        if (typeof element.scrollIntoView === 'function') {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        break;
      }

      case 'wait_for_selector': {
        // Element already discovered via querySelector
        break;
      }

      default:
        throw new Error(`Unsupported browser action type: ${(browserAction as any).actionType}`);
    }
  } finally {
    // Retain outline briefly so user sees the change, then clean up
    const delay = options.pacingDelayMs ?? 150;
    setTimeout(cleanupHighlight, Math.max(delay, 200));
  }
}

/**
 * Safely executes an entire candidate-approved DryRunPlan on the host webpage.
 *
 * Invariants Enforced:
 * 1. Only user-confirmed actions are executed.
 * 2. Clicks on submission controls trigger immediate hard abort.
 * 3. Pacing delays between actions mimic human interactions and prevent bot bans.
 * 4. Halts execution cleanly at the submission boundary (ADR-0006).
 *
 * @param plan Verified DryRunPlan.
 * @param doc Webpage Document context.
 * @param options Execution pacing and feedback options.
 * @returns Immutable audit report of executed actions.
 */
export async function executeBrowserPlan(
  plan: DryRunPlan,
  doc: Document,
  options: ExecutionOptions = {},
  hooks: PageHooks = {}
): Promise<ExecutionReport> {
  const startTime = Date.now();
  const pacingDelay = options.pacingDelayMs ?? 150;
  const executedActionIds: ActionId[] = [];
  const failedActions: FailedActionDetail[] = [];

  // Filter actions: execute only actions approved by the candidate
  const approvedActions = plan.actions.filter((a) => a.userConfirmed);

  for (const action of approvedActions) {
    try {
      await executeSingleAction(action, doc, options, hooks);
      executedActionIds.push(action.id);

      // Inject human-paced microtask delay between consecutive fills
      if (pacingDelay > 0) {
        await sleep(pacingDelay);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      failedActions.push({
        actionId: action.id,
        selector: action.action.selector,
        error: errorMsg,
      });
    }
  }

  const durationMs = Date.now() - startTime;

  return {
    planId: plan.id,
    totalPlanned: approvedActions.length,
    executedCount: executedActionIds.length,
    failedCount: failedActions.length,
    haltedAtSubmissionGate: hasSubmissionControl(doc),
    executedActionIds,
    failedActions,
    durationMs,
    completedAt: new Date().toISOString(),
  };
}

/**
 * Inserts text directly into the currently focused or active element on the webpage.
 *
 * Dispatches the full synthetic event sequence (input, change) and bypasses
 * React/Vue internal prototype setter interception.
 *
 * @param text The text content to insert.
 * @param doc Document containing activeElement.
 * @returns True if an editable element was focused and updated; false otherwise.
 */
export function insertTextIntoActiveElement(text: string, doc: Document = document): boolean {
  const el = doc.activeElement as HTMLElement | null;
  if (!el || el === doc.body) {
    return false;
  }

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    simulateTextInput(el, text);
    return true;
  }

  if (el.getAttribute('contenteditable') === 'true' || el.getAttribute('role') === 'textbox') {
    el.focus();
    el.textContent = text;
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return true;
  }

  return false;
}
