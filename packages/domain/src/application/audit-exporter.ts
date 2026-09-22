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
