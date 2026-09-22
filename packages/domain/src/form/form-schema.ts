/**
 * @fileoverview Application Form Schema and Virtual Representation Aggregate.
 *
 * Models a complete job application web form, its constituent fields, submit controls,
 * and ATS vendor classification without performing any live DOM mutations.
 */

import type { ApplicationField } from './application-field.js';

/**
 * Recognized Applicant Tracking System (ATS) platform architectures.
 */
export type AtsPlatform =
  | 'greenhouse'
  | 'lever'
  | 'workday'
  | 'ashby'
  | 'smartrecruiters'
  | 'generic';

/**
 * Information on an authentication barrier blocking job application access.
 */
export interface AuthBarrierInfo {
  readonly isBlocked: boolean;
  readonly barrierType: 'login' | 'registration' | 'sso' | 'unknown';
  readonly message: string;
  readonly signInButtonSelector?: string;
}

/**
 * Information on a multi-step application wizard's progression state.
 */
export interface StepProgressionInfo {
  readonly isMultiStep: boolean;
  readonly currentStepIndex: number;
  readonly totalSteps: number;
  readonly stepName?: string;
  readonly stepNames?: readonly string[];
  readonly nextStepButtonSelector?: string;
  readonly isFinalStep?: boolean;
}

/**
 * Active validation feedback or error messages surfaced by the host ATS form.
 */
export interface AtsValidationMessage {
  readonly fieldSelector?: string;
  readonly message: string;
}

/**
 * High-fidelity virtual representation of an inspected job application form.
 */
export interface ApplicationForm {
  readonly id: string;
  readonly url: string;
  readonly detectedAts: AtsPlatform;
  readonly formAction?: string;
  readonly formMethod?: string;
  readonly fields: readonly ApplicationField[];
  /**
   * CSS selector identifying the final submission button.
   *
   * Security Invariant: The extension uses this selector strictly for detection and
   * visualization. It is programmatically forbidden from ever triggering automated clicks.
   */
  readonly submitButtonSelector?: string;
  readonly isMultiStep: boolean;
  readonly currentStepIndex?: number;
  readonly totalSteps?: number;
  readonly authBarrier?: AuthBarrierInfo;
  readonly stepProgression?: StepProgressionInfo;
  readonly validationErrors?: readonly AtsValidationMessage[];
  readonly inspectedAt: string;
}

/**
 * Identifies any required form fields that lack an inferred candidate profile mapping.
 *
 * @param form Virtual application form aggregate.
 * @returns Array of mandatory fields requiring user attention.
 */
export function getFormUnmappedRequiredFields(
  form: ApplicationForm
): readonly ApplicationField[] {
  return form.fields.filter(
    (field) => field.isRequired && (!field.inferredMappingKey || field.confidenceScore < 0.5)
  );
}

/**
 * Evaluates whether a form is sufficiently mapped to permit a safe dry-run plan generation.
 *
 * @param form Virtual application form aggregate.
 * @returns True if all mandatory fields have mapped candidate values.
 */
export function isFormReadyForDryRun(form: ApplicationForm): boolean {
  const unmapped = getFormUnmappedRequiredFields(form);
  return unmapped.length === 0;
}
