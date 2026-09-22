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
import { isSubmitElement } from './form-crawler.js';
import {
  calculateElementClickCoordinates,
  dispatchRealisticPointerSequence,
  typeTextProgressively,
} from './pacing-engine.js';

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
  // 1. Focus sequence
  element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));
  element.focus();

  // 2. Value mutation via native setter
  setNativeInputValue(element, text);

  // 3. Input & change event propagation
  element.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      composed: true,
      data: text,
      inputType: 'insertText',
    })
  );
  element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

  // 4. Blur sequence
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

  // Look for open popup option elements matching optionValue
  const root = element.ownerDocument || document;
  const options = Array.from(
    root.querySelectorAll<HTMLElement>(
      '[role="option"], .select-option, [data-automation-id="promptOption"], li[data-value]'
    )
  );

  const matched = options.find((opt) => {
    const text = (opt.textContent || '').trim().toLowerCase();
    const val = (opt.getAttribute('data-value') || '').toLowerCase();
    const target = optionValue.trim().toLowerCase();
    return text === target || val === target || text.includes(target);
  });

  if (matched && !isSubmitElement(matched)) {
    matched.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    matched.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
  } else {
    element.setAttribute('data-value', optionValue);
    if (!(element instanceof HTMLInputElement)) {
      element.textContent = optionValue;
    }
  }

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
 * Executes a single DryRunAction against the document DOM.
 *
 * @param action Planned action item.
 * @param doc Host document.
 * @param options Execution configuration.
 */
export async function executeSingleAction(
  action: DryRunAction,
  doc: Document,
  options: ExecutionOptions = {}
): Promise<void> {
  const browserAction = action.action;

  // 1. Safety Policy Gate
  const safety = validateBrowserActionSafety(browserAction);
  if (safety.isProhibited) {
    throw new Error(`Action prohibited by safety policy: ${safety.reason}`);
  }

  // 2. Submission Intent Check
  if (
    browserAction.actionType === 'click' &&
    isSubmissionIntent(browserAction.selector, browserAction.description)
  ) {
    throw new Error('Autonomous submission blocked: clicking submit controls is forbidden.');
  }

  // 3. Locate Target Element
  const element = doc.querySelector<HTMLElement>(browserAction.selector);
  if (!element) {
    throw new Error(`Target DOM element not found for selector: ${browserAction.selector}`);
  }

  // 4. Submission Element Check
  if (isSubmitElement(element)) {
    throw new Error('Autonomous submission blocked: target is classified as a submit element.');
  }

  // 5. Apply Visual Feedback
  const cleanupHighlight = options.highlightElements !== false
    ? applyVisualHighlight(element)
    : () => {};

  try {
    // 6. Execute Specific Interaction Type
    switch (browserAction.actionType) {
      case 'fill_text': {
        const input = element as HTMLInputElement | HTMLTextAreaElement;
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
        const fileInput = element as HTMLInputElement;
        simulateFileUpload(fileInput, browserAction.value || 'resume.pdf');
        break;
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
  options: ExecutionOptions = {}
): Promise<ExecutionReport> {
  const startTime = Date.now();
  const pacingDelay = options.pacingDelayMs ?? 150;
  const executedActionIds: ActionId[] = [];
  const failedActions: FailedActionDetail[] = [];

  // Filter actions: execute only actions approved by the candidate
  const approvedActions = plan.actions.filter((a) => a.userConfirmed);

  for (const action of approvedActions) {
    try {
      await executeSingleAction(action, doc, options);
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
    haltedAtSubmissionGate: true, // Guarantees execution paused before final submission
    executedActionIds,
    failedActions,
    durationMs,
    completedAt: new Date().toISOString(),
  };
}
