/**
 * @fileoverview Application Tracker and Audit Trail Viewer Component.
 *
 * The Tracker tab: every application, its status, and what was filled, stored locally (ADR-0001):
 * 1. Metrics overview: tracking application volumes, interview progression, and response rates.
 * 2. Status management: candidate confirms submissions and manages post-submission lifecycle.
 * 3. Granular audit trail: inspects executed field fills, source evidence grounding, and transitions.
 * 4. Portable export: one-click CSV and JSON export with formula injection defense.
 */

import { NextStep } from './NextStep.js';
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { ApplicationRecord, ApplicationState, ApplicationId } from '@applykit/domain';
import { detectInterviewInvite } from '@applykit/domain';
import { sendToBackground } from '../../messages/bridge.js';
import { InterviewPrepModal } from './InterviewPrepModal.js';
import type {
  ListApplicationsResponse,
  UpdateApplicationStatusResponse,
  DeleteApplicationRecordResponse,
  ExportAuditLogRequest,
  ExportAuditLogResponse,
} from '../../messages/contracts.js';

const INTERVIEW_STAGES = [
  'Recruiter Screen',
  'Hiring Manager Screen',
  'Technical Assessment',
  'System Design',
  'Behavioral Round',
  'Onsite / Final Loop',
  'Executive Review',
  'Offer Extended',
] as const;

/**
 * Match score as a whole percent. Records store 0..1, but records logged before
 * 2026-10-25 stored 0..100 and showed as "5000% Match", so those are read as-is.
 */
function matchPercent(score: number): number {
  return Math.min(100, Math.round(score > 1 ? score : score * 100));
}

/**
 * Maps application states to human-readable labels and CSS modifier classes.
 */
function getStatusBadgeProps(status: ApplicationState): { label: string; className: string } {
  switch (status) {
    case 'awaiting_user_review':
      return { label: 'To submit', className: 'status-badge-review' };
    case 'submitted':
      return { label: 'Applied', className: 'status-badge-submitted' };
    case 'interviewing':
      return { label: 'Interviewing', className: 'status-badge-interviewing' };
    case 'offered':
      return { label: 'Offer', className: 'status-badge-offered' };
    case 'rejected':
      return { label: 'Rejected', className: 'status-badge-rejected' };
    case 'archived':
      return { label: 'Archived', className: 'status-badge-archived' };
    case 'ready_to_fill':
    case 'dry_run_review':
    case 'executing_actions':
      return { label: 'Filling', className: 'status-badge-progress' };
    case 'detected_job':
    case 'extracting_job':
    case 'matching_profile':
      return { label: 'Saved', className: 'status-badge-draft' };
    case 'failed':
      return { label: 'Did not finish', className: 'status-badge-failed' };
    default:
      return { label: 'Saved', className: 'status-badge-idle' };
  }
}

/**
 * Formats an ISO date string into a localized, human-friendly date.
 */
function formatDate(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return isoString;
  }
}

/**
 * Formats an ISO date string into a precise timestamp with time.
 */
function formatTimestamp(isoString?: string): string {
  if (!isoString) return '';
  try {
    const d = new Date(isoString);
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return isoString;
  }
}

export interface ApplicationTrackerProps {
  /** Moves the panel to another screen, for the "next step" card. */
  readonly onNavigateToTab?: (tab: string) => void;
}

export const ApplicationTracker: React.FC<ApplicationTrackerProps> = ({ onNavigateToTab }) => {
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedAppId, setSelectedAppId] = useState<ApplicationId | null>(null);

  // Edit / drawer state
  const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');
  const [activeNotes, setActiveNotes] = useState('');
  const [activeFollowUp, setActiveFollowUp] = useState('');
  const [selectedStage, setSelectedStage] = useState<string>('');
  const [activeRecruiterName, setActiveRecruiterName] = useState<string>('');
  const [activeRecruiterEmail, setActiveRecruiterEmail] = useState<string>('');
  const [activeExpectedSalary, setActiveExpectedSalary] = useState<string>('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'json' | 'tracker-csv' | 'tracker-md' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Interview Prep & Email Scanner State
  const [prepModalApp, setPrepModalApp] = useState<ApplicationRecord | null>(null);
  const [showEmailScanner, setShowEmailScanner] = useState(false);
  const [emailInputText, setEmailInputText] = useState('');
  const [emailScanResult, setEmailScanResult] = useState<string | null>(null);

  const handleScanEmail = async () => {
    if (!emailInputText.trim()) return;
    const lines = emailInputText.trim().split('\n');
    const subject = lines[0] || 'Recruiter Communication';
    const bodyText = lines.slice(1).join('\n') || emailInputText;

    const result = detectInterviewInvite({ subject, bodyText }, applications);
    if (result.isInterviewInvite) {
      if (result.matchedApplicationId) {
        await handleTransitionStatus(
          result.matchedApplicationId,
          'interviewing',
          result.recruiterNotesSnippet || 'Interview invite detected from recruiter email',
          {
            notes: result.recruiterNotesSnippet,
          }
        );
        setEmailScanResult(
          `Detected a ${result.interviewType} interview invite for ${result.companyName || 'tracked application'}. Status moved to Interviewing.`
        );
      } else {
        setEmailScanResult(
          `Detected a ${result.interviewType} interview invite with a scheduling link: ${result.schedulingUrl || 'detected'}. Link it to an application manually.`
        );
      }
    } else {
      setEmailScanResult('No clear interview scheduling invitations were detected in the provided text.');
    }
  };

  const loadApplications = useCallback(async () => {
    try {
      setLoading(true);
      const res = await sendToBackground<
        { type: 'LIST_APPLICATIONS'; limit: number },
        ListApplicationsResponse
      >({
        type: 'LIST_APPLICATIONS',
        limit: 100,
      });

      if (res && res.applications) {
        setApplications(res.applications);
      }
    } catch (err) {
      console.error('Failed to load application history:', err);
      setErrorMessage('Failed to load application history. The extension may not be ready.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadApplications();
  }, [loadApplications]);

  const selectedApp = useMemo(
    () => applications.find((a) => a.id === selectedAppId) || null,
    [applications, selectedAppId]
  );

  // Escape closes the details drawer (the interview prep modal handles its own key).
  useEffect(() => {
    if (!selectedAppId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !prepModalApp) setSelectedAppId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedAppId, prepModalApp]);

  // Synchronize drawer input states when selection changes
  useEffect(() => {
    if (selectedApp) {
      setActiveNotes(selectedApp.notes || '');
      setActiveFollowUp(selectedApp.nextFollowUpDate || '');
      setSelectedStage(selectedApp.interviewStage || INTERVIEW_STAGES[0]);
      setActiveRecruiterName(selectedApp.recruiterName || '');
      setActiveRecruiterEmail(selectedApp.recruiterEmail || '');
      setActiveExpectedSalary(selectedApp.expectedSalary || '');
    }
  }, [selectedApp]);

  // Aggregate metrics
  const metrics = useMemo(() => {
    const total = applications.length;
    const awaitingReview = applications.filter((a) => a.currentStatus === 'awaiting_user_review').length;
    const submitted = applications.filter((a) => a.currentStatus === 'submitted').length;
    const interviewing = applications.filter((a) => a.currentStatus === 'interviewing').length;
    const offered = applications.filter((a) => a.currentStatus === 'offered').length;

    // Response rate = (interviewing + offered) / (submitted + interviewing + offered)
    const activeSubmissions = submitted + interviewing + offered;
    const responseRate =
      activeSubmissions > 0
        ? Math.round(((interviewing + offered) / activeSubmissions) * 100)
        : 0;

    return { total, awaitingReview, submitted, interviewing, offered, responseRate };
  }, [applications]);

  // Filtered applications list
  const filteredApps = useMemo(() => {
    return applications.filter((app) => {
      if (statusFilter !== 'all') {
        if (statusFilter === 'review' && app.currentStatus !== 'awaiting_user_review') return false;
        if (statusFilter === 'submitted' && app.currentStatus !== 'submitted') return false;
        if (statusFilter === 'interviewing' && app.currentStatus !== 'interviewing') return false;
        if (statusFilter === 'offered' && app.currentStatus !== 'offered') return false;
        if (statusFilter === 'rejected' && app.currentStatus !== 'rejected') return false;
      }

      if (searchTerm.trim().length > 0) {
        const query = searchTerm.toLowerCase();
        const companyMatch = (app.companyName || '').toLowerCase().includes(query);
        const roleMatch = (app.jobTitle || '').toLowerCase().includes(query);
        return companyMatch || roleMatch;
      }

      return true;
    });
  }, [applications, statusFilter, searchTerm]);

  // Kanban columns, one per stage the summary line counts.
  const kanbanColumns = useMemo(() => {
    const saved = filteredApps.filter((a) =>
      ['idle', 'detected_job', 'extracting_job', 'matching_profile', 'ready_to_fill'].includes(a.currentStatus)
    );
    // Filled but not yet submitted gets its own column; it used to sit under "Applied"
    // while the summary line above the board counted it as not applied.
    const toSubmit = filteredApps.filter((a) =>
      ['dry_run_review', 'executing_actions', 'awaiting_user_review'].includes(a.currentStatus)
    );
    const applied = filteredApps.filter((a) => a.currentStatus === 'submitted');
    const interviewing = filteredApps.filter((a) => a.currentStatus === 'interviewing');
    const offered = filteredApps.filter((a) => a.currentStatus === 'offered');
    const closed = filteredApps.filter((a) => ['rejected', 'archived', 'failed'].includes(a.currentStatus));

    return [
      { id: 'saved', title: 'Saved', apps: saved, color: 'var(--muted)' },
      { id: 'to_submit', title: 'To submit', apps: toSubmit, color: 'var(--warning-text)' },
      { id: 'applied', title: 'Applied', apps: applied, color: 'var(--accent)' },
      { id: 'interviewing', title: 'Interviewing', apps: interviewing, color: 'var(--accent)' },
      { id: 'offered', title: 'Offer', apps: offered, color: 'var(--success)' },
      { id: 'closed', title: 'Closed', apps: closed, color: 'var(--danger)' },
    ];
  }, [filteredApps]);

  // Transitions application state
  const handleTransitionStatus = async (
    targetAppId: ApplicationId,
    nextStatus: ApplicationState,
    reason?: string,
    updates?: Partial<ApplicationRecord>
  ) => {
    try {
      setStatusUpdating(true);
      const res = await sendToBackground<
        {
          type: 'UPDATE_APPLICATION_STATUS';
          id: ApplicationId;
          nextStatus: ApplicationState;
          reason?: string;
          interviewStage?: string;
          nextFollowUpDate?: string;
          notes?: string;
          recruiterName?: string;
          recruiterEmail?: string;
          expectedSalary?: string;
        },
        UpdateApplicationStatusResponse
      >({
        type: 'UPDATE_APPLICATION_STATUS',
        id: targetAppId,
        nextStatus,
        reason,
        interviewStage: updates?.interviewStage,
        nextFollowUpDate: updates?.nextFollowUpDate,
        notes: updates?.notes,
        recruiterName: updates?.recruiterName,
        recruiterEmail: updates?.recruiterEmail,
        expectedSalary: updates?.expectedSalary,
      });

      if (res && res.success && res.application) {
        setApplications((prev) =>
          prev.map((item) => (item.id === targetAppId ? res.application! : item))
        );
      }
    } catch (err) {
      console.error('Failed to transition application status:', err);
      setErrorMessage('Failed to save the status update. Please try again.');
    } finally {
      setStatusUpdating(false);
    }
  };

  // Saves notes, recruiter CRM fields, and follow-up date without state transition
  const handleSaveNotesAndSchedule = async () => {
    if (!selectedApp) return;
    await handleTransitionStatus(
      selectedApp.id,
      selectedApp.currentStatus,
      'Updated recruiter notes and follow-up schedule',
      {
        notes: activeNotes,
        nextFollowUpDate: activeFollowUp,
        interviewStage: selectedStage,
        recruiterName: activeRecruiterName,
        recruiterEmail: activeRecruiterEmail,
        expectedSalary: activeExpectedSalary,
      }
    );
  };

  // Deletes an application record
  const handleDeleteApplication = async (id: ApplicationId, company: string) => {
    const confirmed = window.confirm(
      `Are you sure you want to delete the application record for ${company}? This will permanently remove its audit history.`
    );
    if (!confirmed) return;

    try {
      const res = await sendToBackground<
        { type: 'DELETE_APPLICATION_RECORD'; id: ApplicationId },
        DeleteApplicationRecordResponse
      >({
        type: 'DELETE_APPLICATION_RECORD',
        id,
      });

      if (res && res.success) {
        setApplications((prev) => prev.filter((a) => a.id !== id));
        if (selectedAppId === id) {
          setSelectedAppId(null);
        }
      }
    } catch (err) {
      console.error('Failed to delete application record:', err);
      setErrorMessage('Failed to delete the application record. Please try again.');
    }
  };

  // Exports audit log as CSV, JSON, canonical tracker CSV, or Markdown and triggers browser download
  const handleExport = async (format: ExportAuditLogRequest['format']) => {
    try {
      setExporting(format);
      const res = await sendToBackground<
        ExportAuditLogRequest,
        ExportAuditLogResponse
      >({
        type: 'EXPORT_AUDIT_LOG',
        format,
      });

      if (res && res.success && res.content) {
        const blob = new Blob([res.content], { type: res.mimeType || 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = res.filename || `applykit-tracker.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error('Failed to export audit log:', err);
      setErrorMessage('Failed to export the audit log. Please try again.');
    } finally {
      setExporting(null);
    }
  };

  return (
    <div className="tracker-container">
      {errorMessage && (
        <div className="tracker-error-banner" role="alert">
          <span>{errorMessage}</span>
          <button
            type="button"
            className="tracker-error-dismiss"
            aria-label="Dismiss error"
            onClick={() => setErrorMessage(null)}
          >
            &times;
          </button>
        </div>
      )}
      <section className="ui-card ui-stack" style={{ gap: 10 }} aria-label="Your applications">
        <div className="ui-spread">
          <h2 className="ui-card-title">Your applications</h2>
          <button type="button" className="ui-link" onClick={() => setShowEmailScanner((prev) => !prev)}>
            {showEmailScanner ? 'Close' : 'Got a reply from a recruiter?'}
          </button>
        </div>
        {applications.length > 0 && (
          <p className="ui-text">
            {metrics.submitted} applied · {metrics.awaitingReview} waiting for you to submit · {metrics.interviewing} interviewing ·{' '}
            {metrics.offered} offer{metrics.offered === 1 ? '' : 's'}
            {metrics.submitted > 0 ? ` · ${metrics.responseRate}% heard back` : ''}
          </p>
        )}

        {showEmailScanner && (
          <div className="ui-stack" style={{ gap: 6 }}>
            <p className="ui-subtle">
              Paste the email. If it's an interview invite, ApplyKit moves that application to Interviewing.
            </p>
            <textarea
              className="ui-textarea"
              rows={3}
              aria-label="Recruiter email text"
              placeholder="Paste the email text, including any scheduling link"
              value={emailInputText}
              onChange={(e) => setEmailInputText(e.target.value)}
            />
            <div className="ui-row">
              <button type="button" className="ui-btn ui-btn-sm ui-btn-primary" onClick={handleScanEmail} disabled={!emailInputText.trim()}>
                Check this email
              </button>
              {emailScanResult && <span className="ui-subtle">{emailScanResult}</span>}
            </div>
          </div>
        )}

        {applications.length > 0 && (
          <div className="ui-row">
            {applications.length > 4 && (
              <input
                type="search"
                className="ui-input"
                style={{ flex: 1, minWidth: 140 }}
                placeholder="Search company or role"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            )}
            <select
              className="ui-select"
              style={{ width: 'auto' }}
              aria-label="Show"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="all">All ({applications.length})</option>
              <option value="review">To submit ({metrics.awaitingReview})</option>
              <option value="submitted">Applied ({metrics.submitted})</option>
              <option value="interviewing">Interviewing ({metrics.interviewing})</option>
              <option value="offered">Offers ({metrics.offered})</option>
            </select>
            <div className="ui-segmented" role="group" aria-label="View" style={{ marginBottom: 0 }}>
              <button type="button" aria-pressed={viewMode === 'kanban'} onClick={() => setViewMode('kanban')}>
                Board
              </button>
              <button type="button" aria-pressed={viewMode === 'table'} onClick={() => setViewMode('table')}>
                List
              </button>
            </div>
          </div>
        )}
      </section>

      {/* Main List & Details Layout */}
      {loading ? (
        <div className="tracker-empty-state">
          <div className="spinner-sm" />
          <p>Loading your applications...</p>
        </div>
      ) : filteredApps.length === 0 ? (
        <div className="tracker-empty-state">
          <p className="empty-title">{applications.length === 0 ? 'Nothing here yet' : 'No matches'}</p>
          <p className="empty-desc">
            {applications.length === 0
              ? 'Applications show up here once you fill a form with ApplyKit. Submitting is detected automatically.'
              : 'Nothing matches that search or filter.'}
          </p>
        </div>
      ) : viewMode === 'kanban' ? (
        <div className="kanban-pipeline-board" role="region" aria-label="Kanban Application Pipeline">
          {kanbanColumns.map((col) => (
            <div key={col.id} className="kanban-column">
              <div className="kanban-column-header">
                <div className="kanban-column-title-group">
                  <span className="kanban-column-dot" style={{ backgroundColor: col.color }} />
                  <h4 className="kanban-column-title">{col.title}</h4>
                </div>
                <span className="kanban-column-count">{col.apps.length}</span>
              </div>

              <div className="kanban-column-cards">
                {col.apps.length === 0 ? (
                  <div className="kanban-empty-col">
                    <span>None</span>
                  </div>
                ) : (
                  col.apps.map((app) => {
                    const isSelected = selectedAppId === app.id;
                    const badge = getStatusBadgeProps(app.currentStatus);

                    return (
                      <div
                        key={app.id}
                        className={`kanban-card ${isSelected ? 'kanban-card-selected' : ''}`}
                        onClick={() => setSelectedAppId(isSelected ? null : app.id)}
                      >
                        <div className="kanban-card-top">
                          <h5 className="kanban-card-company">{app.companyName}</h5>
                          <span className={`status-badge-sm ${badge.className}`}>{badge.label}</span>
                        </div>
                        <p className="kanban-card-role">{app.jobTitle}</p>

                        <div className="kanban-card-chips">
                          {app.matchedRequirementsScore > 0 && (
                            <span className="kanban-chip chip-match">
                              {matchPercent(app.matchedRequirementsScore)}% Match
                            </span>
                          )}
                          {app.recruiterName && (
                            <span className="kanban-chip chip-recruiter" title={`Recruiter: ${app.recruiterName}`}>
                              {app.recruiterName}
                            </span>
                          )}
                          {app.expectedSalary && (
                            <span className="kanban-chip chip-salary" title={`Salary: ${app.expectedSalary}`}>
                              {app.expectedSalary}
                            </span>
                          )}
                          {app.interviewStage && (
                            <span className="kanban-chip chip-stage">
                              {app.interviewStage}
                            </span>
                          )}
                        </div>

                        <div className="kanban-card-footer">
                          <span className="kanban-date">
                            {formatDate(app.appliedAt || app.createdAt)}
                          </span>

                          <div className="kanban-quick-actions" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="kanban-advance-btn kanban-prep-btn"
                              onClick={() => setPrepModalApp(app)}
                              title="Open Role Interview Prep Kit & STAR Stories"
                            >
                              Prep
                            </button>
                            {col.id === 'saved' && (
                              <button
                                type="button"
                                className="kanban-advance-btn"
                                onClick={() => handleTransitionStatus(app.id, 'submitted', 'Candidate advanced to submitted')}
                                title="Advance to Applied"
                              >
                                Applied
                              </button>
                            )}
                            {col.id === 'applied' && (
                              <button
                                type="button"
                                className="kanban-advance-btn"
                                onClick={() => handleTransitionStatus(app.id, 'interviewing', 'Advanced to interviewing stage')}
                                title="Advance to Interviewing"
                              >
                                Interviewing
                              </button>
                            )}
                            {col.id === 'interviewing' && (
                              <button
                                type="button"
                                className="kanban-advance-btn kanban-advance-offer"
                                onClick={() => handleTransitionStatus(app.id, 'offered', 'Offer received from employer')}
                                title="Advance to Offer"
                              >
                                Offer
                              </button>
                            )}
                            {col.id === 'offered' && (
                              <button
                                type="button"
                                className="kanban-advance-btn"
                                onClick={() => handleTransitionStatus(app.id, 'archived', 'Archived after offer')}
                                title="Archive application"
                              >
                                Archive
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="tracker-list">
          {filteredApps.map((app) => {
            const isSelected = selectedAppId === app.id;
            const badge = getStatusBadgeProps(app.currentStatus);

            return (
              <div
                key={app.id}
                className={`tracker-card ${isSelected ? 'tracker-card-selected' : ''}`}
                onClick={() => setSelectedAppId(isSelected ? null : app.id)}
              >
                <div className="tracker-card-header">
                  <div className="tracker-card-info">
                    <h3 className="tracker-company">{app.companyName}</h3>
                    <p className="tracker-role">{app.jobTitle}</p>
                  </div>
                  <div className="tracker-card-badges">
                    <span className={`status-badge ${badge.className}`}>{badge.label}</span>
                    {app.interviewStage && (
                      <span className="stage-badge">{app.interviewStage}</span>
                    )}
                  </div>
                </div>

                <div className="tracker-card-meta">
                  <span className="meta-item">
                    Applied: {formatDate(app.appliedAt || app.createdAt)}
                  </span>
                  {app.nextFollowUpDate && (
                    <span className="meta-item follow-up-alert">
                      Follow-up: {app.nextFollowUpDate}
                    </span>
                  )}
                  {app.filledFieldsCount > 0 && (
                    <span className="meta-item">
                      Filled: {app.filledFieldsCount} fields
                    </span>
                  )}
                  {app.matchedRequirementsScore > 0 && (
                    <span className="meta-item match-score-pill">
                      {matchPercent(app.matchedRequirementsScore)}% Match
                    </span>
                  )}
                </div>

                <div className="tracker-card-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="card-action-btn card-action-audit"
                    onClick={() => setSelectedAppId(app.id)}
                  >
                    {isSelected ? 'Close Details' : 'View Audit & Manage'}
                  </button>
                  <button
                    type="button"
                    className="card-action-btn card-action-delete"
                    onClick={() => handleDeleteApplication(app.id, app.companyName)}
                    title="Delete record from local storage"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Application Audit Detail Modal / Drawer */}
      {selectedApp && (
        <div className="audit-drawer-backdrop" onClick={() => setSelectedAppId(null)}>
          <div
            className="audit-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={`${selectedApp.companyName} application`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="audit-drawer-header">
              <div>
                <h3 className="drawer-title">{selectedApp.companyName}</h3>
                <p className="drawer-subtitle">{selectedApp.jobTitle}</p>
              </div>
              <button
                type="button"
                className="drawer-close-btn"
                aria-label="Close"
                onClick={() => setSelectedAppId(null)}
              >
                &times;
              </button>
            </div>

            <div className="audit-drawer-body">
              {/* Submission Hard Gate Confirmation Banner */}
              {selectedApp.currentStatus === 'awaiting_user_review' && (
                <div className="audit-review-callout">
                  <div className="callout-header">
                    <strong>Waiting for you to submit</strong>
                  </div>
                  <p className="callout-text">
                    ApplyKit filled the form and stopped before Submit. Once you've submitted it on the page, mark it here.
                  </p>
                  <button
                    type="button"
                    className="confirm-submit-btn"
                    disabled={statusUpdating}
                    onClick={() =>
                      handleTransitionStatus(
                        selectedApp.id,
                        'submitted',
                        'You submitted it on the page.'
                      )
                    }
                  >
                    {statusUpdating ? 'Saving...' : 'I submitted it'}
                  </button>
                </div>
              )}

              {/* Role Interview Prep Kit Launcher */}
              <div className="drawer-section">
                <button
                  type="button"
                  className="drawer-prep-btn"
                  onClick={() => setPrepModalApp(selectedApp)}
                >
                  Open interview prep
                </button>
              </div>

              {/* Status Management Bar */}
              <div className="drawer-section">
                <h4 className="section-title">Where it stands</h4>
                <div className="status-button-group">
                  {selectedApp.currentStatus !== 'submitted' &&
                    selectedApp.currentStatus !== 'awaiting_user_review' && (
                      <button
                        type="button"
                        className="status-btn"
                        disabled={statusUpdating}
                        onClick={() =>
                          handleTransitionStatus(selectedApp.id, 'submitted', 'You marked it submitted.')
                        }
                      >
                        Submitted
                      </button>
                    )}

                  <button
                    type="button"
                    className={`status-btn ${selectedApp.currentStatus === 'interviewing' ? 'status-btn-active' : ''}`}
                    disabled={statusUpdating}
                    onClick={() =>
                      handleTransitionStatus(
                        selectedApp.id,
                        'interviewing',
                        `Interviewing${selectedStage ? `: ${selectedStage}` : ''}.`,
                        { interviewStage: selectedStage }
                      )
                    }
                  >
                    Interviewing
                  </button>

                  <button
                    type="button"
                    className={`status-btn ${selectedApp.currentStatus === 'offered' ? 'status-btn-active' : ''}`}
                    disabled={statusUpdating}
                    onClick={() =>
                      handleTransitionStatus(
                        selectedApp.id,
                        'offered',
                        'You got an offer.'
                      )
                    }
                  >
                    Got an offer
                  </button>

                  <button
                    type="button"
                    className="status-btn status-btn-reject"
                    disabled={statusUpdating}
                    onClick={() =>
                      handleTransitionStatus(
                        selectedApp.id,
                        'rejected',
                        'They said no.'
                      )
                    }
                  >
                    Rejected
                  </button>

                  <button
                    type="button"
                    className="status-btn"
                    disabled={statusUpdating}
                    onClick={() =>
                      handleTransitionStatus(
                        selectedApp.id,
                        'archived',
                        'You archived it.'
                      )
                    }
                  >
                    Archive
                  </button>
                </div>
              </div>

              {/* Recruiter & Compensation Details */}
              <div className="drawer-section">
                <h4 className="section-title">Recruiter and pay</h4>
                <div className="stage-schedule-grid">
                  <div className="form-group">
                    <label className="form-label">Recruiter name</label>
                    <input
                      type="text"
                      className="form-input"
                      placeholder="e.g. Jane Smith"
                      value={activeRecruiterName}
                      onChange={(e) => setActiveRecruiterName(e.target.value)}
                    />
                  </div>

                  <div className="form-group">
                    <label className="form-label">Recruiter email</label>
                    <input
                      type="email"
                      className="form-input"
                      placeholder="e.g. jsmith@company.com"
                      value={activeRecruiterEmail}
                      onChange={(e) => setActiveRecruiterEmail(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Pay discussed</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. $165,000 base + equity"
                    value={activeExpectedSalary}
                    onChange={(e) => setActiveExpectedSalary(e.target.value)}
                  />
                </div>
              </div>

              {/* Interview Stage & Follow-Up Reminders */}
              <div className="drawer-section">
                <h4 className="section-title">Interviews and follow-up</h4>
                <div className="stage-schedule-grid">
                  <div className="form-group">
                    <label className="form-label">Interview stage</label>
                    <select
                      className="form-select"
                      value={selectedStage}
                      onChange={(e) => setSelectedStage(e.target.value)}
                    >
                      {INTERVIEW_STAGES.map((st) => (
                        <option key={st} value={st}>
                          {st}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label className="form-label">Follow up on</label>
                    <input
                      type="date"
                      className="form-input"
                      value={activeFollowUp}
                      onChange={(e) => setActiveFollowUp(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group notes-group">
                  <label className="form-label">Notes</label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    placeholder="Who you spoke to, what they asked, what's next"
                    value={activeNotes}
                    onChange={(e) => setActiveNotes(e.target.value)}
                  />
                  <div className="notes-btn-row">
                    <button
                      type="button"
                      className="save-notes-btn"
                      onClick={handleSaveNotesAndSchedule}
                      disabled={statusUpdating}
                    >
                      {statusUpdating ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>

              {/* Executed Form Actions Log */}
              <div className="drawer-section">
                <h4 className="section-title">
                  What ApplyKit filled ({selectedApp.dryRunLog?.length || 0})
                </h4>
                {selectedApp.dryRunLog && selectedApp.dryRunLog.length > 0 ? (
                  <div className="audit-table-wrap">
                    <table className="audit-table">
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Answer</th>
                          <th>Check</th>
                          <th>From</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedApp.dryRunLog.map((act) => (
                          <tr key={act.id}>
                            <td>
                              <span className="audit-field-desc">
                                {act.fieldLabel || act.action.description || act.action.selector}
                              </span>
                            </td>
                            <td>
                              <span className="audit-field-value">{act.candidateValueUsed}</span>
                            </td>
                            <td>
                              <span className={`risk-pill risk-${act.riskLevel}`}>
                                {act.riskLevel === 'high' ? 'Legal' : act.riskLevel === 'medium' ? 'Review' : 'Simple'}
                              </span>
                            </td>
                            <td>
                              <span className="audit-field-grounding">
                                {act.sourceEvidenceTitle?.startsWith('AI Proposal') ? 'Drafted from your resume' : 'Your profile'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="empty-audit-notice">
                    Nothing was filled by ApplyKit for this one.
                  </p>
                )}
              </div>

              {/* Immutable State Machine History Timeline */}
              <div className="drawer-section">
                <h4 className="section-title">
                  History
                </h4>
                <div className="timeline-container">
                  {selectedApp.statusHistory?.map((tr, index) => (
                    <div key={`${tr.timestamp}-${index}`} className="timeline-item">
                      <div className="timeline-dot" />
                      <div className="timeline-content">
                        <div className="timeline-header">
                          <span className="timeline-state">
                            <strong>{getStatusBadgeProps(tr.to).label}</strong>
                          </span>
                          <span className="timeline-time">{formatTimestamp(tr.timestamp)}</span>
                        </div>
                        {tr.reason && <p className="timeline-reason">{tr.reason}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {prepModalApp && (
        <InterviewPrepModal
          application={prepModalApp}
          onClose={() => setPrepModalApp(null)}
        />
      )}
      {onNavigateToTab && !loading && (
        <NextStep
          title={applications.length > 0 ? 'Apply to the next one' : 'Find a job to apply to'}
          hint={
            applications.some((a) => a.currentStatus === 'awaiting_user_review')
              ? 'Open an application waiting for you and press "I submitted it" once it is sent.'
              : 'Open a job posting in this tab and read it, or look through jobs from the companies you follow.'
          }
          actionLabel="Find jobs"
          onAction={() => onNavigateToTab('sourced_feed')}
          secondary={{ label: 'Read the job on this page', onAction: () => onNavigateToTab('overview') }}
        />
      )}
      {applications.length > 0 && (
        <details className="ui-details ui-card">
          <summary>Export</summary>
          <div className="ui-row">
            <button type="button" className="ui-btn ui-btn-sm" onClick={() => handleExport('tracker-csv')} disabled={exporting !== null}>
              {exporting === 'tracker-csv' ? 'Exporting...' : 'Spreadsheet (CSV)'}
            </button>
            <button type="button" className="ui-btn ui-btn-sm" onClick={() => handleExport('tracker-md')} disabled={exporting !== null}>
              {exporting === 'tracker-md' ? 'Exporting...' : 'Summary (Markdown)'}
            </button>
            <button type="button" className="ui-btn ui-btn-sm" onClick={() => handleExport('csv')} disabled={exporting !== null}>
              {exporting === 'csv' ? 'Exporting...' : 'Everything filled (CSV)'}
            </button>
            <button type="button" className="ui-btn ui-btn-sm" onClick={() => handleExport('json')} disabled={exporting !== null}>
              {exporting === 'json' ? 'Exporting...' : 'Full history (JSON)'}
            </button>
          </div>
        </details>
      )}
    </div>
  );
};
