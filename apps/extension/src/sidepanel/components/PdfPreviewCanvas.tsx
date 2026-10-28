/**
 * @fileoverview Resume preview with the few layout choices people actually change.
 *
 * Pages are drawn with PDF.js at the panel's width, so the preview is readable in a
 * narrow side panel instead of a tiny embedded viewer. Layout controls sit under the
 * preview and downloads come last, matching the order a person works in: look, adjust,
 * download (ADR-0031).
 */

import React, { useEffect, useRef, useState } from 'react';
import type { ResumeTemplateId, SpacingDensity } from '@applykit/domain';

export interface PdfPreviewCanvasProps {
  /** Object URL of the rendered PDF. */
  blobUrl: string | null;
  /** True while a new PDF is being generated. */
  isGenerating: boolean;
  /** Suggested download filename. */
  filename: string;
  /** Downloads the PDF. */
  onDownload: () => void;
  /** Downloads a Word (.docx) version, when available. */
  onDownloadDocx?: () => void;
  /** Suggested DOCX filename. */
  docxFilename?: string;
  /** Whether the Word file is being generated. */
  isGeneratingDocx?: boolean;
  /** Active resume template. */
  templateId: ResumeTemplateId;
  /** Active spacing. */
  density: SpacingDensity;
  /** Whether the resume is trimmed to one page. */
  onePageFit: boolean;
  /** Whether the target job title appears under the candidate's name. */
  showTargetBadge: boolean;
  onTemplateChange: (template: ResumeTemplateId) => void;
  onDensityChange: (density: SpacingDensity) => void;
  onOnePageFitToggle: (enabled: boolean) => void;
  onShowTargetBadgeToggle: (show: boolean) => void;
  /** Company applied to, for the "name it in my summary" choice. */
  companyName?: string;
  /** Whether the summary ends with a line naming the company. */
  mentionCompany?: boolean;
  onMentionCompanyToggle?: (enabled: boolean) => void;
  /** Rendering error, if any. */
  error?: string | null;
}

const TEMPLATE_LABELS: Record<ResumeTemplateId, string> = {
  modern: 'Modern',
  classic: 'Classic',
  minimalist: 'Minimalist',
  compact: 'Compact',
};

const DENSITY_LABELS: Record<SpacingDensity, string> = {
  tight: 'Tight',
  standard: 'Standard',
  relaxed: 'Relaxed',
};

/**
 * Draws every page of the PDF at the container's width. Returns the page count, or
 * throws when PDF.js cannot load, in which case the caller falls back to an iframe.
 */
async function renderPages(url: string, host: HTMLDivElement): Promise<number> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const runtime = globalThis as typeof globalThis & { chrome?: { runtime?: { getURL?: (path: string) => string } } };
  pdfjs.GlobalWorkerOptions.workerSrc = runtime.chrome?.runtime?.getURL?.('assets/pdf.worker.mjs') ?? '/assets/pdf.worker.mjs';

  const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: bytes, useWorkerFetch: false });
  const doc = await loadingTask.promise;
  try {
    const width = Math.max(240, host.clientWidth);
    const ratio = window.devicePixelRatio || 1;
    const canvases: HTMLCanvasElement[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: (width / base.width) * ratio });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = '100%';
      canvas.setAttribute('aria-label', `Page ${pageNumber}`);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable');
      await page.render({ canvasContext: context, viewport, canvas }).promise;
      canvases.push(canvas);
    }
    host.replaceChildren(...canvases);
    return doc.numPages;
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * Shows the resume preview, layout choices, and download buttons.
 */
export const PdfPreviewCanvas: React.FC<PdfPreviewCanvasProps> = ({
  blobUrl,
  isGenerating,
  filename,
  onDownload,
  onDownloadDocx,
  docxFilename,
  isGeneratingDocx,
  templateId,
  density,
  onePageFit,
  showTargetBadge,
  onTemplateChange,
  onDensityChange,
  onOnePageFitToggle,
  onShowTargetBadgeToggle,
  companyName,
  mentionCompany,
  onMentionCompanyToggle,
  error,
}) => {
  const pagesRef = useRef<HTMLDivElement>(null);
  const [pageCount, setPageCount] = useState<number | null>(null);
  const [useFrame, setUseFrame] = useState(false);

  useEffect(() => {
    const host = pagesRef.current;
    if (!blobUrl || !host || useFrame) return;
    let cancelled = false;
    renderPages(blobUrl, host)
      .then((count) => {
        if (!cancelled) setPageCount(count);
      })
      .catch(() => {
        // PDF.js could not draw the file here; the browser's own viewer still can.
        if (!cancelled) setUseFrame(true);
      });
    return () => {
      cancelled = true;
    };
  }, [blobUrl, useFrame]);

  return (
    <div className="ui-stack" style={{ gap: 10 }} role="region" aria-label="Resume preview">
      <div className="resume-preview">
        {isGenerating && (
          <div className="resume-preview-busy pdf-generating-overlay" role="status" aria-live="polite">
            Updating the preview...
          </div>
        )}
        {error && <div className="ui-note ui-note-bad" role="alert">{error}</div>}
        {blobUrl && useFrame && (
          <iframe src={blobUrl} title="Resume preview" style={{ width: '100%', height: 520, border: 'none' }} />
        )}
        {blobUrl && !useFrame && <div ref={pagesRef} className="resume-preview-pages" />}
        {!blobUrl && !error && <p className="ui-subtle" style={{ padding: 16 }}>The preview appears here once your resume is ready.</p>}
      </div>

      {pageCount !== null && pageCount > 1 && (
        <p className="ui-subtle">
          This runs to {pageCount} pages. Turn on “Fit on one page” or pick Tight spacing if you want one.
        </p>
      )}

      <div className="ui-row" style={{ gap: 10 }}>
        <label className="ui-row" style={{ gap: 6 }}>
          <span className="ui-subtle">Style</span>
          <select
            className="ui-select"
            style={{ width: 'auto' }}
            value={templateId}
            disabled={isGenerating}
            onChange={(e) => onTemplateChange(e.target.value as ResumeTemplateId)}
          >
            {(Object.keys(TEMPLATE_LABELS) as ResumeTemplateId[]).map((id) => (
              <option key={id} value={id}>
                {TEMPLATE_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
        <label className="ui-row" style={{ gap: 6 }}>
          <span className="ui-subtle">Spacing</span>
          <select
            className="ui-select"
            style={{ width: 'auto' }}
            value={density}
            disabled={isGenerating}
            onChange={(e) => onDensityChange(e.target.value as SpacingDensity)}
          >
            {(Object.keys(DENSITY_LABELS) as SpacingDensity[]).map((id) => (
              <option key={id} value={id}>
                {DENSITY_LABELS[id]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="ui-row" style={{ gap: 14 }}>
        <label className="ui-row" style={{ gap: 6 }}>
          <input type="checkbox" checked={onePageFit} disabled={isGenerating} onChange={(e) => onOnePageFitToggle(e.target.checked)} />
          <span>Fit on one page</span>
        </label>
        <label className="ui-row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={showTargetBadge}
            disabled={isGenerating}
            onChange={(e) => onShowTargetBadgeToggle(e.target.checked)}
          />
          <span>Show the job title under my name</span>
        </label>
        {onMentionCompanyToggle && companyName && (
          <label className="ui-row" style={{ gap: 6 }}>
            <input
              type="checkbox"
              checked={Boolean(mentionCompany)}
              disabled={isGenerating}
              onChange={(e) => onMentionCompanyToggle(e.target.checked)}
            />
            <span>Name {companyName} in my summary</span>
          </label>
        )}
      </div>

      <div className="ui-row">
        <button
          type="button"
          className="ui-btn ui-btn-primary btn-canvas-download"
          style={{ flex: 1 }}
          onClick={onDownload}
          disabled={isGenerating || !blobUrl}
          title={filename}
        >
          Download PDF
        </button>
        {onDownloadDocx && (
          <button
            type="button"
            className="ui-btn"
            style={{ flex: 1 }}
            onClick={onDownloadDocx}
            disabled={isGenerating || isGeneratingDocx}
            title={docxFilename ?? 'Word document'}
          >
            {isGeneratingDocx ? 'Preparing Word file...' : 'Download Word'}
          </button>
        )}
      </div>
      {blobUrl && (
        <button
          type="button"
          className="ui-link"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => window.open(blobUrl, '_blank', 'noopener,noreferrer')}
        >
          Open the PDF in a new tab
        </button>
      )}
    </div>
  );
};
