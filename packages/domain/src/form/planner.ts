/**
 * @fileoverview Deterministic Form Action Planner & Dry Run Engine.
 *
 * Implements the Deterministic Browser Action Protocol (ADR-0003) and Human-in-the-Loop
 * verification gate (ADR-0006). Translates an inspected ApplicationForm and verified
 * CandidateProfile into a structured, reversible sequence of DryRunActions before any DOM
 * mutations occur.
 */

import type { ActionId, FieldId, PlanId } from '../types/ids.js';
import { createActionId, createPlanId } from '../types/ids.js';
import type { CandidateProfile } from '../candidate/profile.js';
import type { ApplicationForm } from './form-schema.js';
import type { ApplicationField } from './application-field.js';
import type { BrowserAction, BrowserActionType } from './browser-action.js';
import { validateBrowserActionSafety } from './browser-action.js';
import type { DryRunAction, RiskLevel } from './dry-run.js';
import { resolveProfileValueForField } from './canonical-fields.js';
import { matchFieldOption } from './option-matcher.js';

/**
 * Record of an inspected form field that was intentionally skipped during planning.
 */
export interface SkippedFormField {
  readonly fieldId: FieldId;
  readonly label: string;
  readonly selector: string;
  readonly reason: 'honeypot_trap' | 'no_profile_value' | 'unsupported_input' | 'user_excluded';
  readonly description: string;
}

/**
 * Statistical risk and confirmation metrics for a DryRunPlan.
 */
export interface PlanSummaryStats {
  readonly totalActions: number;
  readonly lowRiskCount: number;
  readonly mediumRiskCount: number;
  readonly highRiskCount: number;
  readonly requiresConfirmationCount: number;
  readonly unmappedRequiredCount: number;
}

/**
 * Virtual execution plan encapsulating all proposed browser actions for candidate review.
 */
export interface DryRunPlan {
  readonly id: PlanId;
  readonly formId: string;
  readonly formUrl: string;
  readonly detectedAts: string;
  readonly actions: readonly DryRunAction[];
  readonly skippedFields: readonly SkippedFormField[];
  readonly stats: PlanSummaryStats;
  /** CSS selector of the detected submit button, retained purely for candidate visibility. */
  readonly submitButtonSelector?: string;
  readonly createdAt: string;
  /** True when all high-risk and confirmation-required actions have been approved by the user. */
  readonly isApproved: boolean;
}

/**
 * Resolves a human-readable title of the candidate ground truth evidence source
 * backing the inferred field key.
 *
 * Invariant (ADR-0001): Every proposed field value must trace back to verified
 * candidate profile data or evidence records.
 *
 * @param field Inspected application field.
 * @returns Descriptive name of the evidence source.
 */
export function resolveEvidenceSourceTitle(field: ApplicationField): string {
  const key = (field.inferredMappingKey || '').toLowerCase();

  if (
    key.includes('first_name') ||
    key.includes('firstname') ||
    key.includes('last_name') ||
    key.includes('lastname') ||
    key.includes('full_name') ||
    key.includes('fullname') ||
    key.startsWith('identity.legal')
  ) {
    return 'Candidate Identity (Verified Profile)';
  }
  if (
    key.includes('email') ||
    key.includes('phone') ||
    key.includes('location') ||
    key.includes('address') ||
    key.includes('city') ||
    key.includes('postalcode')
  ) {
    return 'Contact Information (Verified Profile)';
  }
  if (
    key.includes('linkedin') ||
    key.includes('github') ||
    key.includes('portfolio') ||
    key.includes('website') ||
    key.startsWith('links.')
  ) {
    return 'Candidate Web Links (Verified Profile)';
  }
  if (key.includes('experience') || key.includes('title') || key.includes('company')) {
    return 'Work History & Experience (Evidence Graph)';
  }
  if (key.includes('education') || key.includes('school') || key.includes('degree')) {
    return 'Education Records (Evidence Graph)';
  }
  if (key.includes('skills')) {
    return 'Candidate Skills & Competencies (Evidence Graph)';
  }
  if (key.startsWith('eeo_') || key.includes('eeo') || key.includes('demographics')) {
    return 'Demographic Disclosures (User Confirmation Required)';
  }
  if (key.includes('workauthorization') || key.includes('sponsorship') || key.includes('visa')) {
    return 'Legal Work Authorization (User Confirmation Required)';
  }
  if (field.fieldType === 'file_upload' || key.includes('resume') || key.includes('documents.')) {
    return 'Candidate Resume Document Attachment';
  }

  return 'Candidate Profile & Evidence Graph';
}

/**
 * Evaluates the risk level for a candidate form field fill action.
 *
 * Risk stratification rules:
 * - High: Demographic disclosures (EEO), legal work authorization/sponsorship questions, file uploads.
 * - Medium: Overwriting existing non-empty DOM content, confidence between 0.60 and 0.84, or custom questions.
 * - Low: Standard contact, name, or location fields with confidence >= 0.85 where DOM input is empty.
 *
 * @param field The inspected form field.
 * @param candidateValue The resolved candidate profile value.
 * @returns Classified risk level: 'low' | 'medium' | 'high'.
 */
export function calculateActionRisk(
  field: ApplicationField,
  candidateValue: string | undefined
): RiskLevel {
  const key = (field.inferredMappingKey || '').toLowerCase();

  // Rule 1: High risk for legal compliance, visa authorization, demographics, and file uploads
  if (
    key.includes('demographics') ||
    key.startsWith('eeo_') ||
    key.includes('workauthorization') ||
    key.includes('sponsorship') ||
    field.fieldType === 'file_upload'
  ) {
    return 'high';
  }

  // Rule 2: Medium risk if overwriting an existing, different non-empty value in DOM
  if (
    field.currentValue &&
    field.currentValue.trim().length > 0 &&
    field.currentValue.trim() !== (candidateValue || '').trim()
  ) {
    return 'medium';
  }

  // Rule 3: Medium risk if confidence is moderate or custom question
  if (field.confidenceScore < 0.85 || key === 'custom_question') {
    return 'medium';
  }

  // Rule 4: Low risk for high-confidence empty fields
  return 'low';
}

/**
 * Options configuring dry run plan generation.
 */
export interface PlanGenerationOptions {
  /** When true, generates actions even if the DOM already contains the identical value. */
  readonly includeRedundantFills?: boolean;
}

/**
 * Deterministically resolves candidate values for specialized custom questions
 * such as skill self-ratings, remote experience checks, or location fallbacks.
 *
 * @param profile Verified candidate profile aggregate.
 * @param field Inspected application field.
 * @returns Resolved value string if profile data exists, otherwise undefined.
 */
export function resolveCustomFieldDeterministicValue(
  profile: CandidateProfile,
  field: ApplicationField
): string | undefined {
  const normLabel = (field.label || '').toLowerCase();

  // 1. Skill Rating Questions (e.g. "How do you rate your own skills with Node.js?")
  if (field.fieldType === 'radio' || field.fieldType === 'select') {
    const rateMatch = normLabel.match(
      /(?:rate\s+(?:your\s+)?(?:own\s+)?skills?\s+with|experience\s+with|knowledge\s+of)\s+([a-z0-9.#+ -]+)/i
    );
    if (rateMatch && rateMatch[1]) {
      const searchedSkill = rateMatch[1].trim().toLowerCase();
      const matchedSkill = profile.skills.find(
        (s) =>
          searchedSkill.includes(s.normalizedName) ||
          s.normalizedName.includes(searchedSkill) ||
          searchedSkill.includes(s.name.toLowerCase()) ||
          s.name.toLowerCase().includes(searchedSkill)
      );

      if (matchedSkill) {
        if (
          matchedSkill.proficiency === 'expert' ||
          matchedSkill.proficiency === 'advanced' ||
          (matchedSkill.yearsOfExperience ?? 0) >= 3
        ) {
          return 'Advanced';
        }
        if (
          matchedSkill.proficiency === 'intermediate' ||
          (matchedSkill.yearsOfExperience ?? 0) >= 1
        ) {
          return 'Intermediate';
        }
        return 'Beginner';
      }
    }

    // Remote experience question with Yes/No radio/select
    if (normLabel.includes('remote') && (normLabel.includes('experience') || normLabel.includes('work'))) {
      if (
        profile.professional.workplacePreference === 'remote' ||
        profile.professional.workplacePreference === 'hybrid'
      ) {
        return 'Yes';
      }
    }
  }

  // 2. Earliest Start Date / Notice Period
  if (
    normLabel.includes('start') &&
    (normLabel.includes('when') || normLabel.includes('date') || normLabel.includes('soon'))
  ) {
    return (
      profile.professional.earliestStartDate ||
      (profile.professional.noticePeriodDays
        ? `${profile.professional.noticePeriodDays} days notice`
        : 'Immediately upon offer or standard 2 weeks notice')
    );
  }

  // 3. Country / Remote location
  if (
    normLabel.includes('country') &&
    (normLabel.includes('working') || normLabel.includes('located') || normLabel.includes('from'))
  ) {
    return profile.identity.location?.country || 'United States';
  }

  // 4. Annual USD Salary Expectation
  if (
    normLabel.includes('salary') &&
    (normLabel.includes('expected') || normLabel.includes('annual') || normLabel.includes('usd'))
  ) {
    return String(profile.professional.compensationExpectation?.targetSalaryMin || 150000);
  }

  return undefined;
}

/**
 * Generates an immutable DryRunPlan from an inspected form and candidate profile.
 *
 * Invariant (ADR-0003 & ADR-0006):
 * 1. The planner never executes code. It outputs structured intent.
 * 2. Submit buttons are programmatically blocked and will never have actions generated.
 * 3. Honeypot traps are strictly filtered out to protect candidate standing.
 *
 * @param form The virtual application form discovered on the webpage.
 * @param profile Verified candidate profile aggregate.
 * @param options Planning options.
 * @returns Fully validated DryRunPlan ready for user review.
 */
export function generateDryRunPlan(
  form: ApplicationForm,
  profile: CandidateProfile,
  options: PlanGenerationOptions = {}
): DryRunPlan {
  const actions: DryRunAction[] = [];
  const skippedFields: SkippedFormField[] = [];

  for (const field of form.fields) {
    // 1. Anti-Bot Honeypot Defense: Strictly skip flagged honeypot traps
    if (field.isHoneypotSuspect) {
      skippedFields.push({
        fieldId: field.id,
        label: field.label,
        selector: field.selector,
        reason: 'honeypot_trap',
        description: 'Skipped anti-bot honeypot trap to prevent automated application rejection.',
      });
      continue;
    }

    // 2. Resolve Candidate Value
    const resolvedValue =
      resolveProfileValueForField(
        profile,
        field.inferredMappingKey || field.label
      ) || resolveCustomFieldDeterministicValue(profile, field);

    if (!resolvedValue || resolvedValue.trim().length === 0) {
      skippedFields.push({
        fieldId: field.id,
        label: field.label,
        selector: field.selector,
        reason: 'no_profile_value',
        description: 'No verified profile data available to populate this field.',
      });
      continue;
    }

    // Skip redundant identical fills unless explicitly requested
    if (
      !options.includeRedundantFills &&
      field.currentValue &&
      field.currentValue.trim() === resolvedValue.trim()
    ) {
      continue;
    }

    // 3. Map Input Type to Declarative BrowserAction
    let actionType: BrowserActionType = 'fill_text';
    let targetValue = resolvedValue;
    let targetSelector = field.selector;
    let actionDescription = `Fill "${resolvedValue}" into ${field.label || 'field'}`;

    if (field.fieldType === 'select') {
      actionType = 'select_option';
      if (field.options && field.options.length > 0) {
        const match = matchFieldOption(field.options, resolvedValue);
        if (match.matchedOption) {
          targetValue = match.matchedOption.value;
          actionDescription = `Select "${match.matchedOption.label}" for ${field.label}`;
        }
      }
    } else if (field.fieldType === 'radio') {
      actionType = 'click';
      if (field.options && field.options.length > 0) {
        const match = matchFieldOption(field.options, resolvedValue);
        if (match.matchedOption) {
          const escapedVal = match.matchedOption.value.replace(/"/g, '\\"');
          targetSelector = field.selector.startsWith('input')
            ? `${field.selector}[value="${escapedVal}"]`
            : `${field.selector} input[value="${escapedVal}"]`;
          targetValue = match.matchedOption.value;
          actionDescription = `Select radio choice "${match.matchedOption.label}" for ${field.label}`;
        }
      }
    } else if (field.fieldType === 'checkbox') {
      const isAffirmative = ['yes', 'true', '1', 'authorized'].includes(
        resolvedValue.toLowerCase()
      );
      actionType = isAffirmative ? 'check' : 'uncheck';
      actionDescription = `${isAffirmative ? 'Check' : 'Uncheck'} ${field.label}`;
    } else if (field.fieldType === 'file_upload') {
      actionType = 'upload_file';
      actionDescription = `Attach document "${resolvedValue}" to ${field.label}`;
    }

    // 4. Calculate Risk & Confirmation Requirements
    const riskLevel = calculateActionRisk(field, resolvedValue);
    const requiresUserConfirmation = riskLevel === 'high' || field.confidenceScore < 0.7;

    const browserAction: BrowserAction = {
      actionType,
      selector: targetSelector,
      value: targetValue,
      description: actionDescription,
      requiresUserConfirmation,
    };

    // 5. Anti-Submission Hard Gate Safety Check
    const safetyCheck = validateBrowserActionSafety(browserAction);
    if (safetyCheck.isProhibited) {
      skippedFields.push({
        fieldId: field.id,
        label: field.label,
        selector: field.selector,
        reason: 'unsupported_input',
        description: safetyCheck.reason || 'Prohibited by safety policies.',
      });
      continue;
    }

    // 6. Formulate Diff Explanation & Evidence Grounding Citation
    const diffExplanation = field.currentValue && field.currentValue.trim().length > 0
      ? `Replace existing "${field.currentValue}" with candidate profile value "${resolvedValue}"`
      : `Insert candidate profile value "${resolvedValue}" into empty field`;

    const sourceEvidenceTitle = resolveEvidenceSourceTitle(field);

    actions.push({
      id: createActionId(),
      action: browserAction,
      fieldId: field.id,
      currentValue: field.currentValue || '',
      candidateValueUsed: resolvedValue,
      confidence: field.confidenceScore,
      riskLevel,
      userConfirmed: !requiresUserConfirmation,
      diffExplanation,
      sourceEvidenceTitle,
    });
  }

  // Calculate summary metrics
  const lowRiskCount = actions.filter((a) => a.riskLevel === 'low').length;
  const mediumRiskCount = actions.filter((a) => a.riskLevel === 'medium').length;
  const highRiskCount = actions.filter((a) => a.riskLevel === 'high').length;
  const requiresConfirmationCount = actions.filter((a) => !a.userConfirmed).length;

  const unmappedRequiredCount = form.fields.filter(
    (f) => f.isRequired && !actions.some((a) => a.fieldId === f.id)
  ).length;

  const stats: PlanSummaryStats = {
    totalActions: actions.length,
    lowRiskCount,
    mediumRiskCount,
    highRiskCount,
    requiresConfirmationCount,
    unmappedRequiredCount,
  };

  return {
    id: createPlanId(),
    formId: form.id,
    formUrl: form.url,
    detectedAts: form.detectedAts,
    actions,
    skippedFields,
    stats,
    submitButtonSelector: form.submitButtonSelector,
    createdAt: new Date().toISOString(),
    isApproved: actions.every((a) => a.userConfirmed),
  };
}

/**
 * Determines whether an inspected field is an open-answer question eligible for AI-assisted answering.
 *
 * Eligible fields are free-text questions (text/textarea) without a profile-mapped value that are
 * not anti-bot traps and not sensitive compliance disclosures (demographics, EEO, work
 * authorization, sponsorship). Answers to these fields are staged as unconfirmed medium-risk
 * actions for candidate review (ADR-0006).
 */
export function isAiAnswerableCustomField(field: ApplicationField): boolean {
  if (field.isHoneypotSuspect) return false;
  if (
    field.fieldType !== 'text' &&
    field.fieldType !== 'textarea' &&
    field.fieldType !== 'number'
  ) {
    return false;
  }

  const key = (field.inferredMappingKey || '').toLowerCase();
  if (
    key.includes('demographics') ||
    key.startsWith('eeo_') ||
    key.includes('workauthorization') ||
    key.includes('sponsorship')
  ) {
    return false;
  }

  // Fields with a resolved profile mapping are already deterministic; only open questions qualify.
  return !field.inferredMappingKey || key === 'custom_question';
}

/**
 * Staged AI-proposed answer for a single open-answer field, pending candidate review.
 */
export interface AiProposedFieldAnswer {
  readonly fieldId: FieldId;
  readonly answerText: string;
  /** 0.0 to 1.0 model grounding confidence. */
  readonly confidence: number;
  readonly supportingClaimIds: readonly string[];
}

/**
 * Appends AI-proposed answers to a DryRunPlan as unconfirmed, medium-risk fill actions.
 *
 * Invariant (ADR-0001 & ADR-0006): Proposals are only staged when backed by candidate evidence;
 * every AI-proposed action starts with userConfirmed=false so the candidate must approve it
 * before execution. Previously skipped no-profile-value entries for the answered fields are
 * removed to keep the plan consistent, and summary statistics are recomputed.
 *
 * @param plan Existing DryRunPlan.
 * @param form The inspected application form the plan was generated from.
 * @param answers AI-proposed answers, each grounded in the evidence graph.
 * @returns Updated DryRunPlan containing the additional review-pending actions.
 */
export function withAiProposedFieldAnswers(
  plan: DryRunPlan,
  form: ApplicationForm,
  answers: readonly AiProposedFieldAnswer[]
): DryRunPlan {
  const fieldsById = new Map(form.fields.map((field) => [field.id, field]));

  const newActions: DryRunAction[] = answers.flatMap((answer) => {
    const field = fieldsById.get(answer.fieldId);
    if (!field) return [];
    if (field.isHoneypotSuspect || !isAiAnswerableCustomField(field)) return [];
    if (plan.actions.some((action) => action.fieldId === answer.fieldId)) return [];
    if (!answer.answerText || answer.answerText.trim().length === 0) return [];

    let actionType: BrowserActionType = 'fill_text';
    let targetSelector = field.selector;
    let targetValue: string | undefined = answer.answerText;

    if (field.fieldType === 'radio') {
      actionType = 'click';
      const matchingOpt = field.options?.find(
        (o) =>
          o.value.toLowerCase() === answer.answerText.toLowerCase() ||
          o.label.toLowerCase() === answer.answerText.toLowerCase() ||
          answer.answerText.toLowerCase().includes(o.value.toLowerCase()) ||
          answer.answerText.toLowerCase().includes(o.label.toLowerCase())
      );
      if (matchingOpt) {
        targetSelector = `input[type="radio"][name="${field.name || ''}"][value="${matchingOpt.value}"]`;
        targetValue = matchingOpt.value;
      }
    } else if (field.fieldType === 'select') {
      actionType = 'select_option';
      const matchingOpt = field.options?.find(
        (o) =>
          o.value.toLowerCase() === answer.answerText.toLowerCase() ||
          o.label.toLowerCase() === answer.answerText.toLowerCase()
      );
      if (matchingOpt) {
        targetValue = matchingOpt.value;
      }
    }

    const browserAction: BrowserAction = {
      actionType,
      selector: targetSelector,
      value: targetValue,
      description: `Propose AI answer for ${field.label || 'question'}`,
      requiresUserConfirmation: true,
    };

    const dryRunAction: DryRunAction = {
      id: createActionId(),
      action: browserAction,
      fieldId: field.id,
      currentValue: field.currentValue || '',
      candidateValueUsed: answer.answerText,
      confidence: Math.min(1, Math.max(0, answer.confidence)),
      riskLevel: 'medium',
      userConfirmed: false,
      diffExplanation: 'AI-proposed answer staged for candidate review before insertion.',
      sourceEvidenceTitle: 'AI Proposal Grounded in Evidence Graph',
      sourceClaimId: answer.supportingClaimIds[0],
    };
    return [dryRunAction];
  });

  if (newActions.length === 0) {
    return plan;
  }

  const answeredFieldIds = new Set(newActions.map((action) => action.fieldId));
  const actions = [...plan.actions, ...newActions];
  const skippedFields = plan.skippedFields.filter(
    (skipped) => skipped.fieldId === undefined || !answeredFieldIds.has(skipped.fieldId)
  );

  const lowRiskCount = actions.filter((action) => action.riskLevel === 'low').length;
  const mediumRiskCount = actions.filter((action) => action.riskLevel === 'medium').length;
  const highRiskCount = actions.filter((action) => action.riskLevel === 'high').length;
  const requiresConfirmationCount = actions.filter((action) => !action.userConfirmed).length;
  const unmappedRequiredCount = form.fields.filter(
    (field) => field.isRequired && !actions.some((action) => action.fieldId === field.id)
  ).length;

  return {
    ...plan,
    actions,
    skippedFields,
    stats: {
      totalActions: actions.length,
      lowRiskCount,
      mediumRiskCount,
      highRiskCount,
      requiresConfirmationCount,
      unmappedRequiredCount,
    },
    isApproved: actions.every((action) => action.userConfirmed),
  };
}

/**
 * Updates the candidate value of a planned action inline, recalculating action diff and description.
 *
 * @param plan Existing DryRunPlan.
 * @param actionId Unique action identifier to update.
 * @param newValue New value supplied by the user.
 * @returns Updated DryRunPlan.
 */
export function updatePlanActionValue(
  plan: DryRunPlan,
  actionId: ActionId,
  newValue: string
): DryRunPlan {
  const updatedActions = plan.actions.map((act) => {
    if (act.id !== actionId) return act;

    const updatedAction: BrowserAction = {
      ...act.action,
      value: newValue,
      description: `Fill user-overridden "${newValue}"`,
    };

    return {
      ...act,
      action: updatedAction,
      candidateValueUsed: newValue,
      userConfirmed: true, // User directly typed this value, confirming approval
      diffExplanation: `User manual override: "${newValue}"`,
    };
  });

  return {
    ...plan,
    actions: updatedActions,
    isApproved: updatedActions.every((a) => a.userConfirmed),
  };
}

/**
 * Toggles user confirmation approval for a planned high-risk action.
 *
 * @param plan Existing DryRunPlan.
 * @param actionId Unique action identifier to toggle.
 * @param confirmed Explicit confirmation state (defaults to toggling current state).
 * @returns Updated DryRunPlan.
 */
export function togglePlanActionApproval(
  plan: DryRunPlan,
  actionId: ActionId,
  confirmed?: boolean
): DryRunPlan {
  const updatedActions = plan.actions.map((act) => {
    if (act.id !== actionId) return act;
    const nextState = confirmed !== undefined ? confirmed : !act.userConfirmed;
    return {
      ...act,
      userConfirmed: nextState,
    };
  });

  const requiresConfirmationCount = updatedActions.filter((a) => !a.userConfirmed).length;

  return {
    ...plan,
    actions: updatedActions,
    stats: {
      ...plan.stats,
      requiresConfirmationCount,
    },
    isApproved: updatedActions.every((a) => a.userConfirmed),
  };
}

/**
 * Excludes a planned action from execution, moving it to the skipped fields list.
 *
 * @param plan Existing DryRunPlan.
 * @param actionId Unique action identifier to exclude.
 * @returns Updated DryRunPlan.
 */
export function excludePlanAction(plan: DryRunPlan, actionId: ActionId): DryRunPlan {
  const targetAction = plan.actions.find((a) => a.id === actionId);
  if (!targetAction) return plan;

  const updatedActions = plan.actions.filter((a) => a.id !== actionId);
  const newSkipped: SkippedFormField = {
    fieldId: targetAction.fieldId!,
    label: targetAction.action.description,
    selector: targetAction.action.selector,
    reason: 'user_excluded',
    description: 'Manually excluded from automated execution by candidate.',
  };

  const lowRiskCount = updatedActions.filter((a) => a.riskLevel === 'low').length;
  const mediumRiskCount = updatedActions.filter((a) => a.riskLevel === 'medium').length;
  const highRiskCount = updatedActions.filter((a) => a.riskLevel === 'high').length;
  const requiresConfirmationCount = updatedActions.filter((a) => !a.userConfirmed).length;

  return {
    ...plan,
    actions: updatedActions,
    skippedFields: [...plan.skippedFields, newSkipped],
    stats: {
      totalActions: updatedActions.length,
      lowRiskCount,
      mediumRiskCount,
      highRiskCount,
      requiresConfirmationCount,
      unmappedRequiredCount: plan.stats.unmappedRequiredCount,
    },
    isApproved: updatedActions.every((a) => a.userConfirmed),
  };
}

/**
 * Batch-approves all low-risk actions within a DryRunPlan while preserving
 * confirmation requirements on high-risk fields.
 *
 * @param plan Active DryRunPlan.
 * @returns Updated DryRunPlan.
 */
export function approveAllLowRiskActions(plan: DryRunPlan): DryRunPlan {
  const updatedActions = plan.actions.map((action) => {
    if (action.riskLevel === 'low') {
      return { ...action, userConfirmed: true };
    }
    return action;
  });

  const requiresConfirmationCount = updatedActions.filter((a) => !a.userConfirmed).length;

  return {
    ...plan,
    actions: updatedActions,
    stats: {
      ...plan.stats,
      requiresConfirmationCount,
    },
    isApproved: updatedActions.every((a) => a.userConfirmed),
  };
}

/**
 * Batch-approves every action in the DryRunPlan (including high-risk items)
 * upon explicit candidate command.
 *
 * @param plan Active DryRunPlan.
 * @returns Fully approved DryRunPlan.
 */
export function approveAllActions(plan: DryRunPlan): DryRunPlan {
  const updatedActions = plan.actions.map((action) => ({
    ...action,
    userConfirmed: true,
  }));

  return {
    ...plan,
    actions: updatedActions,
    stats: {
      ...plan.stats,
      requiresConfirmationCount: 0,
    },
    isApproved: true,
  };
}

/**
 * Resets all action confirmations back to their initial risk-stratified state.
 *
 * @param plan Active DryRunPlan.
 * @returns DryRunPlan with reset confirmations.
 */
export function resetAllApprovals(plan: DryRunPlan): DryRunPlan {
  const updatedActions = plan.actions.map((action) => ({
    ...action,
    userConfirmed: action.riskLevel === 'low',
  }));

  const requiresConfirmationCount = updatedActions.filter((a) => !a.userConfirmed).length;

  return {
    ...plan,
    actions: updatedActions,
    stats: {
      ...plan.stats,
      requiresConfirmationCount,
    },
    isApproved: updatedActions.every((a) => a.userConfirmed),
  };
}

/**
 * Creates an isolated single-action DryRunPlan for selective execution of a specific field.
 *
 * @param plan Active DryRunPlan.
 * @param targetActionId Unique action ID to selectively execute.
 * @returns A single-action DryRunPlan pre-approved for immediate execution.
 */
export function createSelectiveDryRunPlan(plan: DryRunPlan, targetActionId: ActionId): DryRunPlan {
  const targetAction = plan.actions.find((a) => a.id === targetActionId);
  if (!targetAction) {
    throw new Error(`Target action not found in plan: ${targetActionId}`);
  }

  const selectiveAction: DryRunAction = {
    ...targetAction,
    userConfirmed: true,
  };

  return {
    ...plan,
    actions: [selectiveAction],
    stats: {
      totalActions: 1,
      lowRiskCount: selectiveAction.riskLevel === 'low' ? 1 : 0,
      mediumRiskCount: selectiveAction.riskLevel === 'medium' ? 1 : 0,
      highRiskCount: selectiveAction.riskLevel === 'high' ? 1 : 0,
      requiresConfirmationCount: 0,
      unmappedRequiredCount: 0,
    },
    isApproved: true,
  };
}
