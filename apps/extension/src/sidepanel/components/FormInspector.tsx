/**
 * @fileoverview Application Form Inspector for Side Panel UI.
 *
 * Implements form inspection and field classification interface (ADR-0003, ADR-0006):
 * - Deterministic DOM inspection of active tab application forms.
 * - Automatic classification of inputs against canonical candidate profile schema.
 * - Anti-Autonomous Submit Gate highlighting that submission buttons are blocked.
 * - Honeypot anti-bot trap flagging to protect candidate submissions.
 * - Value mapping preview directly from CandidateProfile without hallucination.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  ApplicationForm,
  ApplicationField,
  CandidateProfile,
} from '@applykit/domain';
import {
  getFormUnmappedRequiredFields,
  isFormReadyForDryRun,
  resolveProfileValueForField,
} from '@applykit/domain';
import { sendToBackground } from '../../messages/bridge.js';
import type {
  InspectPageFormsRequest,
  InspectPageFormsResponse,
  GetCandidateProfileRequest,
  GetCandidateProfileResponse,
  GenerateDryRunPlanRequest,
  GenerateDryRunPlanResponse,
  ExecuteOneClickAutoFillRequest,
  ExecuteOneClickAutoFillResponse,
} from '../../messages/contracts.js';
import type { TabId } from './NavigationTabs.js';
import { InstantQuestionSolver } from './InstantQuestionSolver.js';

interface FormInspectorProps {
  onNavigateToTab?: (tab: TabId) => void;
}

type FieldFilter = 'all' | 'required' | 'unmapped' | 'honeypots';

/**
 * Form Inspector component displaying detected application fields, ATS metadata,
 * Anti-Autonomous Submit status, and candidate profile value previews.
 */
export const FormInspector: React.FC<FormInspectorProps> = ({ onNavigateToTab }) => {
  const [forms, setForms] = useState<readonly ApplicationForm[]>([]);
  const [selectedFormIndex, setSelectedFormIndex] = useState<number>(0);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [autoFillNotice, setAutoFillNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
  const [filter, setFilter] = useState<FieldFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [isPlanning, setIsPlanning] = useState(false);

  // Fetch candidate profile for value resolution preview
  const loadProfile = useCallback(async () => {
    try {
      const res = await sendToBackground<GetCandidateProfileRequest, GetCandidateProfileResponse>({
        type: 'GET_CANDIDATE_PROFILE',
      });
      if (res && res.profile) {
        setProfile(res.profile);
      }
    } catch {
      // Profile may not be created yet; fallback gracefully
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleInspect = async () => {
    setIsInspecting(true);
    setError(null);

    try {
      const res = await sendToBackground<InspectPageFormsRequest, InspectPageFormsResponse>({
        type: 'INSPECT_PAGE_FORMS',
      });

      if (res.success && res.forms && res.forms.length > 0) {
        setForms(res.forms);
        setSelectedFormIndex(0);
      } else {
        setForms([]);
        setError(res.error || 'No job application form detected on the active webpage.');
      }
    } catch (err) {
      setForms([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsInspecting(false);
    }
  };

  const handleGeneratePlan = async () => {
    if (!activeForm) return;
    setIsPlanning(true);
    setError(null);

    try {
      const res = await sendToBackground<
        GenerateDryRunPlanRequest,
        GenerateDryRunPlanResponse
      >({
        type: 'GENERATE_DRY_RUN_PLAN',
        form: activeForm as ApplicationForm,
      });

      if (res.success && res.plan) {
        if (onNavigateToTab) {
          onNavigateToTab('dry_run');
        }
      } else {
        setError(res.error || 'Failed to generate dry run plan.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsPlanning(false);
    }
  };

  const handleOneClickAutoFill = async () => {
    if (!activeForm) return;
    setIsAutoFilling(true);
    setAutoFillNotice(null);
    setError(null);

    try {
      const res = await sendToBackground<
        ExecuteOneClickAutoFillRequest,
        ExecuteOneClickAutoFillResponse
      >({
        type: 'EXECUTE_ONE_CLICK_AUTO_FILL',
        form: activeForm as ApplicationForm,
        options: {
          pacingDelayMs: 150,
          highlightElements: true,
        },
      });

      if (res.success && res.report) {
        setAutoFillNotice(
          `⚡ 1-Click Auto-Fill complete! ${res.report.executedCount} safe field(s) filled in sequence. Halting strictly at Anti-Autonomous Submit Gate for your manual review.`
        );
      } else {
        setError(res.error || 'Auto-fill encountered an issue.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAutoFilling(false);
    }
  };

  const activeForm = forms[selectedFormIndex] ?? null;
  const unmappedFields = activeForm ? getFormUnmappedRequiredFields(activeForm) : [];
  const readyForDryRun = activeForm ? isFormReadyForDryRun(activeForm) : false;

  // Filter and search fields
  const filteredFields = activeForm
    ? activeForm.fields.filter((field) => {
        if (filter === 'required' && !field.isRequired) return false;
        if (filter === 'unmapped') {
          const isUnmapped = field.isRequired && (!field.inferredMappingKey || field.confidenceScore < 0.5);
          if (!isUnmapped) return false;
        }
        if (filter === 'honeypots' && !field.isHoneypotSuspect) return false;

        if (searchTerm.trim().length > 0) {
          const term = searchTerm.toLowerCase();
          const matchLabel = field.label.toLowerCase().includes(term);
          const matchKey = (field.inferredMappingKey || '').toLowerCase().includes(term);
          const matchSelector = field.selector.toLowerCase().includes(term);
          return matchLabel || matchKey || matchSelector;
        }
        return true;
      })
    : [];

  const honeypotCount = activeForm
    ? activeForm.fields.filter((f) => f.isHoneypotSuspect).length
    : 0;

  return (
    <div className="form-inspector-container">
      {/* Action Header */}
      <div className="inspector-header">
        <div>
          <h2 className="section-title">Application Form Inspector</h2>
          <p className="section-subtitle">
            Inspect active page inputs, verify candidate mappings, and enforce submission safety.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary btn-inspect"
          disabled={isInspecting}
          onClick={handleInspect}
        >
          {isInspecting ? 'Inspecting DOM...' : 'Inspect Page Form'}
        </button>
      </div>

      {error && (
        <div className="alert-error" role="alert">
          <p className="alert-title">Inspection Notice</p>
          <p className="alert-message">{error}</p>
        </div>
      )}

      {autoFillNotice && (
        <div className="alert-autofill-success" role="status">
          <p className="alert-title">⚡ 1-Click Auto-Fill</p>
          <p className="alert-message">{autoFillNotice}</p>
        </div>
      )}

      {activeForm ? (
        <div className="form-details-wrapper">
          {/* 1-Click Auto-Fill Hero Banner */}
          <div className="one-click-autofill-banner">
            <div className="autofill-banner-text">
              <span className="autofill-banner-title">⚡ 1-Click Complete Auto-Fill</span>
              <span className="autofill-banner-sub">
                Answers custom questions with AI, matches your verified profile, and fills all safe inputs sequentially. Strictly halts before submit.
              </span>
            </div>
            <button
              type="button"
              className="btn-one-click-autofill"
              disabled={isAutoFilling || activeForm.fields.length === 0}
              onClick={handleOneClickAutoFill}
            >
              {isAutoFilling ? '⚡ Filling All Fields...' : '⚡ 1-Click Auto-Fill'}
            </button>
          </div>

          {/* Instant Question Solver */}
          <InstantQuestionSolver className="inspector-instant-solver" />

          {/* Form Selector (if multiple forms on page) */}
          {forms.length > 1 && (
            <div className="multi-form-tabs">
              <span className="multi-form-label">Multiple Forms Detected:</span>
              <div className="form-chip-group">
                {forms.map((form, idx) => (
                  <button
                    key={form.id}
                    type="button"
                    className={`form-chip ${idx === selectedFormIndex ? 'form-chip-active' : ''}`}
                    onClick={() => setSelectedFormIndex(idx)}
                  >
                    Form #{idx + 1} ({form.detectedAts})
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Form Metadata Banner */}
          <div className="form-meta-card">
            <div className="meta-row">
              <div className="meta-col">
                <span className="meta-label">ATS Platform</span>
                <span className={`meta-badge ats-badge ats-badge-${activeForm.detectedAts}`}>
                  {activeForm.detectedAts.toUpperCase()}
                </span>
              </div>
              <div className="meta-col">
                <span className="meta-label">Total Inputs</span>
                <span className="meta-value">{activeForm.fields.length}</span>
              </div>
              <div className="meta-col">
                <span className="meta-label">Required</span>
                <span className="meta-value">
                  {activeForm.fields.filter((f) => f.isRequired).length}
                </span>
              </div>
              <div className="meta-col">
                <span className="meta-label">Status</span>
                <span className={`meta-badge ${readyForDryRun ? 'status-ready' : 'status-pending'}`}>
                  {readyForDryRun ? 'Ready for Dry Run' : `${unmappedFields.length} Unmapped`}
                </span>
              </div>
            </div>
          </div>

          {/* Authentication Barrier Warning (e.g. Workday Login Gate) */}
          {activeForm.authBarrier?.isBlocked && (
            <div className="auth-barrier-card">
              <div className="auth-barrier-header">
                <span className="auth-barrier-icon">&#128274;</span>
                <h4 className="auth-barrier-title">Authentication Barrier Detected</h4>
              </div>
              <p className="auth-barrier-text">{activeForm.authBarrier.message}</p>
              {activeForm.authBarrier.signInButtonSelector && (
                <div className="auth-barrier-action">
                  <span className="auth-barrier-label">Sign-In Control:</span>
                  <code>{activeForm.authBarrier.signInButtonSelector}</code>
                </div>
              )}
            </div>
          )}

          {/* Multi-Step Wizard Progression Banner */}
          {activeForm.stepProgression?.isMultiStep && (
            <div className="wizard-progression-card">
              <div className="wizard-progression-header">
                <span className="wizard-step-badge">
                  Step {activeForm.stepProgression.currentStepIndex} of {activeForm.stepProgression.totalSteps}
                </span>
                {activeForm.stepProgression.stepName && (
                  <span className="wizard-step-name">{activeForm.stepProgression.stepName}</span>
                )}
                {activeForm.stepProgression.isFinalStep ? (
                  <span className="wizard-final-pill">Final Review Step</span>
                ) : (
                  <span className="wizard-inter-pill">Step Navigation</span>
                )}
              </div>
              {activeForm.stepProgression.nextStepButtonSelector && (
                <div className="wizard-next-step">
                  <span className="wizard-next-label">Next Step Progression:</span>
                  <code>{activeForm.stepProgression.nextStepButtonSelector}</code>
                </div>
              )}
            </div>
          )}

          {/* Active ATS Validation Errors */}
          {activeForm.validationErrors && activeForm.validationErrors.length > 0 && (
            <div className="ats-validation-errors-card">
              <h4 className="validation-errors-title">
                {activeForm.validationErrors.length} ATS Validation Notice{activeForm.validationErrors.length > 1 ? 's' : ''}
              </h4>
              <ul className="validation-errors-list">
                {activeForm.validationErrors.map((err, idx) => (
                  <li key={idx} className="validation-error-item">
                    {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Action Trigger: 1-Click Auto-Fill or Dry Run Plan */}
          <div className="plan-trigger-card">
            <div className="plan-trigger-buttons">
              <button
                type="button"
                className="btn-one-click-hero"
                disabled={isAutoFilling || activeForm.fields.length === 0}
                onClick={handleOneClickAutoFill}
              >
                {isAutoFilling ? '⚡ Auto-Filling All Fields...' : '⚡ 1-Click Auto-Fill (All Safe Fields)'}
              </button>
              <button
                type="button"
                className="btn-secondary btn-generate-plan"
                disabled={isPlanning || isAutoFilling || activeForm.fields.length === 0}
                onClick={handleGeneratePlan}
              >
                {isPlanning ? 'Formulating Plan...' : 'Review Dry Run Plan First'}
              </button>
            </div>
            <p className="plan-trigger-hint">
              1-Click Auto-Fill fills all safe fields in human-paced sequence and halts strictly before submit (Anti-Autonomous Submit Gate).
            </p>
          </div>

          {/* Anti-Autonomous Submit Gate Card (Invariant: ADR-0006) */}
          <div className="submit-gate-card">
            <div className="gate-icon">&#128737;</div>
            <div className="gate-content">
              <div className="gate-header">
                <h3 className="gate-title">Anti-Autonomous Submit Gate Active</h3>
                <span className="gate-status-pill">ADR-0006 Compliant</span>
              </div>
              <p className="gate-description">
                ApplyKit is programmatically forbidden from clicking application submit buttons.
                Form automation stops after filling safe inputs; you review and submit manually.
              </p>
              {activeForm.submitButtonSelector ? (
                <div className="gate-target">
                  <span className="gate-target-label">Protected Submit Control:</span>
                  <code className="gate-target-selector">{activeForm.submitButtonSelector}</code>
                </div>
              ) : (
                <p className="gate-no-target">No submit button identified on this form container.</p>
              )}
            </div>
          </div>

          {/* Honeypot Alert Warning */}
          {honeypotCount > 0 && (
            <div className="honeypot-alert-card">
              <div className="honeypot-alert-header">
                <span className="honeypot-alert-icon">&#9888;</span>
                <h4 className="honeypot-alert-title">
                  {honeypotCount} Honeypot Trap{honeypotCount > 1 ? 's' : ''} Flagged
                </h4>
              </div>
              <p className="honeypot-alert-text">
                Hidden anti-bot form inputs were detected. These fields will be strictly skipped during
                form filling to avoid triggering automated application rejection.
              </p>
            </div>
          )}

          {/* Unmapped Required Fields Banner */}
          {unmappedFields.length > 0 && (
            <div className="unmapped-warning-card">
              <h4 className="unmapped-warning-title">
                {unmappedFields.length} Mandatory Field{unmappedFields.length > 1 ? 's' : ''} Need Attention
              </h4>
              <p className="unmapped-warning-text">
                The following required fields have low confidence or no candidate profile data:
              </p>
              <ul className="unmapped-list">
                {unmappedFields.map((f) => (
                  <li key={f.id} className="unmapped-item">
                    <strong>{f.label}</strong> (<code>{f.selector}</code>)
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Field Filters & Search */}
          <div className="fields-control-bar">
            <div className="filter-chips">
              <button
                type="button"
                className={`filter-btn ${filter === 'all' ? 'filter-btn-active' : ''}`}
                onClick={() => setFilter('all')}
              >
                All ({activeForm.fields.length})
              </button>
              <button
                type="button"
                className={`filter-btn ${filter === 'required' ? 'filter-btn-active' : ''}`}
                onClick={() => setFilter('required')}
              >
                Required ({activeForm.fields.filter((f) => f.isRequired).length})
              </button>
              <button
                type="button"
                className={`filter-btn ${filter === 'unmapped' ? 'filter-btn-active' : ''}`}
                onClick={() => setFilter('unmapped')}
              >
                Unmapped ({unmappedFields.length})
              </button>
              {honeypotCount > 0 && (
                <button
                  type="button"
                  className={`filter-btn ${filter === 'honeypots' ? 'filter-btn-active' : ''}`}
                  onClick={() => setFilter('honeypots')}
                >
                  Honeypots ({honeypotCount})
                </button>
              )}
            </div>

            <input
              type="text"
              placeholder="Search fields or selectors..."
              className="fields-search-input"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Fields List */}
          <div className="fields-list-container">
            {filteredFields.length === 0 ? (
              <div className="empty-fields">No matching fields found.</div>
            ) : (
              filteredFields.map((field) => (
                <FieldInspectionCard
                  key={field.id}
                  field={field}
                  profile={profile}
                />
              ))
            )}
          </div>
        </div>
      ) : (
        <div className="form-empty-state">
          <div className="empty-state-icon">&#128221;</div>
          <h3 className="empty-state-title">Ready to Inspect Application</h3>
          <p className="empty-state-desc">
            Open an ATS job application page (Greenhouse, Lever, Workday, Ashby, etc.) in your browser
            and click <strong>&quot;Inspect Page Form&quot;</strong> above.
          </p>
          <div className="empty-state-bullets">
            <div className="bullet-point">
              <span className="bullet-check">&#10003;</span>
              <span>Classifies inputs (name, email, phone, resume, links, work authorization)</span>
            </div>
            <div className="bullet-point">
              <span className="bullet-check">&#10003;</span>
              <span>Identifies honeypot traps to prevent anti-bot disqualification</span>
            </div>
            <div className="bullet-point">
              <span className="bullet-check">&#10003;</span>
              <span>Locks down submit controls to guarantee manual review</span>
            </div>
          </div>

          {/* Pipeline Forward Progression Card */}
          <div className="pipeline-next-step-card">
            <div className="next-step-info">
              <span className="next-step-title">Form Filled &amp; Verified?</span>
              <span className="next-step-desc">
                Review your answers on the page, manually click send/submit, and track this application.
              </span>
            </div>
            <button
              type="button"
              className="btn-primary btn-next-step"
              onClick={() => onNavigateToTab?.('history')}
            >
              Next Step: Application Tracker &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

interface FieldInspectionCardProps {
  field: ApplicationField;
  profile: CandidateProfile | null;
}

/**
 * Individual field inspection card showing selector, mapping, confidence, and preview value.
 */
const FieldInspectionCard: React.FC<FieldInspectionCardProps> = ({ field, profile }) => {
  const profileValue = profile && field.inferredMappingKey
    ? resolveProfileValueForField(profile, field.inferredMappingKey)
    : undefined;

  const confidencePct = Math.round((field.confidenceScore || 0) * 100);

  return (
    <div className={`field-card ${field.isHoneypotSuspect ? 'field-card-honeypot' : ''}`}>
      <div className="field-card-header">
        <div className="field-label-group">
          <span className="field-label-text">{field.label || '(Unnamed Input)'}</span>
          {field.isRequired && <span className="field-required-badge">Required</span>}
          {field.isHoneypotSuspect && (
            <span className="field-honeypot-badge">&#9888; Honeypot Trap</span>
          )}
        </div>
        <div className="field-type-pill">{field.fieldType}</div>
      </div>

      <div className="field-selector-row">
        <span className="selector-label">Selector:</span>
        <code className="field-selector-code">{field.selector}</code>
      </div>

      <div className="field-mapping-row">
        <div className="mapping-col">
          <span className="mapping-label">Mapped Attribute</span>
          <span className="mapping-value">
            {field.inferredMappingKey || 'unclassified'}
          </span>
        </div>
        <div className="mapping-col">
          <span className="mapping-label">Confidence</span>
          <span
            className={`confidence-pill ${
              confidencePct >= 80 ? 'conf-high' : confidencePct >= 50 ? 'conf-mid' : 'conf-low'
            }`}
          >
            {confidencePct}%
          </span>
        </div>
      </div>

      {/* Value Preview */}
      <div className="field-value-preview">
        <span className="value-preview-label">Candidate Value Preview:</span>
        {field.isHoneypotSuspect ? (
          <span className="value-skipped">(Will be skipped — Anti-Bot Honeypot)</span>
        ) : profileValue ? (
          <span className="value-preview-text">{profileValue}</span>
        ) : (
          <span className="value-empty">(No profile data populated)</span>
        )}
      </div>

      {/* Options preview for dropdowns / radio groups */}
      {field.options && field.options.length > 0 && (
        <div className="field-options-container">
          <span className="options-title">Available Options ({field.options.length}):</span>
          <div className="options-chips">
            {field.options.slice(0, 6).map((opt) => (
              <span key={opt.value} className="option-chip" title={`Value: ${opt.value}`}>
                {opt.label}
              </span>
            ))}
            {field.options.length > 6 && (
              <span className="option-chip-more">+{field.options.length - 6} more</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
