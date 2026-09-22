/**
 * @fileoverview Application Tracker and Audit Trail Viewer Component.
 *
 * Provides a local-first management dashboard for all job application journeys (ADR-0001):
 * 1. Metrics overview: tracking application volumes, interview progression, and response rates.
 * 2. Status management: candidate confirms submissions and manages post-submission lifecycle.
 * 3. Granular audit trail: inspects executed field fills, source evidence grounding, and transitions.
 * 4. Portable export: one-click CSV and JSON export with formula injection defense.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { ApplicationRecord, ApplicationState, ApplicationId } from '@applykit/domain';
import { sendToBackground } from '../../messages/bridge.js';
import type {
  ListApplicationsResponse,
  UpdateApplicationStatusResponse,
  DeleteApplicationRecordResponse,
  ExportAuditLogResponse,
} from '../../messages/contracts.js';

interface ApplicationTrackerProps {
  onNavigateToTab?: (tabId: any) => void;
}

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
 * Maps application states to human-readable labels and CSS modifier classes.
 */
function getStatusBadgeProps(status: ApplicationState): { label: string; className: string } {
  switch (status) {
    case 'awaiting_user_review':
      return { label: 'Awaiting Review', className: 'status-badge-review' };
    case 'submitted':
      return { label: 'Submitted', className: 'status-badge-submitted' };
    case 'interviewing':
      return { label: 'Interviewing', className: 'status-badge-interviewing' };
    case 'offered':
      return { label: 'Offer Received', className: 'status-badge-offered' };
    case 'rejected':
      return { label: 'Rejected', className: 'status-badge-rejected' };
    case 'archived':
      return { label: 'Archived', className: 'status-badge-archived' };
    case 'ready_to_fill':
    case 'dry_run_review':
    case 'executing_actions':
      return { label: 'In Progress', className: 'status-badge-progress' };
    case 'detected_job':
    case 'extracting_job':
    case 'matching_profile':
      return { label: 'Draft', className: 'status-badge-draft' };
    case 'failed':
      return { label: 'Failed', className: 'status-badge-failed' };
    default:
      return { label: 'Idle', className: 'status-badge-idle' };
  }
}

/**
 * Formats an ISO date string into a localized, human-friendly date.
 */
function formatDate(isoString?: string): string {
  if (!isoString) return '—';
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
  if (!isoString) return '—';
  try {
    const d = new Date(isoString);
    return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return isoString;
  }
}

export const ApplicationTracker: React.FC<ApplicationTrackerProps> = () => {
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedAppId, setSelectedAppId] = useState<ApplicationId | null>(null);

  // Edit / drawer state
  const [activeNotes, setActiveNotes] = useState('');
  const [activeFollowUp, setActiveFollowUp] = useState('');
  const [selectedStage, setSelectedStage] = useState<string>('');
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [exporting, setExporting] = useState<'csv' | 'json' | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

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

  // Synchronize drawer input states when selection changes
  useEffect(() => {
    if (selectedApp) {
      setActiveNotes(selectedApp.notes || '');
      setActiveFollowUp(selectedApp.nextFollowUpDate || '');
      setSelectedStage(selectedApp.interviewStage || INTERVIEW_STAGES[0]);
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

  // Saves notes and follow-up date without state transition
  const handleSaveNotesAndSchedule = async () => {
    if (!selectedApp) return;
    await handleTransitionStatus(
      selectedApp.id,
      selectedApp.currentStatus,
      'Updated notes and follow-up schedule',
      {
        notes: activeNotes,
        nextFollowUpDate: activeFollowUp,
        interviewStage: selectedStage,
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

  // Exports audit log as CSV or JSON and triggers browser download
  const handleExport = async (format: 'csv' | 'json') => {
    try {
      setExporting(format);
      const res = await sendToBackground<
        { type: 'EXPORT_AUDIT_LOG'; format: 'csv' | 'json' },
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
        a.download = res.filename || `applykit-audit-trail.${format}`;
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
            ✕
          </button>
        </div>
      )}
      {/* Header & Metrics Strip */}
      <div className="tracker-header">
        <div className="tracker-title-row">
          <div>
            <h2 className="tracker-title">Application Tracker</h2>
            <p className="tracker-subtitle">
              Local audit history and post-submission pipeline (ADR-0001, ADR-0006)
            </p>
          </div>
          <div className="tracker-export-group">
            <button
              type="button"
              className="export-btn export-btn-csv"
              onClick={() => handleExport('csv')}
              disabled={exporting !== null || applications.length === 0}
              title="Export complete audit trail to sanitized CSV"
            >
              {exporting === 'csv' ? 'Exporting...' : 'Export CSV'}
            </button>
            <button
              type="button"
              className="export-btn export-btn-json"
              onClick={() => handleExport('json')}
              disabled={exporting !== null || applications.length === 0}
              title="Export audit log to structured JSON"
            >
              {exporting === 'json' ? 'Exporting...' : 'Export JSON'}
            </button>
          </div>
        </div>

        {/* Aggregate KPI Badges */}
        <div className="tracker-metrics-grid">
          <div className="metric-card">
            <span className="metric-label">Tracked</span>
            <span className="metric-value">{metrics.total}</span>
          </div>
          <div className="metric-card metric-card-warning">
            <span className="metric-label">Awaiting Review</span>
            <span className="metric-value">{metrics.awaitingReview}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Submitted</span>
            <span className="metric-value">{metrics.submitted}</span>
          </div>
          <div className="metric-card metric-card-info">
            <span className="metric-label">Interviewing</span>
            <span className="metric-value">{metrics.interviewing}</span>
          </div>
          <div className="metric-card metric-card-success">
            <span className="metric-label">Offers</span>
            <span className="metric-value">{metrics.offered}</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Response Rate</span>
            <span className="metric-value">{metrics.responseRate}%</span>
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="tracker-filter-bar">
        <div className="tracker-search-wrap">
          <input
            type="text"
            className="tracker-search-input"
            placeholder="Search company or role title..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              type="button"
              className="tracker-search-clear"
              onClick={() => setSearchTerm('')}
            >
              &times;
            </button>
          )}
        </div>

        <div className="tracker-filter-pills">
          <button
            type="button"
            className={`filter-pill ${statusFilter === 'all' ? 'filter-pill-active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            All ({applications.length})
          </button>
          <button
            type="button"
            className={`filter-pill ${statusFilter === 'review' ? 'filter-pill-active' : ''}`}
            onClick={() => setStatusFilter('review')}
          >
            Review ({metrics.awaitingReview})
          </button>
          <button
            type="button"
            className={`filter-pill ${statusFilter === 'submitted' ? 'filter-pill-active' : ''}`}
            onClick={() => setStatusFilter('submitted')}
          >
            Submitted ({metrics.submitted})
          </button>
          <button
            type="button"
            className={`filter-pill ${statusFilter === 'interviewing' ? 'filter-pill-active' : ''}`}
            onClick={() => setStatusFilter('interviewing')}
          >
            Interviewing ({metrics.interviewing})
          </button>
          <button
            type="button"
            className={`filter-pill ${statusFilter === 'offered' ? 'filter-pill-active' : ''}`}
            onClick={() => setStatusFilter('offered')}
          >
            Offers ({metrics.offered})
          </button>
        </div>
      </div>

      {/* Main List & Details Layout */}
      {loading ? (
        <div className="tracker-empty-state">
          <div className="spinner-sm" />
          <p>Loading application history...</p>
        </div>
      ) : filteredApps.length === 0 ? (
        <div className="tracker-empty-state">
          <p className="empty-title">No applications found</p>
          <p className="empty-desc">
            {applications.length === 0
              ? 'Execute a form filling plan or extract a job posting to begin tracking your applications.'
              : 'No applications matched your search or status filter.'}
          </p>
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
                      &#128197; Follow-up: {app.nextFollowUpDate}
                    </span>
                  )}
                  {app.filledFieldsCount > 0 && (
                    <span className="meta-item">
                      Filled: {app.filledFieldsCount} fields
                    </span>
                  )}
                  {app.matchedRequirementsScore > 0 && (
                    <span className="meta-item match-score-pill">
                      {Math.round(app.matchedRequirementsScore * 100)}% Match
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
          <div className="audit-drawer" onClick={(e) => e.stopPropagation()}>
            <div className="audit-drawer-header">
              <div>
                <h3 className="drawer-title">{selectedApp.companyName}</h3>
                <p className="drawer-subtitle">{selectedApp.jobTitle}</p>
              </div>
              <button
                type="button"
                className="drawer-close-btn"
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
                    <span className="callout-icon">&#9888;</span>
                    <strong>Awaiting Manual Submission (ADR-0006 Hard Gate)</strong>
                  </div>
                  <p className="callout-text">
                    ApplyKit has safely filled your verified information into the form and paused before the submission button. After reviewing the active page in your browser and clicking submit, confirm below to update your tracking status.
                  </p>
                  <button
                    type="button"
                    className="confirm-submit-btn"
                    disabled={statusUpdating}
                    onClick={() =>
                      handleTransitionStatus(
                        selectedApp.id,
                        'submitted',
                        'Candidate manually verified and confirmed application submission on host page.'
                      )
                    }
                  >
                    {statusUpdating ? 'Updating...' : '&#10003; Confirm Manual Submission'}
                  </button>
                </div>
              )}

              {/* Status Management Bar */}
              <div className="drawer-section">
                <h4 className="section-title">Status & Lifecycle Management</h4>
                <div className="status-button-group">
                  {selectedApp.currentStatus !== 'submitted' &&
                    selectedApp.currentStatus !== 'awaiting_user_review' && (
                      <button
                        type="button"
                        className="status-btn"
                        disabled={statusUpdating}
                        onClick={() =>
                          handleTransitionStatus(selectedApp.id, 'submitted', 'Marked as submitted')
                        }
                      >
                        Mark Submitted
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
                        `Advanced to ${selectedStage || 'Interviewing'} stage`,
                        { interviewStage: selectedStage }
                      )
                    }
                  >
                    Move to Interviewing
                  </button>

                  <button
                    type="button"
                    className={`status-btn ${selectedApp.currentStatus === 'offered' ? 'status-btn-active' : ''}`}
                    disabled={statusUpdating}
                    onClick={() =>
                      handleTransitionStatus(
                        selectedApp.id,
                        'offered',
                        'Offer received from employer'
                      )
                    }
                  >
                    Offer Received
                  </button>

                  <button
                    type="button"
                    className="status-btn status-btn-reject"
                    disabled={statusUpdating}
                    onClick={() =>
                      handleTransitionStatus(
                        selectedApp.id,
                        'rejected',
                        'Application declined or rejected'
                      )
                    }
                  >
                    Mark Rejected
                  </button>

                  <button
                    type="button"
                    className="status-btn"
                    disabled={statusUpdating}
                    onClick={() =>
                      handleTransitionStatus(
                        selectedApp.id,
                        'archived',
                        'Archived by candidate'
                      )
                    }
                  >
                    Archive
                  </button>
                </div>
              </div>

              {/* Interview Stage & Follow-Up Reminders */}
              <div className="drawer-section">
                <h4 className="section-title">Interview Stage & Next Follow-Up</h4>
                <div className="stage-schedule-grid">
                  <div className="form-group">
                    <label className="form-label">Current Interview Stage</label>
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
                    <label className="form-label">Follow-Up / Check-In Date</label>
                    <input
                      type="date"
                      className="form-input"
                      value={activeFollowUp}
                      onChange={(e) => setActiveFollowUp(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group notes-group">
                  <label className="form-label">Candidate Application Notes</label>
                  <textarea
                    className="form-textarea"
                    rows={3}
                    placeholder="Interview questions asked, interviewer names, compensation notes..."
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
                      Save Notes & Schedule
                    </button>
                  </div>
                </div>
              </div>

              {/* Executed Form Actions Log */}
              <div className="drawer-section">
                <h4 className="section-title">
                  Executed Field Actions Audit Log ({selectedApp.dryRunLog?.length || 0})
                </h4>
                {selectedApp.dryRunLog && selectedApp.dryRunLog.length > 0 ? (
                  <div className="audit-table-wrap">
                    <table className="audit-table">
                      <thead>
                        <tr>
                          <th>Field / Selector</th>
                          <th>Value Inserted</th>
                          <th>Risk</th>
                          <th>Grounding Citation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedApp.dryRunLog.map((act) => (
                          <tr key={act.id}>
                            <td>
                              <span className="audit-field-desc">
                                {act.action.description || act.action.selector}
                              </span>
                              <code className="audit-field-code">{act.action.selector}</code>
                            </td>
                            <td>
                              <span className="audit-field-value">{act.candidateValueUsed}</span>
                            </td>
                            <td>
                              <span className={`risk-pill risk-${act.riskLevel}`}>
                                {act.riskLevel}
                              </span>
                            </td>
                            <td>
                              <span className="audit-field-grounding">
                                {act.sourceEvidenceTitle || 'Verified Profile'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="empty-audit-notice">
                    No field actions recorded for this application.
                  </p>
                )}
              </div>

              {/* Immutable State Machine History Timeline */}
              <div className="drawer-section">
                <h4 className="section-title">
                  State Machine Transition Timeline ({selectedApp.statusHistory?.length || 0})
                </h4>
                <div className="timeline-container">
                  {selectedApp.statusHistory?.map((tr, index) => (
                    <div key={`${tr.timestamp}-${index}`} className="timeline-item">
                      <div className="timeline-dot" />
                      <div className="timeline-content">
                        <div className="timeline-header">
                          <span className="timeline-state">
                            {tr.from} &rarr; <strong>{tr.to}</strong>
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
    </div>
  );
};
