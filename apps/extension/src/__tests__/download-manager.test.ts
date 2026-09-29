/**
 * @fileoverview Test suite for Extension Download Manager (ADR-0026, ADR-0031).
 *
 * Verifies:
 * 1. Filename sanitization across OS filesystems (Windows, Mac, Linux).
 * 2. Native chrome.downloads.download API utilization with Data URL encoding.
 * 3. Fallback anchor tag click mechanism with safe URL lifecycle.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  sanitizeDownloadFilename,
  downloadBlob,
  downloadText,
} from '../sidepanel/download-manager.js';

describe('Download Manager Test Suite', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    delete (globalThis as any).chrome;
  });

  describe('sanitizeDownloadFilename', () => {
    it('strips illegal filename characters and normalizes whitespace', () => {
      const input = 'My: Resume / Senior * Architect? <Canonical> | 2026.pdf';
      const clean = sanitizeDownloadFilename(input);
      expect(clean).toBe('My_Resume_Senior_Architect_Canonical_2026.pdf');
    });

    it('preserves valid alphanumeric filenames with extensions', () => {
      const input = 'Morgan_Reed_Canonical_Resume.pdf';
      expect(sanitizeDownloadFilename(input)).toBe('Morgan_Reed_Canonical_Resume.pdf');
    });
  });

  describe('downloadBlob with chrome.downloads API', () => {
    it('calls chrome.downloads.download with base64 Data URL and sanitized name', async () => {
      const mockDownload = vi.fn((opts, cb) => cb(12345));
      (globalThis as any).chrome = {
        downloads: {
          download: mockDownload,
        },
      };

      const blob = new Blob(['%PDF-1.4 simulated pdf data'], { type: 'application/pdf' });
      await downloadBlob(blob, 'Canonical Resume (Tailored).pdf');

      expect(mockDownload).toHaveBeenCalledTimes(1);
      const callArgs = mockDownload.mock.calls[0]?.[0];
      expect(callArgs.filename).toBe('Canonical_Resume_(Tailored).pdf');
      expect(callArgs.url).toContain('data:application/pdf;base64,');
      expect(callArgs.saveAs).toBe(false);
    });
  });

  describe('downloadBlob with DOM fallback', () => {
    it('creates anchor tag and clicks to trigger download when chrome.downloads is absent', async () => {
      const blob = new Blob(['# Tailored Resume Markdown'], { type: 'text/markdown' });
      const appendSpy = vi.spyOn(document.body, 'appendChild');

      await downloadBlob(blob, 'Resume_Canonical.md');

      expect(appendSpy).toHaveBeenCalled();
      const createdLink = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement;
      expect(createdLink).toBeDefined();
      expect(createdLink.download).toBe('Resume_Canonical.md');
      expect(createdLink.href).toContain('blob:');
    });

    it('downloads text via downloadText helper', async () => {
      const appendSpy = vi.spyOn(document.body, 'appendChild');
      await downloadText('# Grounded Cover Letter', 'Cover_Letter.md', 'text/markdown');

      expect(appendSpy).toHaveBeenCalled();
      const createdLink = appendSpy.mock.calls[0]?.[0] as HTMLAnchorElement;
      expect(createdLink.download).toBe('Cover_Letter.md');
    });
  });
});
