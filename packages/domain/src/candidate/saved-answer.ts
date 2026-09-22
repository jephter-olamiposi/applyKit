import type { SavedAnswerId, EvidenceId } from '../types/ids.js';

/**
 * High-frequency recurring job application question categories.
 */
export type AnswerCategory =
  | 'work_authorization'
  | 'sponsorship'
  | 'salary_expectations'
  | 'notice_period'
  | 'relocation'
  | 'behavioral'
  | 'leadership'
  | 'technical_overview'
  | 'why_company'
  | 'diversity_eeo'
  | 'custom';

/**
 * Pre-approved candidate answer for recurring application questions.
 * Allows safe, deterministic field filling without redundant LLM calls.
 */
export interface SavedAnswer {
  readonly id: SavedAnswerId;
  /** Canonical question identifier (e.g. 'work_auth:us_authorized', 'sponsorship:required'). */
  readonly canonicalKey: string;
  /** Regular expressions or keyword patterns that identify questions this answer fulfills. */
  readonly promptPatterns: readonly string[];
  /** The verified text answer to be inserted. */
  readonly answerText: string;
  readonly category: AnswerCategory;
  readonly tags: readonly string[];
  /** Optional evidence references verifying the facts asserted in this answer. */
  readonly evidenceRefs: readonly EvidenceId[];
  readonly lastUsedAt?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * Matches a form field label or question text against canonical saved answers.
 * Returns the first answer whose prompt pattern matches the input string.
 */
export function matchSavedAnswer(
  savedAnswers: readonly SavedAnswer[],
  fieldLabelOrPrompt: string
): SavedAnswer | undefined {
  if (!fieldLabelOrPrompt) return undefined;
  const normalized = fieldLabelOrPrompt.toLowerCase();
  for (const answer of savedAnswers) {
    for (const pattern of answer.promptPatterns) {
      if (normalized.includes(pattern.toLowerCase())) {
        return answer;
      }
    }
  }
  return undefined;
}
