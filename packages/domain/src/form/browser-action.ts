/**
 * Finite, declarative set of browser operations permitted by the content script interpreter.
 *
 * Invariant: The AI planner is programmatically forbidden from generating arbitrary executable JavaScript.
 * All DOM mutations are executed exclusively via this typed command vocabulary.
 */
export type BrowserActionType =
  | 'click'
  | 'fill_text'
  | 'select_option'
  | 'check'
  | 'uncheck'
  | 'upload_file'
  | 'scroll_into_view'
  | 'wait_for_selector';

/**
 * Declarative specification of a single DOM mutation or query action.
 */
export interface BrowserAction {
  readonly actionType: BrowserActionType;
  /** CSS selector targeting the DOM element. */
  readonly selector: string;
  /** Value to insert, option value to select, or file path to attach. */
  readonly value?: string;
  /** Human-readable rationale presented to the user during dry-run review. */
  readonly description: string;
  /** Timeout in milliseconds before failing if element is missing or disabled. */
  readonly timeoutMs?: number;
  /** Whether this action alters sensitive fields or requires explicit user confirmation. */
  readonly requiresUserConfirmation: boolean;
}

/**
 * Patterns that identify application submission intent.
 *
 * Security Invariant: The extension is programmatically prohibited from automatically clicking
 * submission controls. The user must always visually inspect the form and perform the final submit manually.
 */
const SUBMIT_PATTERNS = [
  /submit/i,
  /apply\s*now/i,
  /send\s*application/i,
  /finish\s*application/i,
  /complete\s*application/i,
  /button\[type=["']?submit["']?\]/i,
  /input\[type=["']?submit["']?\]/i,
];

/**
 * Evaluates whether a target selector or description matches application submission intent.
 */
export function isSubmissionIntent(selector: string, description?: string): boolean {
  for (const pattern of SUBMIT_PATTERNS) {
    if (pattern.test(selector) || (description && pattern.test(description))) {
      return true;
    }
  }
  return false;
}

/**
 * Result returned by the safety validator for a candidate browser action.
 */
export interface ActionSafetyCheck {
  readonly isProhibited: boolean;
  readonly reason?: string;
}

/**
 * Validates a declarative browser action against security policies and anti-submission hard gates.
 *
 * Checks enforced:
 * 1. Anti-Autonomous Submit Gate: Clicks on submit buttons are blocked.
 * 2. Pseudo-Protocol Prevention: Rejects values starting with `javascript:`.
 * 3. Selector Injection Prevention: Rejects selectors containing `<script`, `eval(`, or `alert(`.
 */
export function validateBrowserActionSafety(action: BrowserAction): ActionSafetyCheck {
  if (action.actionType === 'click' && isSubmissionIntent(action.selector, action.description)) {
    return {
      isProhibited: true,
      reason: 'Automated submission is strictly prohibited. The candidate must submit manually.',
    };
  }

  if (action.value && action.value.toLowerCase().startsWith('javascript:')) {
    return {
      isProhibited: true,
      reason: 'Execution of javascript: pseudo-protocol is strictly prohibited.',
    };
  }

  if (/<script|eval\(|alert\(/i.test(action.selector)) {
    return {
      isProhibited: true,
      reason: 'Selector contains disallowed script execution tokens.',
    };
  }

  return {
    isProhibited: false,
  };
}
