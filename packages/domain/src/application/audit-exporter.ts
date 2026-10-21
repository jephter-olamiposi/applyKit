/**
 * @fileoverview Audit Trail Exporter for Application Records and Executed Browser Actions.
 *
 * Implements deterministic serialization of application history and action logs
 * into portable JSON and CSV formats (ADR-0001).
 *
 * Security Invariant: CSV exports enforce formula-injection defense by sanitizing
 * characters that trigger spreadsheet formula execution (=, +, -, @, \t, \r).
 */

import type { ApplicationRecord } from './record.js';

/**
 * Metadata header for JSON audit exports.
 */
export interface AuditExportPayload {
  readonly version: string;
  readonly exportedAt: string;
  readonly totalApplications: number;
  readonly applications: readonly ApplicationRecord[];
}

/**
 * Sanitizes a single cell value for CSV serialization, preventing spreadsheet formula injection.
 *
 * OWASP CSV Injection Defense: Prepend a single quote if the first non-whitespace
 * character could be interpreted as a formula prefix by Microsoft Excel or Google Sheets.
 *
 * @param raw Raw string or value to sanitize.
 * @returns Safe cell string.
 */
export function sanitizeCsvCell(raw: unknown): string {
  if (raw === null || raw === undefined) {
    return '';
  }

  let text = String(raw);

  // Neutralize formula triggers
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }

  // RFC 4180 escaping: wrap in quotes if contains comma, quote, or newline
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

/**
 * Exports a collection of ApplicationRecords to an auditable, formatted JSON string.
 *
 * @param applications List of candidate application records.
 * @returns Serialized JSON string with 2-space indentation.
 */
export function exportAuditTrailAsJson(applications: readonly ApplicationRecord[]): string {
  const payload: AuditExportPayload = {
    version: '1.0.0',
    exportedAt: new Date().toISOString(),
    totalApplications: applications.length,
    applications,
  };

  return JSON.stringify(payload, null, 2);
}

/**
 * Headers for the tabular CSV audit log.
 */
const CSV_HEADERS = [
  'Application ID',
  'Company',
  'Job Title',
  'Posting URL',
  'Current Status',
  'Interview Stage',
  'Recruiter Name',
  'Recruiter Email',
  'Expected Salary',
  'Applied Date',
  'Follow-Up Date',
  'Match Score (%)',
  'Fields Filled Count',
  'Action Target Selector',
  'Action Candidate Value',
  'Action Risk Level',
  'Action User Confirmed',
  'Action Grounding Source',
  'Created At',
  'Updated At',
] as const;

/**
 * Exports application history and dry run actions to a sanitized, tabular CSV format.
 *
 * If an application has executed actions in its dry run log, a row is emitted for each action
 * to provide a granular field-level audit trail. If an application has no actions, a single
 * summary row is emitted.
 *
 * @param applications List of candidate application records.
 * @returns RFC 4180 compliant CSV string with formula injection protection.
 */
export function exportAuditTrailAsCsv(applications: readonly ApplicationRecord[]): string {
  const rows: string[] = [];

  // Header row
  rows.push(CSV_HEADERS.map((h) => sanitizeCsvCell(h)).join(','));

  for (const app of applications) {
    const baseCols = [
      app.id,
      app.companyName,
      app.jobTitle,
      app.jobPostingUrl,
      app.currentStatus,
      app.interviewStage || '',
      app.recruiterName || '',
      app.recruiterEmail || '',
      app.expectedSalary || '',
      app.appliedAt || '',
      app.nextFollowUpDate || '',
      Math.round(app.matchedRequirementsScore * 100),
      app.filledFieldsCount,
    ];

    if (app.dryRunLog && app.dryRunLog.length > 0) {
      for (const action of app.dryRunLog) {
        const actionCols = [
          ...baseCols,
          action.action.selector,
          action.candidateValueUsed,
          action.riskLevel,
          action.userConfirmed ? 'true' : 'false',
          action.sourceEvidenceTitle || 'Candidate Profile & Evidence Graph',
          app.createdAt,
          app.updatedAt,
        ];
        rows.push(actionCols.map(sanitizeCsvCell).join(','));
      }
    } else {
      const summaryCols = [
        ...baseCols,
        '', // selector
        '', // value
        '', // risk level
        '', // user confirmed
        '', // evidence source
        app.createdAt,
        app.updatedAt,
      ];
      rows.push(summaryCols.map(sanitizeCsvCell).join(','));
    }
  }

  return rows.join('\r\n');
}

/**
 * Canonical 8-column pipeline tracking status vocabulary (SKILL.md Phase 5).
 */
export type PipelineStatus =
  | 'Not started'
  | 'Needs candidate'
  | 'Applied'
  | 'Unconfirmed'
  | 'Blocked'
  | 'Closed'
  | 'Rejected'
  | 'Interviewing';

/**
 * Headers for the 8-column canonical pipeline tracker.
 */
export const PIPELINE_TRACKER_HEADERS = [
  'employer',
  'role',
  'status',
  'date',
  'url',
  'source',
  'note',
  'key',
] as const;

/**
 * Normalizes an employer name and job title into a stable deduplication key (e.g. "stripe::staff-platform-engineer").
 *
 * @param employer Employer name.
 * @param role Job title.
 * @returns Normalized slug key.
 */
export function normalizePipelineKey(employer: string, role: string): string {
  const normEmployer = (employer || 'unknown')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const normRole = (role || 'role')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${normEmployer}::${normRole}`;
}

/**
 * Maps an internal ApplicationRecord state to the canonical PipelineStatus vocabulary (SKILL.md Phase 5).
 *
 * @param record ApplicationRecord aggregate.
 * @returns Human-facing pipeline status.
 */
export function mapApplicationStateToPipelineStatus(record: ApplicationRecord): PipelineStatus {
  const notesLower = record.notes?.toLowerCase() || '';
  if (notesLower.includes('blocked') || notesLower.includes('ineligible')) {
    return 'Blocked';
  }
  switch (record.currentStatus) {
    case 'submitted':
      return 'Applied';
    case 'awaiting_user_review':
    case 'ready_to_fill':
    case 'dry_run_review':
    case 'executing_actions':
      return 'Needs candidate';
    case 'interviewing':
    case 'offered':
      return 'Interviewing';
    case 'rejected':
      return 'Rejected';
    case 'archived':
      return 'Closed';
    case 'failed':
      return 'Unconfirmed';
    case 'detected_job':
    case 'extracting_job':
    case 'matching_profile':
    default:
      return 'Not started';
  }
}

/**
 * Exports application records into the canonical 8-column CSV format defined by SKILL.md.
 * Columns: employer, role, status, date, url, source, note, key.
 *
 * @param applications Candidate application records.
 * @returns RFC 4180 compliant CSV string with formula injection protection.
 */
export function exportPipelineTrackerCsv(applications: readonly ApplicationRecord[]): string {
  const rows: string[] = [];
  rows.push(PIPELINE_TRACKER_HEADERS.map((h) => sanitizeCsvCell(h)).join(','));

  for (const app of applications) {
    const status = mapApplicationStateToPipelineStatus(app);
    const key = normalizePipelineKey(app.companyName, app.jobTitle);
    const date = app.appliedAt?.slice(0, 10) || app.updatedAt?.slice(0, 10) || app.createdAt.slice(0, 10);
    const source = (app.notes?.match(/source:\s*([^\s;]+)/i)?.[1]) || 'Direct ATS';
    const note = app.notes || (status === 'Needs candidate' ? 'Needs candidate: Review staged fields and submit' : '');

    const cols = [
      app.companyName,
      app.jobTitle,
      status,
      date,
      app.jobPostingUrl,
      source,
      note,
      key,
    ];
    rows.push(cols.map(sanitizeCsvCell).join(','));
  }

  return rows.join('\r\n');
}

/**
 * Exports application records into a clean GitHub-flavored Markdown table for easy sharing and pasting.
 *
 * @param applications Candidate application records.
 * @returns Formatted Markdown string table.
 */
export function exportPipelineTrackerMarkdown(applications: readonly ApplicationRecord[]): string {
  const lines: string[] = [];
  lines.push('| Employer | Role | Status | Date | Source | Note | Key |');
  lines.push('|---|---|---|---|---|---|---|');

  for (const app of applications) {
    const status = mapApplicationStateToPipelineStatus(app);
    const key = normalizePipelineKey(app.companyName, app.jobTitle);
    const date = app.appliedAt?.slice(0, 10) || app.updatedAt?.slice(0, 10) || app.createdAt.slice(0, 10);
    const source = (app.notes?.match(/source:\s*([^\s;]+)/i)?.[1]) || 'Direct ATS';
    const note = (app.notes || (status === 'Needs candidate' ? 'Needs candidate: Review staged fields and submit' : '')).replace(/\|/g, '\\|');
    const roleLink = `[${app.jobTitle.replace(/\|/g, '\\|')}](${app.jobPostingUrl})`;

    lines.push(`| ${app.companyName.replace(/\|/g, '\\|')} | ${roleLink} | **${status}** | ${date} | ${source} | ${note} | \`${key}\` |`);
  }

  return lines.join('\n');
}
