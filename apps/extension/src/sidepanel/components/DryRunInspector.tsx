/**
 * @fileoverview "Check each field": the field-by-field review list for a planned fill.
 *
 * Each planned answer can be ticked, edited, filled on its own, or skipped (ADR-0003).
 * Legal and demographic questions are never pre-ticked, and nothing here can press the
 * page's Submit button (ADR-0006).
 */

import { NextStep } from './NextStep.js';
import React, { useState, useEffect, useCallback } from 'react';
import type { DryRunPlan, DryRunAction, ActionId, ExecutionReport } from '@applykit/domain';
import { sendToBackground } from '../../messages/bridge.js';
import type {
  GetActivePlanRequest,
  GetActivePlanResponse,
  GetActiveFormRequest,
  GetActiveFormResponse,
  AnswerCustomFieldsRequest,
  AnswerCustomFieldsResponse,
  UpdatePlanActionRequest,
  UpdatePlanActionResponse,
  TogglePlanActionApprovalRequest,
  TogglePlanActionApprovalResponse,
  ExcludePlanActionRequest,
  ExcludePlanActionResponse,
  ExecutePlanRequest,
  ExecutePlanResponse,
  HighlightFormFieldRequest,
  HighlightFormFieldResponse,
  ClearFormFieldHighlightRequest,
  ClearFormFieldHighlightResponse,
  ToggleInPageReviewBadgesRequest,
  ToggleInPageReviewBadgesResponse,
  BatchApprovePlanActionsRequest,
  BatchApprovePlanActionsResponse,
  ExecuteSelectiveActionRequest,
  ExecuteSelectiveActionResponse,
} from '../../messages/contracts.js';
import type { TabId } from './NavigationTabs.js';

interface DryRunInspectorProps {
  onNavigateToTab?: (tab: TabId) => void;
  onPlanUpdated?: (plan: DryRunPlan) => void;
}

type ActionFilter = 'all' | 'unconfirmed';

/**
 * Dry Run Plan Inspector component rendering interactive action diffs and approval gates.
 */
export const DryRunInspector: React.FC<DryRunInspectorProps> = ({
  onNavigateToTab,
  onPlanUpdated,
}) => {
  const [plan, setPlan] = useState<DryRunPlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<ActionFilter>('all');
  const [editingActionId, setEditingActionId] = useState<ActionId | null>(null);
  const [editValue, setEditValue] = useState<string>('');
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionReport, setExecutionReport] = useState<ExecutionReport | null>(null);
  const [inPageOverlayActive, setInPageOverlayActive] = useState(false);
  const [executingActionId, setExecutingActionId] = useState<ActionId | null>(null);

  const fetchActivePlan = useCallback(async () => {
    try {
      setLoading(true);
      const res = await sendToBackground<GetActivePlanRequest, GetActivePlanResponse>({
        type: 'GET_ACTIVE_PLAN',
      });
      if (res && res.plan) {
        setPlan(res.plan);
        if (onPlanUpdated) onPlanUpdated(res.plan);
      }
    } catch {
      // Background plan not available
    } finally {
      setLoading(false);
    }
  }, [onPlanUpdated]);

  useEffect(() => {
    fetchActivePlan();
  }, [fetchActivePlan]);

  const handleHighlightField = async (selector: string, label?: string) => {
    try {
      await sendToBackground<HighlightFormFieldRequest, HighlightFormFieldResponse>({
        type: 'HIGHLIGHT_FORM_FIELD',
        selector,
        label,
      });
    } catch {
      // Suppress highlight error if tab not active
    }
  };

  const handleClearHighlight = async () => {
    try {
      await sendToBackground<ClearFormFieldHighlightRequest, ClearFormFieldHighlightResponse>({
        type: 'CLEAR_FORM_FIELD_HIGHLIGHT',
      });
    } catch {
      // Suppress error
    }
  };

  const handleToggleInPageOverlay = async () => {
    const nextState = !inPageOverlayActive;
    setInPageOverlayActive(nextState);

    try {
      const res = await sendToBackground<
        ToggleInPageReviewBadgesRequest,
        ToggleInPageReviewBadgesResponse
      >({
        type: 'TOGGLE_IN_PAGE_REVIEW_BADGES',
        enabled: nextState,
      });

      if (res && res.success) {
        setFeedbackNotice(
          nextState
            ? `Labelled ${res.count ?? 0} field${res.count === 1 ? '' : 's'} on the page.`
            : 'In-page preview badges removed from webpage.'
        );
        setTimeout(() => setFeedbackNotice(null), 3000);
      }
    } catch (err) {
      setFeedbackNotice(`Couldn't label the page: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleBatchApprove = async (mode: 'low_risk_only' | 'all' | 'reset') => {
    try {
      const res = await sendToBackground<
        BatchApprovePlanActionsRequest,
        BatchApprovePlanActionsResponse
      >({
        type: 'BATCH_APPROVE_PLAN_ACTIONS',
        mode,
      });

      if (res.success && res.plan) {
        setPlan(res.plan);
        if (onPlanUpdated) onPlanUpdated(res.plan);

        if (mode === 'low_risk_only') {
          setFeedbackNotice('Ticked the simple fields. Legal questions still need your tick.');
        } else if (mode === 'all') {
          setFeedbackNotice('Everything is ticked.');
        } else {
          setFeedbackNotice('Unticked everything.');
        }
        setTimeout(() => setFeedbackNotice(null), 3000);
      }
    } catch (err) {
      setFeedbackNotice(`Couldn't update the ticks: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleAnswerCustomFields = async () => {
    if (!plan) return;
    try {
      setFeedbackNotice('Drafting answers from your resume...');
      // Fetch the form from background storage
      const formRes = await sendToBackground<
        GetActiveFormRequest,
        GetActiveFormResponse
      >({
        type: 'GET_ACTIVE_FORM',
      });

      if (!formRes || !formRes.form) {
        setFeedbackNotice('Scan the form first.');
        return;
      }

      const res = await sendToBackground<
        AnswerCustomFieldsRequest,
        AnswerCustomFieldsResponse
      >({
        type: 'ANSWER_CUSTOM_FIELDS',
        form: formRes.form,
        plan,
      });

      if (res.success && res.plan) {
        setPlan(res.plan);
        if (onPlanUpdated) onPlanUpdated(res.plan);
        setFeedbackNotice(
          `Drafted ${res.plan.actions.filter(a => a.sourceEvidenceTitle?.startsWith('AI Proposal')).length} answer(s). Read them before ticking.`
        );
        setTimeout(() => setFeedbackNotice(null), 4000);
      } else {
        setFeedbackNotice(`Couldn't draft answers: ${res.error || 'no AI key is set up in Settings.'}`);
      }
    } catch (err) {
      setFeedbackNotice(`Couldn't draft answers: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleToggleApproval = async (actionId: ActionId, currentConfirmed: boolean) => {
    try {
      const res = await sendToBackground<
        TogglePlanActionApprovalRequest,
        TogglePlanActionApprovalResponse
      >({
        type: 'TOGGLE_PLAN_ACTION_APPROVAL',
        actionId,
        confirmed: !currentConfirmed,
      });

      if (res.success && res.plan) {
        setPlan(res.plan);
        if (onPlanUpdated) onPlanUpdated(res.plan);
      }
    } catch (err) {
      setFeedbackNotice(`Couldn't update that tick: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleStartEdit = (action: DryRunAction) => {
    setEditingActionId(action.id);
    setEditValue(action.candidateValueUsed);
  };

  const handleSaveEdit = async (actionId: ActionId) => {
    try {
      const res = await sendToBackground<
        UpdatePlanActionRequest,
        UpdatePlanActionResponse
      >({
        type: 'UPDATE_PLAN_ACTION',
        actionId,
        userValue: editValue,
      });

      if (res.success && res.plan) {
        setPlan(res.plan);
        if (onPlanUpdated) onPlanUpdated(res.plan);
        setEditingActionId(null);
        setFeedbackNotice('Saved and ticked.');
        setTimeout(() => setFeedbackNotice(null), 3000);
      }
    } catch (err) {
      setFeedbackNotice(`Couldn't save: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleExcludeAction = async (actionId: ActionId) => {
    try {
      const res = await sendToBackground<
        ExcludePlanActionRequest,
        ExcludePlanActionResponse
      >({
        type: 'EXCLUDE_PLAN_ACTION',
        actionId,
      });

      if (res.success && res.plan) {
        setPlan(res.plan);
        if (onPlanUpdated) onPlanUpdated(res.plan);
        setFeedbackNotice('Skipped.');
        setTimeout(() => setFeedbackNotice(null), 3000);
      }
    } catch (err) {
      setFeedbackNotice(`Couldn't skip it: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleExecuteSingleAction = async (actionId: ActionId) => {
    try {
      setExecutingActionId(actionId);
      const res = await sendToBackground<
        ExecuteSelectiveActionRequest,
        ExecuteSelectiveActionResponse
      >({
        type: 'EXECUTE_SELECTIVE_ACTION',
        actionId,
        options: { pacingDelayMs: 100, highlightElements: true },
      });

      if (res.success && res.report) {
        setFeedbackNotice('Filled.');
        setTimeout(() => setFeedbackNotice(null), 3000);
      } else {
        setFeedbackNotice(`Couldn't fill it: ${res.error || 'the field may have moved on the page.'}`);
      }
    } catch (err) {
      setFeedbackNotice(`Couldn't fill it: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setExecutingActionId(null);
    }
  };

  const handleExecutePlan = async () => {
    if (!plan || !plan.isApproved || isExecuting) return;

    try {
      setIsExecuting(true);
      setFeedbackNotice(null);

      const res = await sendToBackground<ExecutePlanRequest, ExecutePlanResponse>({
        type: 'EXECUTE_PLAN',
        planId: plan.id,
        options: {
          pacingDelayMs: 150,
          highlightElements: true,
        },
      });

      if (res.success && res.report) {
        setExecutionReport(res.report);
        setFeedbackNotice(null);
      } else {
        setFeedbackNotice(`Couldn't fill the form: ${res.error || 'try scanning it again.'}`);
      }
    } catch (err) {
      setFeedbackNotice(`Couldn't fill the form: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsExecuting(false);
    }
  };


  if (loading || !plan) {
    // Nothing to review until the candidate asks to check fields one by one; the form
    // panel above owns that action, so no competing empty state is shown here.
    return null;
  }

  const unconfirmedCount = plan.actions.filter((a) => !a.userConfirmed).length;
  const approvedCount = plan.actions.length - unconfirmedCount;
  const visibleActions = filter === 'unconfirmed' ? plan.actions.filter((a) => !a.userConfirmed) : plan.actions;

  return (
    <section className="ui-card ui-stack" style={{ gap: 10 }} aria-label="Check each field">
      <div className="ui-spread">
        <h2 className="ui-card-title">Check each field</h2>
        <span className="ui-subtle">
          {approvedCount} of {plan.actions.length} ready
        </span>
      </div>
      <p className="ui-subtle">
        Tick the answers you're happy with, edit any that are off, and skip the rest. Questions about work permits,
        visas or demographics always need your tick.
      </p>

      {feedbackNotice && <div className="ui-note" role="status">{feedbackNotice}</div>}

      {executionReport && (
        <div className={`ui-note ${executionReport.failedCount > 0 ? 'ui-note-warn' : 'ui-note-good'}`} role="status">
          Filled {executionReport.executedCount} of {executionReport.totalPlanned}.
          {executionReport.failedCount > 0 ? ` ${executionReport.failedCount} could not be filled, so fill those by hand.` : ''} Check
          the form, then press Submit on the page yourself.
        </div>
      )}
      {executionReport && onNavigateToTab && (
        <NextStep
          title="Press Submit on the page, then log it"
          hint="Mark it in the Tracker once it's sent, so follow-ups and interviews stay in one place."
          actionLabel="Log it in the Tracker"
          onAction={() => onNavigateToTab('track')}
        />
      )}

      <div className="ui-row">
        <button type="button" className="ui-btn ui-btn-sm" onClick={() => handleBatchApprove('low_risk_only')}>
          Tick the simple ones ({plan.stats.lowRiskCount})
        </button>
        <button type="button" className="ui-btn ui-btn-sm" onClick={handleAnswerCustomFields}>
          Draft answers to open questions
        </button>
        <button type="button" className="ui-link" onClick={() => setFilter(filter === 'unconfirmed' ? 'all' : 'unconfirmed')}>
          {filter === 'unconfirmed' ? 'Show all' : `Show only unticked (${unconfirmedCount})`}
        </button>
      </div>

      <ul className="ui-list">
        {visibleActions.map((action) => {
          const isEditing = editingActionId === action.id;
          const drafted = action.sourceEvidenceTitle?.startsWith('AI Proposal');
          return (
            <li
              key={action.id}
              onMouseEnter={() => handleHighlightField(action.action.selector, action.action.description)}
              onMouseLeave={handleClearHighlight}
            >
              <label className="ui-row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={action.userConfirmed}
                  onChange={() => handleToggleApproval(action.id, action.userConfirmed)}
                  style={{ marginTop: 3 }}
                />
                <span style={{ flex: 1 }}>
                  <span style={{ color: 'var(--text)' }}>{action.fieldLabel || action.action.description}</span>
                  {action.riskLevel === 'high' && <span className="ui-chip ui-chip-warn" style={{ marginLeft: 6 }}>Legal question</span>}
                  {drafted && <span className="ui-chip" style={{ marginLeft: 6 }}>Drafted from your resume</span>}
                </span>
              </label>

              {isEditing ? (
                <div className="ui-stack" style={{ gap: 6, marginTop: 6, marginLeft: 22 }}>
                  <textarea className="ui-textarea" value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus />
                  <div className="ui-row">
                    <button type="button" className="ui-btn ui-btn-sm ui-btn-primary" onClick={() => handleSaveEdit(action.id)}>
                      Save
                    </button>
                    <button type="button" className="ui-btn ui-btn-sm" onClick={() => setEditingActionId(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="ui-text" style={{ marginLeft: 22, marginTop: 2 }}>
                  {action.candidateValueUsed || <span className="ui-subtle">Nothing yet</span>}
                </p>
              )}

              {!isEditing && (
                <div className="ui-row" style={{ marginLeft: 22, marginTop: 4, gap: 12 }}>
                  <button type="button" className="ui-link" onClick={() => handleStartEdit(action)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="ui-link"
                    disabled={executingActionId === action.id || isExecuting}
                    onClick={() => handleExecuteSingleAction(action.id)}
                  >
                    {executingActionId === action.id ? 'Filling...' : 'Fill just this'}
                  </button>
                  <button type="button" className="ui-link" onClick={() => handleHighlightField(action.action.selector, action.action.description)}>
                    Show on page
                  </button>
                  <button type="button" className="ui-link" onClick={() => handleExcludeAction(action.id)}>
                    Skip
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {plan.skippedFields.length > 0 && (
        <details className="ui-details">
          <summary>Not filled ({plan.skippedFields.length})</summary>
          <ul className="ui-list">
            {plan.skippedFields.map((field) => (
              <li key={field.fieldId}>
                <span style={{ color: 'var(--text)' }}>{field.label || 'Unnamed field'}</span>
                <p className="ui-subtle">{field.description}</p>
              </li>
            ))}
          </ul>
        </details>
      )}

      <button
        type="button"
        className="ui-btn ui-btn-primary ui-btn-block"
        disabled={isExecuting || approvedCount === 0 || !plan.isApproved}
        onClick={handleExecutePlan}
      >
        {isExecuting ? 'Filling...' : plan.isApproved ? `Fill ${approvedCount} ticked field${approvedCount === 1 ? '' : 's'}` : `Tick or skip ${unconfirmedCount} more to continue`}
      </button>
      <div className="ui-row" style={{ justifyContent: 'space-between' }}>
        <button type="button" className="ui-link" onClick={() => handleBatchApprove('reset')}>
          Untick everything
        </button>
        <button type="button" className="ui-link" onClick={handleToggleInPageOverlay}>
          {inPageOverlayActive ? 'Hide labels on the page' : 'Label fields on the page'}
        </button>
      </div>
    </section>
  );
};
