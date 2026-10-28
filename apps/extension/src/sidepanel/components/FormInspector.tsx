/**
 * @fileoverview The Apply tab: find the application form on the page and fill it.
 *
 * The candidate sees one summary ("9 fields, 6 we can fill") and one main action. Field
 * detail, the review-each-field plan, and anti-bot notes are available but folded away.
 * Submission is never automated (ADR-0006): the candidate always presses Submit.
 */

import { NextStep } from './NextStep.js';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  ApplicationForm,
  ApplicationField,
  CandidateProfile,
} from '@applykit/domain';
import {
  generateDryRunPlan,
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

interface FormInspectorProps {
  onNavigateToTab?: (tab: TabId) => void;
  /** Called after a field-by-field plan is created so the review list can load it. */
  onPlanReady?: () => void;
}

/**
 * Form Inspector component displaying detected application fields, ATS metadata,
 * Anti-Autonomous Submit status, and candidate profile value previews.
 */
export const FormInspector: React.FC<FormInspectorProps> = ({ onNavigateToTab, onPlanReady }) => {
  const [forms, setForms] = useState<readonly ApplicationForm[]>([]);
  const [selectedFormIndex, setSelectedFormIndex] = useState<number>(0);
  const [isInspecting, setIsInspecting] = useState(false);
  const [isAutoFilling, setIsAutoFilling] = useState(false);
  const [autoFillNotice, setAutoFillNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hasScanned, setHasScanned] = useState(false);
  const [profile, setProfile] = useState<CandidateProfile | null>(null);
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
        setError(res.error || 'No application form found on this page.');
      }
    } catch (err) {
      setForms([]);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsInspecting(false);
      setHasScanned(true);
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
        onPlanReady?.();
      } else {
        setError(res.error || 'Could not prepare the field list.');
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
          `Filled ${res.report.executedCount} field${res.report.executedCount === 1 ? '' : 's'}. Check the form, then press Submit yourself.`
        );
      } else {
        setError(res.error || 'Some fields could not be filled.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsAutoFilling(false);
    }
  };

  const activeForm = forms[selectedFormIndex] ?? null;

  // The preview runs the same planner as "Check each field", so what this list says
  // will go in a field is exactly what the plan will propose.
  const previewValues = useMemo(() => {
    const values = new Map<string, string>();
    if (!activeForm || !profile) return values;
    try {
      for (const action of generateDryRunPlan(activeForm, profile).actions) {
        if (action.fieldId) values.set(action.fieldId, action.candidateValueUsed);
      }
    } catch {
      // A preview is a convenience; the real plan reports its own errors.
    }
    return values;
  }, [activeForm, profile]);
  const fillable = previewValues.size;
  // "Answer these yourself" lists required fields the plan will not fill. It used to go
  // by the field's mapping confidence alone, so a field the planner fills from the
  // profile ("From where do you intend to work?") was listed as both.
  const unmappedFields = activeForm ? activeForm.fields.filter((f) => f.isRequired && !previewValues.has(f.id)) : [];
  const honeypotCount = activeForm ? activeForm.fields.filter((f) => f.isHoneypotSuspect).length : 0;
  const requiredCount = activeForm ? activeForm.fields.filter((f) => f.isRequired).length : 0;

  return (
    <section className="ui-card ui-stack" style={{ gap: 10 }} aria-label="Application form">
      <div className="ui-spread">
        <h2 className="ui-card-title">Application form</h2>
        {activeForm && (
          <button type="button" className="ui-link" onClick={handleInspect} disabled={isInspecting}>
            {isInspecting ? 'Scanning...' : 'Scan again'}
          </button>
        )}
      </div>

      {!activeForm && (
        <>
          <p className="ui-text">
            Open the job's application form, then scan it. ApplyKit fills what it knows from your profile and leaves the
            rest to you. It never presses Submit.
          </p>
          <button type="button" className="ui-btn ui-btn-primary ui-btn-block" onClick={handleInspect} disabled={isInspecting}>
            {isInspecting ? 'Scanning the page...' : 'Scan this page for a form'}
          </button>
        </>
      )}

      {error && <div className="ui-note ui-note-bad" role="alert">{error}</div>}
      {autoFillNotice && <div className="ui-note ui-note-good" role="status">{autoFillNotice}</div>}

      {activeForm && (
        <>
          {forms.length > 1 && (
            <div className="ui-row">
              <span className="ui-subtle">Forms on this page:</span>
              {forms.map((form, idx) => (
                <button
                  key={form.id}
                  type="button"
                  className={`ui-btn ui-btn-sm ${selectedFormIndex === idx ? 'ui-btn-primary' : ''}`}
                  onClick={() => setSelectedFormIndex(idx)}
                >
                  {idx + 1}
                </button>
              ))}
            </div>
          )}

          <p className="ui-text">
            {activeForm.fields.length} fields, {requiredCount} required. ApplyKit can fill <strong>{fillable}</strong> from your
            profile.
            {activeForm.stepProgression?.stepName ? ` You're on the "${activeForm.stepProgression.stepName}" step.` : ''}
          </p>

          {activeForm.authBarrier && (
            <div className="ui-note ui-note-warn">Sign in on the page first. {activeForm.authBarrier.message}</div>
          )}

          {activeForm.validationErrors && activeForm.validationErrors.length > 0 && (
            <div className="ui-note ui-note-bad">
              The page is showing errors:
              <ul style={{ margin: '4px 0 0 16px' }}>
                {activeForm.validationErrors.map((err, idx) => (
                  <li key={idx}>{err.message}</li>
                ))}
              </ul>
              {unmappedFields.some((f) => f.fieldType === 'textarea') && (
                <p style={{ margin: '6px 0 0' }}>
                  For open questions, press "Check each field before filling", then "Draft answers to open questions".
                </p>
              )}
            </div>
          )}

          <button
            type="button"
            className="ui-btn ui-btn-primary ui-btn-block"
            onClick={handleOneClickAutoFill}
            disabled={isAutoFilling}
          >
            {isAutoFilling ? 'Filling the form...' : 'Fill the form'}
          </button>
          <button type="button" className="ui-btn ui-btn-block" onClick={handleGeneratePlan} disabled={isPlanning}>
            {isPlanning ? 'Preparing...' : 'Check each field before filling'}
          </button>

          {unmappedFields.length > 0 && (
            <div className="ui-note ui-note-warn">
              {unmappedFields.length === 1 ? 'Answer this one yourself:' : `Answer these ${unmappedFields.length} yourself:`}
              <ul className="ui-plain-list" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                {unmappedFields.map((f) => (
                  <li key={f.id}>{(f.label || 'A field with no label').replace(/\s*\*\s*$/, '')}</li>
                ))}
              </ul>
            </div>
          )}

          {honeypotCount > 0 && (
            <p className="ui-subtle">
              {honeypotCount} hidden field{honeypotCount === 1 ? '' : 's'} on this form look like bot traps. ApplyKit leaves them
              empty.
            </p>
          )}

          <details className="ui-details">
            <summary>See all {activeForm.fields.length} fields</summary>
            <ul className="ui-list">
              {activeForm.fields.map((field) => (
                <FieldInspectionCard key={field.id} field={field} plannedValue={previewValues.get(field.id)} />
              ))}
            </ul>
          </details>

          {onNavigateToTab && autoFillNotice && (
            <NextStep
              title="Check the form, press Submit, then log it"
              hint="ApplyKit never presses Submit. Once you have, mark it in the Tracker so you can follow up."
              actionLabel="Open the Tracker"
              onAction={() => onNavigateToTab('track')}
            />
          )}
          {!autoFillNotice && (
            <p className="ui-subtle">When the form looks right, press Submit on the page yourself. Then log it in the Tracker.</p>
          )}
        </>
      )}
      {hasScanned && !activeForm && !isInspecting && (
        <NextStep
          title="Can't see a form yet?"
          hint="Press the Apply button on the job page so the form opens, wait a moment, then scan again. If the form opened in another tab, switch to it first."
          actionLabel="Scan again"
          onAction={handleInspect}
          {...(onNavigateToTab ? { secondary: { label: 'Back to your resume', onAction: () => onNavigateToTab('tailor_resume') } } : {})}
        />
      )}
    </section>
  );
};

interface FieldInspectionCardProps {
  field: ApplicationField;
  /** What the planner would put in this field, if anything. */
  plannedValue?: string;
}

/**
 * One row in the field list: the question as the page labels it and what will go in it.
 */
const FieldInspectionCard: React.FC<FieldInspectionCardProps> = ({ field, plannedValue }) => {
  const profileValue = plannedValue;
  const status = field.isHoneypotSuspect
    ? { label: 'Left empty', cls: '' }
    : profileValue
    ? { label: 'Will fill', cls: 'ui-chip-good' }
    : { label: field.isRequired ? 'You answer' : 'Optional', cls: field.isRequired ? 'ui-chip-warn' : '' };

  return (
    <li>
      <div className="ui-spread" style={{ alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--text)' }}>
          {field.label || 'Unnamed field'}
          {field.isRequired && <span className="ui-subtle"> (required)</span>}
        </span>
        <span className={`ui-chip ${status.cls}`}>{status.label}</span>
      </div>
      {field.isHoneypotSuspect ? (
        <p className="ui-subtle">Hidden from people, so probably a bot trap.</p>
      ) : profileValue ? (
        <p className="ui-subtle">{profileValue}</p>
      ) : field.options && field.options.length > 0 ? (
        <p className="ui-subtle">Choices: {field.options.slice(0, 5).map((opt) => opt.label).join(', ')}{field.options.length > 5 ? ', ...' : ''}</p>
      ) : null}
    </li>
  );
};
