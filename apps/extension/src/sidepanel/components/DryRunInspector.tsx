/**
 * @fileoverview Dry Run Plan Inspector for Side Panel UI.
 *
 * Implements candidate review interface for planned browser actions (ADR-0003, ADR-0006):
 * - Displays before/after diffs comparing DOM input state with candidate profile values.
 * - Risk stratification badges (Low, Medium, High).
 * - Human-in-the-loop approval toggles for high-risk and sensitive compliance questions.
 * - Inline edit overrides permitting candidates to alter proposed values prior to execution.
 * - Anti-Autonomous Submit Gate assurance confirming submit buttons are blocked.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { DryRunPlan, DryRunAction, ActionId, ExecutionReport } from '@applykit/domain';
import { sendToBackground } from '../../messages/bridge.js';
import type {
  GetActivePlanRequest,
  GetActivePlanResponse,
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

type ActionFilter = 'all' | 'unconfirmed' | 'high_risk' | 'skipped';

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
            ? `In-page preview overlay active: ${res.count ?? 0} field badge(s) displayed on webpage.`
            : 'In-page preview badges removed from webpage.'
        );
        setTimeout(() => setFeedbackNotice(null), 3000);
      }
    } catch (err) {
      setFeedbackNotice(`Overlay error: ${err instanceof Error ? err.message : String(err)}`);
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
          setFeedbackNotice('All low-risk fields approved. High-risk fields require individual confirmation.');
        } else if (mode === 'all') {
          setFeedbackNotice('All proposed actions approved.');
        } else {
          setFeedbackNotice('Approvals reset to initial safety thresholds.');
        }
        setTimeout(() => setFeedbackNotice(null), 3000);
      }
    } catch (err) {
      setFeedbackNotice(`Batch approval failed: ${err instanceof Error ? err.message : String(err)}`);
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
      setFeedbackNotice(`Failed to update approval: ${err instanceof Error ? err.message : String(err)}`);
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
        setFeedbackNotice('Planned value updated and confirmed.');
        setTimeout(() => setFeedbackNotice(null), 3000);
      }
    } catch (err) {
      setFeedbackNotice(`Failed to save edit: ${err instanceof Error ? err.message : String(err)}`);
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
        setFeedbackNotice('Action excluded from execution plan.');
        setTimeout(() => setFeedbackNotice(null), 3000);
      }
    } catch (err) {
      setFeedbackNotice(`Failed to exclude action: ${err instanceof Error ? err.message : String(err)}`);
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
        setFeedbackNotice(`Single field filled safely (${res.report.durationMs}ms).`);
        setTimeout(() => setFeedbackNotice(null), 3000);
      } else {
        setFeedbackNotice(`Field execution error: ${res.error || 'Failed to fill field.'}`);
      }
    } catch (err) {
      setFeedbackNotice(`Field fill failed: ${err instanceof Error ? err.message : String(err)}`);
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
        setFeedbackNotice(
          `Execution finished: ${res.report.executedCount} action(s) executed safely. Anti-Autonomous Submit Gate reached.`
        );
      } else {
        setFeedbackNotice(`Execution failed: ${res.error || 'Unknown execution error.'}`);
      }
    } catch (err) {
      setFeedbackNotice(`Execution request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsExecuting(false);
    }
  };

  if (loading) {
    return <div className="dry-run-loading">Loading planned actions...</div>;
  }

  if (!plan) {
    return (
      <div className="dry-run-empty-state">
        <div className="empty-state-icon">&#128203;</div>
        <h3 className="empty-state-title">No Dry Run Plan Generated</h3>
        <p className="empty-state-desc">
          Inspect a job application form first on the <strong>Form</strong> tab, then click &quot;Generate Dry Run Plan&quot; to review proposed actions.
        </p>
        {onNavigateToTab && (
          <button
            type="button"
            className="btn-primary"
            onClick={() => onNavigateToTab('form')}
          >
            Go to Form Inspector
          </button>
        )}
      </div>
    );
  }

  const filteredActions = plan.actions.filter((action) => {
    if (filter === 'unconfirmed') return !action.userConfirmed;
    if (filter === 'high_risk') return action.riskLevel === 'high';
    return true;
  });

  const unconfirmedCount = plan.actions.filter((a) => !a.userConfirmed).length;

  return (
    <div className="dry-run-container">
      {/* Header */}
      <div className="dry-run-header">
        <div>
          <h2 className="section-title">Dry Run Execution Plan</h2>
          <p className="section-subtitle">
            Review and adjust proposed form actions before execution (ADR-0003).
          </p>
        </div>
        <span
          className={`plan-status-pill ${
            plan.isApproved ? 'plan-status-approved' : 'plan-status-pending'
          }`}
        >
          {plan.isApproved ? 'All Actions Approved' : `${unconfirmedCount} Require Approval`}
        </span>
      </div>

      {feedbackNotice && (
        <div className="alert-feedback" role="alert">
          <span>{feedbackNotice}</span>
        </div>
      )}

      {/* Execution Report Card */}
      {executionReport && (
        <div className="execution-report-card">
          <div className="execution-report-header">
            <span className="report-badge report-badge-success">&#10003; EXECUTION COMPLETED</span>
            <span className="report-duration">{executionReport.durationMs}ms</span>
          </div>
          <div className="execution-metrics-grid">
            <div className="report-metric">
              <span className="report-metric-num">{executionReport.executedCount}</span>
              <span className="report-metric-label">Fields Filled</span>
            </div>
            <div className="report-metric">
              <span className="report-metric-num">{executionReport.failedCount}</span>
              <span className="report-metric-label">Failures</span>
            </div>
            <div className="report-metric">
              <span className="report-metric-num">{executionReport.totalPlanned}</span>
              <span className="report-metric-label">Planned</span>
            </div>
          </div>

          <div className="execution-gate-alert">
            <div className="gate-alert-icon">&#128737;</div>
            <div className="gate-alert-text">
              <strong>Anti-Autonomous Submit Gate Reached</strong>
              <p>
                All approved candidate information has been filled into the form. In accordance
                with safety invariants (ADR-0006), ApplyKit has halted before the submission button.
                Please review the filled page and submit manually.
              </p>
            </div>
          </div>

          {executionReport.failedActions.length > 0 && (
            <div className="execution-failures-list">
              <h4 className="failures-title">Failed Actions ({executionReport.failedActions.length})</h4>
              {executionReport.failedActions.map((fail) => (
                <div key={fail.actionId} className="failure-item">
                  <code className="failure-selector">{fail.selector}</code>
                  <span className="failure-reason">{fail.error}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Plan Summary Card */}
      <div className="plan-summary-card">
        <div className="plan-meta-grid">
          <div className="meta-col">
            <span className="meta-label">ATS Vendor</span>
            <span className="meta-badge ats-badge">{plan.detectedAts.toUpperCase()}</span>
          </div>
          <div className="meta-col">
            <span className="meta-label">Total Actions</span>
            <span className="meta-value">{plan.actions.length}</span>
          </div>
          <div className="meta-col">
            <span className="meta-label">Low Risk</span>
            <span className="meta-value risk-low-text">{plan.stats.lowRiskCount}</span>
          </div>
          <div className="meta-col">
            <span className="meta-label">High Risk</span>
            <span className="meta-value risk-high-text">{plan.stats.highRiskCount}</span>
          </div>
        </div>
      </div>

      {/* Anti-Autonomous Submit Gate Banner (ADR-0006) */}
      <div className="submit-gate-card">
        <div className="gate-icon">&#128737;</div>
        <div className="gate-content">
          <div className="gate-header">
            <h3 className="gate-title">Anti-Autonomous Submit Gate: Active</h3>
            <span className="gate-status-pill">100% Protected</span>
          </div>
          <p className="gate-description">
            Zero submit buttons will be clicked automatically. Execution automatically stops
            prior to final submission, leaving the final decision exclusively with you.
          </p>
          {plan.submitButtonSelector && (
            <div className="gate-target">
              <span className="gate-target-label">Protected Submit Button:</span>
              <code className="gate-target-selector">{plan.submitButtonSelector}</code>
            </div>
          )}
        </div>
      </div>

      {/* Batch Actions & In-Page Overlay Toolbar (ADR-0017) */}
      <div className="batch-actions-bar">
        <div className="batch-btn-group">
          <button
            type="button"
            className="btn-batch btn-batch-low-risk"
            onClick={() => handleBatchApprove('low_risk_only')}
            title="Approve all low-risk contact and identity fields"
          >
            Approve Low-Risk ({plan.stats.lowRiskCount})
          </button>
          <button
            type="button"
            className="btn-batch btn-batch-all"
            onClick={() => handleBatchApprove('all')}
            title="Approve all fields including high-risk disclosures"
          >
            Approve All
          </button>
          <button
            type="button"
            className="btn-batch btn-batch-reset"
            onClick={() => handleBatchApprove('reset')}
            title="Reset approvals back to initial safety requirements"
          >
            Reset
          </button>
        </div>
        <button
          type="button"
          className={`btn-toggle-overlay ${inPageOverlayActive ? 'overlay-active' : ''}`}
          onClick={handleToggleInPageOverlay}
          title="Toggle floating candidate data preview badges on the webpage"
        >
          {inPageOverlayActive ? 'Hide In-Page Badges' : 'Show In-Page Badges'}
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="plan-filter-bar">
        <div className="filter-chips">
          <button
            type="button"
            className={`filter-btn ${filter === 'all' ? 'filter-btn-active' : ''}`}
            onClick={() => setFilter('all')}
          >
            All Actions ({plan.actions.length})
          </button>
          <button
            type="button"
            className={`filter-btn ${filter === 'unconfirmed' ? 'filter-btn-active' : ''}`}
            onClick={() => setFilter('unconfirmed')}
          >
            Needs Approval ({unconfirmedCount})
          </button>
          <button
            type="button"
            className={`filter-btn ${filter === 'high_risk' ? 'filter-btn-active' : ''}`}
            onClick={() => setFilter('high_risk')}
          >
            High Risk ({plan.stats.highRiskCount})
          </button>
          <button
            type="button"
            className={`filter-btn ${filter === 'skipped' ? 'filter-btn-active' : ''}`}
            onClick={() => setFilter('skipped')}
          >
            Skipped ({plan.skippedFields.length})
          </button>
        </div>
      </div>

      {/* Action Cards or Skipped Fields List */}
      {filter === 'skipped' ? (
        <div className="skipped-fields-list">
          {plan.skippedFields.length === 0 ? (
            <div className="empty-fields">No fields were skipped.</div>
          ) : (
            plan.skippedFields.map((field) => (
              <div key={field.fieldId} className="skipped-card">
                <div className="skipped-card-header">
                  <span className="skipped-label">{field.label || '(Unnamed Field)'}</span>
                  <span className={`skipped-reason-pill reason-${field.reason}`}>
                    {field.reason.replace(/_/g, ' ')}
                  </span>
                </div>
                <code className="field-selector-code">{field.selector}</code>
                <p className="skipped-desc">{field.description}</p>
              </div>
            ))
          )}
        </div>
      ) : (
        <div className="actions-list">
          {filteredActions.length === 0 ? (
            <div className="empty-fields">No actions match current filter.</div>
          ) : (
            filteredActions.map((action) => {
              const isEditing = editingActionId === action.id;

              return (
                <div
                  key={action.id}
                  className={`action-diff-card ${
                    !action.userConfirmed ? 'card-requires-confirmation' : ''
                  }`}
                  onMouseEnter={() =>
                    handleHighlightField(action.action.selector, action.action.description)
                  }
                  onMouseLeave={handleClearHighlight}
                >
                  <div className="action-card-header">
                    <div className="action-title-group">
                      <span className="action-type-tag">{action.action.actionType}</span>
                      <span className="action-target-label">
                        {action.action.description}
                      </span>
                    </div>
                    <span
                      className={`risk-badge risk-${action.riskLevel}`}
                      title={`Risk Level: ${action.riskLevel}`}
                    >
                      {action.riskLevel.toUpperCase()} RISK
                    </span>
                  </div>

                  <div className="action-selector-preview">
                    <code className="field-selector-code">{action.action.selector}</code>
                  </div>

                  {/* Ground Truth Source Evidence Citation (ADR-0001) */}
                  {action.sourceEvidenceTitle && (
                    <div className="action-evidence-citation">
                      <span className="citation-icon">&#128279;</span>
                      <span className="citation-text">Grounding: {action.sourceEvidenceTitle}</span>
                    </div>
                  )}

                  {/* High-Risk Dedicated Warning Banner */}
                  {action.riskLevel === 'high' && (
                    <div className="high-risk-alert-box">
                      <span className="alert-icon">&#9888;</span>
                      <span className="alert-text">
                        <strong>Legal / Demographic Disclosure:</strong> Please carefully verify
                        this answer before confirming.
                      </span>
                    </div>
                  )}

                  {/* Before / After Diff */}
                  <div className="diff-container">
                    <div className="diff-row diff-before">
                      <span className="diff-tag">CURRENT IN DOM:</span>
                      <span className="diff-text">
                        {action.currentValue ? action.currentValue : '(Empty)'}
                      </span>
                    </div>
                    <div className="diff-row diff-after">
                      <span className="diff-tag">PROPOSED VALUE:</span>
                      {isEditing ? (
                        <div className="inline-edit-box">
                          <input
                            type="text"
                            className="inline-edit-input"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            autoFocus
                          />
                          <div className="inline-edit-actions">
                            <button
                              type="button"
                              className="btn-edit-save"
                              onClick={() => handleSaveEdit(action.id)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="btn-edit-cancel"
                              onClick={() => setEditingActionId(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="diff-value-display">
                          <span className="diff-text diff-text-proposed">
                            {action.candidateValueUsed}
                          </span>
                          <button
                            type="button"
                            className="btn-link-edit"
                            onClick={() => handleStartEdit(action)}
                          >
                            Edit
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  <p className="diff-explanation">{action.diffExplanation}</p>

                  {/* Confirmation and Actions Bar */}
                  <div className="action-footer-bar">
                    <label className="action-confirm-toggle">
                      <input
                        type="checkbox"
                        checked={action.userConfirmed}
                        onChange={() =>
                          handleToggleApproval(action.id, action.userConfirmed)
                        }
                      />
                      <span className="toggle-label">
                        {action.userConfirmed
                          ? 'Approved for execution'
                          : 'Confirm & approve this action'}
                      </span>
                    </label>

                    <div className="action-card-btns">
                      <button
                        type="button"
                        className="btn-link-locate"
                        onClick={() =>
                          handleHighlightField(
                            action.action.selector,
                            action.action.description
                          )
                        }
                        title="Locate and focus this field on the live webpage"
                      >
                        Locate
                      </button>
                      <button
                        type="button"
                        className="btn-link-fill-single"
                        disabled={executingActionId === action.id || isExecuting}
                        onClick={() => handleExecuteSingleAction(action.id)}
                        title="Fill only this specific field on the active webpage"
                      >
                        {executingActionId === action.id ? 'Filling...' : 'Fill Field'}
                      </button>
                      <button
                        type="button"
                        className="btn-link-exclude"
                        onClick={() => handleExcludeAction(action.id)}
                        title="Skip this field from automated filling"
                      >
                        Skip
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Plan Action Footer */}
      <div className="dry-run-footer">
        <div className="footer-status-summary">
          <span>
            {unconfirmedCount === 0 ? (
              <strong className="text-success">&#10003; All actions approved and ready</strong>
            ) : (
              <span className="text-warning">&#9888; {unconfirmedCount} action(s) require confirmation</span>
            )}
          </span>
        </div>
        <div className="footer-buttons-group">
          {onNavigateToTab && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onNavigateToTab('form')}
            >
              Back to Form
            </button>
          )}
          <button
            type="button"
            className="btn-primary"
            disabled={!plan.isApproved || isExecuting}
            title={
              plan.isApproved
                ? 'Proceed to execution'
                : 'Approve all actions before executing'
            }
            onClick={handleExecutePlan}
          >
            {isExecuting
              ? 'Executing Actions...'
              : plan.isApproved
              ? 'Execute Approved Actions'
              : 'Approve Actions to Execute'}
          </button>
        </div>
      </div>
    </div>
  );
};
