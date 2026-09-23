/**
 * @fileoverview Structured AI field-answering schema and validator.
 *
 * Validates LLM-proposed answers to open application questions before they can enter a
 * DryRunPlan. Answers are always staged for candidate review (Human-in-the-Loop, ADR-0006).
 */

/**
 * A validated LLM proposal for a single open-answer form field.
 */
export interface AiFieldAnswerResult {
  readonly answerText: string;
  /** 0.0 to 1.0 model self-assessment of grounding confidence. */
  readonly confidence: number;
  readonly supportingClaimIds: readonly string[];
  /** True only when the answer is grounded in candidate evidence (zero-hallucination gate). */
  readonly isGrounded: boolean;
  readonly notes?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Structural type guard for LLM field-answer completions.
 *
 * Rejects answers the model itself flagged as ungrounded or empty, enforcing the
 * zero-hallucination invariant before a proposal is staged for user review.
 */
export function isAiFieldAnswerResult(value: unknown): value is AiFieldAnswerResult {
  if (!isRecord(value)) return false;
  const confidence = value['confidence'];
  const claimIds = value['supportingClaimIds'];
  return (
    typeof value['answerText'] === 'string' &&
    value['answerText'].trim().length > 0 &&
    typeof confidence === 'number' &&
    confidence >= 0 &&
    confidence <= 1 &&
    Array.isArray(claimIds) &&
    claimIds.every((id) => typeof id === 'string') &&
    typeof value['isGrounded'] === 'boolean' &&
    (value['notes'] === undefined || typeof value['notes'] === 'string')
  );
}