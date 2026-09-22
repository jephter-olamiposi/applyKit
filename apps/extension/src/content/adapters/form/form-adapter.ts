/**
 * @fileoverview ATS Form Adapter Contract and Inspection Protocol.
 *
 * Defines the vendor-specific form adapter interface for deep integration with
 * complex applicant tracking systems (Workday, Greenhouse, Lever, Ashby, and Generic).
 *
 * Adheres to:
 * - Anti-Autonomous Submit Gate (ADR-0006): Adapters must distinguish multi-step wizard
 *   navigation ("Save & Continue") from irreversible application submission ("Submit").
 * - Deterministic Browser Action Protocol (ADR-0003): Adapters extract structured virtual
 *   representations without issuing uncontrolled DOM mutations.
 */

import type {
  AtsPlatform,
  ApplicationForm,
  AuthBarrierInfo,
  StepProgressionInfo,
  AtsValidationMessage,
} from '@applykit/domain';

/**
 * Comprehensive result of inspecting an ATS page via a vendor-specific form adapter.
 */
export interface FormInspectionResult {
  /** The virtual application form and constituent fields */
  readonly form: ApplicationForm;
  /** Optional authentication barrier detected on page */
  readonly authBarrier?: AuthBarrierInfo;
  /** Optional multi-page wizard progression metadata */
  readonly stepProgression?: StepProgressionInfo;
  /** Active validation error feedback detected in DOM */
  readonly validationErrors?: readonly AtsValidationMessage[];
}

/**
 * Specialized vendor adapter contract for deep ATS form recognition, wizard progression,
 * and authentication barrier detection.
 */
export interface AtsFormAdapter {
  /** Unique ATS vendor identifier (e.g. 'workday', 'greenhouse', 'lever', 'ashby', 'generic') */
  readonly id: AtsPlatform;
  /** Human-readable vendor display name */
  readonly name: string;
  /** Execution priority (higher priority adapters are evaluated first) */
  readonly priority: number;

  /**
   * Evaluates whether this adapter recognizes the webpage URL or DOM markers.
   *
   * @param url Normalized URL of the active webpage.
   * @param doc DOM document object.
   * @returns True if this adapter can process the webpage.
   */
  matches(url: URL, doc: Document): boolean;

  /**
   * Detects whether an authentication or registration barrier is blocking application access.
   *
   * Why: Prevents the extension from attempting to auto-fill candidate credentials into
   * sign-in or account creation forms, instead guiding the candidate to log in first.
   *
   * @param doc DOM document object.
   * @returns Auth barrier details if blocked, or null if form is accessible.
   */
  detectAuthBarrier(doc: Document): AuthBarrierInfo | null;

  /**
   * Detects multi-step wizard state, identifying current step, total steps, and navigation controls.
   *
   * Why: Distinguishes "Next Step" / "Save & Continue" buttons from the final irreversible submit button.
   *
   * @param doc DOM document object.
   * @returns Wizard progression details if multi-step, or null for single-page forms.
   */
  detectWizardState(doc: Document): StepProgressionInfo | null;

  /**
   * Scans the DOM for vendor-specific validation error banners and field invalid indicators.
   *
   * @param doc DOM document object.
   * @returns Array of detected validation error messages with associated selectors.
   */
  detectValidationErrors(doc: Document): readonly AtsValidationMessage[];

  /**
   * Inspects the webpage and constructs a high-fidelity virtual ApplicationForm.
   *
   * @param doc DOM document object.
   * @param container Optional container element scoping the search.
   * @returns Virtual application form, or null if no application form is detected.
   */
  crawlForm(doc: Document, container?: HTMLElement): ApplicationForm | null;
}
