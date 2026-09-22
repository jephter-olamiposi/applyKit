/**
 * @fileoverview Unit tests for Audit Exporter (JSON & CSV) and CSV Formula Injection Protection.
 *
 * Verifies:
 * 1. Sanitization of spreadsheet formula injection characters (=, +, -, @).
 * 2. RFC 4180 CSV cell escaping for quotes, commas, and newlines.
 * 3. JSON audit export schema and serialization integrity.
 * 4. Granular tabular CSV export for executed actions and summary records.
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizeCsvCell,
  exportAuditTrailAsJson,
  exportAuditTrailAsCsv,
} from '../application/audit-exporter.js';
import {
  createApplicationRecord,
  type ApplicationRecord,
} from '../application/record.js';
import {
  createApplicationId,
  createProfileId,
  createJobPostingId,
  createActionId,
} from '../types/ids.js';

describe('Audit Exporter & CSV Formula Injection Protection (Phase 11)', () => {
  describe('sanitizeCsvCell', () => {
    it('handles null and undefined values safely', () => {
      expect(sanitizeCsvCell(null)).toBe('');
      expect(sanitizeCsvCell(undefined)).toBe('');
    });

    it('neutralizes formula injection triggers by prefixing single quote', () => {
      expect(sanitizeCsvCell('=1+1')).toBe("'=1+1");
      expect(sanitizeCsvCell('+123')).toBe("'+123");
      expect(sanitizeCsvCell('-50')).toBe("'-50");
      expect(sanitizeCsvCell('@SUM(A1:A10)')).toBe("'@SUM(A1:A10)");
      expect(sanitizeCsvCell('\tmalicious')).toBe("'\tmalicious");
      expect(sanitizeCsvCell('\rmalicious')).toBe('"\'\rmalicious"');
    });

    it('escapes standard CSV strings with commas, quotes, and newlines', () => {
      expect(sanitizeCsvCell('Hello, World')).toBe('"Hello, World"');
      expect(sanitizeCsvCell('He said "Hello"')).toBe('"He said ""Hello"""');
      expect(sanitizeCsvCell('Line 1\nLine 2')).toBe('"Line 1\nLine 2"');
    });

    it('leaves standard text unchanged', () => {
      expect(sanitizeCsvCell('Jane Doe')).toBe('Jane Doe');
      expect(sanitizeCsvCell('Software Engineer')).toBe('Software Engineer');
    });
  });

  describe('exportAuditTrailAsJson', () => {
    it('serializes application records into auditable structured JSON', () => {
      const app = createApplicationRecord({
        id: createApplicationId('app_1'),
        candidateProfileId: createProfileId('prof_1'),
        jobPostingId: createJobPostingId('job_1'),
        companyName: 'Anthropic',
        jobTitle: 'Research Engineer',
        jobPostingUrl: 'https://anthropic.com/jobs/1',
        matchedRequirementsScore: 0.88,
      });

      const jsonStr = exportAuditTrailAsJson([app]);
      const parsed = JSON.parse(jsonStr);

      expect(parsed.version).toBe('1.0.0');
      expect(parsed.totalApplications).toBe(1);
      expect(parsed.exportedAt).toBeDefined();
      expect(parsed.applications[0].companyName).toBe('Anthropic');
      expect(parsed.applications[0].jobTitle).toBe('Research Engineer');
    });
  });

  describe('exportAuditTrailAsCsv', () => {
    it('exports summary row for applications without dry run actions', () => {
      const app = createApplicationRecord({
        id: createApplicationId('app_test'),
        candidateProfileId: createProfileId('prof_test'),
        jobPostingId: createJobPostingId('job_test'),
        companyName: 'Stripe',
        jobTitle: 'Backend Architect',
        jobPostingUrl: 'https://stripe.com/jobs/arch',
        matchedRequirementsScore: 0.95,
      });

      const csvStr = exportAuditTrailAsCsv([app]);
      const lines = csvStr.split('\r\n');

      // Header + 1 data row
      expect(lines.length).toBe(2);
      expect(lines[0]).toContain('Application ID,Company,Job Title');
      expect(lines[1]).toContain('app_test,Stripe,Backend Architect');
    });

    it('exports granular action rows and neutralizes formula injection in candidate values', () => {
      const app: ApplicationRecord = {
        ...createApplicationRecord({
          id: createApplicationId('app_actions'),
          candidateProfileId: createProfileId('prof_actions'),
          jobPostingId: createJobPostingId('job_actions'),
          companyName: 'Google',
          jobTitle: 'Staff Engineer',
          jobPostingUrl: 'https://careers.google.com/jobs/123',
          matchedRequirementsScore: 0.91,
        }),
        filledFieldsCount: 2,
        dryRunLog: [
          {
            id: createActionId('act_1'),
            action: {
              actionType: 'fill_text',
              selector: '#name',
              value: 'Jane Doe',
              description: 'Fill Name',
              requiresUserConfirmation: false,
            },
            currentValue: '',
            candidateValueUsed: 'Jane Doe',
            confidence: 0.98,
            riskLevel: 'low',
            userConfirmed: true,
            sourceEvidenceTitle: 'Candidate Identity (Verified Profile)',
          },
          {
            id: createActionId('act_2'),
            action: {
              actionType: 'fill_text',
              selector: '#formula_injection_test',
              value: '=cmd|’ /C calc’!A0',
              description: 'Formula payload test',
              requiresUserConfirmation: true,
            },
            currentValue: '',
            candidateValueUsed: '=cmd|’ /C calc’!A0',
            confidence: 0.75,
            riskLevel: 'high',
            userConfirmed: true,
            sourceEvidenceTitle: 'Custom Answer',
          },
        ],
      };

      const csvStr = exportAuditTrailAsCsv([app]);
      const lines = csvStr.split('\r\n');

      // Header + 2 action rows
      expect(lines.length).toBe(3);
      expect(lines[1]).toContain('Jane Doe');
      expect(lines[1]).toContain('Candidate Identity (Verified Profile)');

      // Invariant: Formula injection prefix '=' must be sanitized with a single quote
      expect(lines[2]).toContain("'=cmd|’ /C calc’!A0");
    });
  });
});
