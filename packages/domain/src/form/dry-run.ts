import type { ActionId, FieldId } from '../types/ids.js';
import type { BrowserAction } from './browser-action.js';
import { validateBrowserActionSafety } from './browser-action.js';

/**
 * Risk classification for planned browser actions.
 */
export type RiskLevel = 'low' | 'medium' | 'high';

/**
 * Planned browser action staged for candidate review before execution.
 */
export interface DryRunAction {
  readonly id: ActionId;
  readonly action: BrowserAction;
  readonly fieldId?: FieldId;
  /** Value currently in the DOM input prior to action. */
  readonly currentValue: string;
  /** Value to be inserted by this action. */
  readonly candidateValueUsed: string;
  /** Heuristic confidence score from 0.0 to 1.0. */
  readonly confidence: number;
  readonly riskLevel: RiskLevel;
  /** Flag indicating whether the candidate has explicitly reviewed and approved this action. */
  readonly userConfirmed: boolean;
  /** Explanation of diff or mapping logic. */
  readonly diffExplanation?: string;
  /** Verified evidence source title (e.g., 'Verified Profile Identity'). */
  readonly sourceEvidenceTitle?: string;
  /** Identifier of the grounding claim supporting this value if available. */
  readonly sourceClaimId?: string;
}

/**
 * Summary validation report for a planned dry-run sequence.
 */
export interface DryRunPlanValidation {
  readonly isValid: boolean;
  readonly prohibitedActions: readonly {
    readonly actionId: ActionId;
    readonly reason: string;
  }[];
  readonly requiresConfirmationCount: number;
}

/**
 * Evaluates an entire dry-run action plan against safety policies.
 * Identifies prohibited actions (e.g. submit attempts) and counts actions requiring explicit confirmation.
 */
export function validateDryRunPlan(plan: readonly DryRunAction[]): DryRunPlanValidation {
  const prohibited: { actionId: ActionId; reason: string }[] = [];
  let requiresConfirmationCount = 0;

  for (const item of plan) {
    const safety = validateBrowserActionSafety(item.action);
    if (safety.isProhibited) {
      prohibited.push({
        actionId: item.id,
        reason: safety.reason ?? 'Prohibited by safety policy',
      });
    }

    if (item.riskLevel === 'high' || item.action.requiresUserConfirmation) {
      requiresConfirmationCount++;
    }
  }

  return {
    isValid: prohibited.length === 0,
    prohibitedActions: prohibited,
    requiresConfirmationCount,
  };
}
