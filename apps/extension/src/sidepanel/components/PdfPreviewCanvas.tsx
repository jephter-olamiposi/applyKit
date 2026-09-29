/**
 * @fileoverview Live Interactive Vector PDF Preview Canvas Component.
 *
 * Provides real-time visual inspection and fine-tuning controls for tailored
 * resumes and cover letters before downloading (ADR-0026, ADR-0031):
 * 1. Live Embedded PDF Canvas: Displays generated vector PDF Blob URL in an interactive viewer.
 * 2. Visual Zoom Controls: Fit (100%), 75%, 100%, 125% transform scaling.
 * 3. Real-Time Fine-Tuning: Instant switching between Modern, Classic, Minimalist,
 *    and Compact templates with SpacingDensity adjustments ('tight', 'standard', 'relaxed').
 * 4. Page Budget Monitoring: Real-time indicators for 1-page fit compliance.
 */

import React, { useState } from 'react';
import type { ResumeTemplateId, SpacingDensity } from '@applykit/domain';

export interface PdfPreviewCanvasProps {
  /** Active Blob URL of the rendered vector PDF. */
  blobUrl: string | null;
  /** True while the PDF generation engine is assembling vector elements. */
  isGenerating: boolean;
  /** Suggested download filename. */
  filename: string;
  /** Download action handler. */
  onDownload: () => void;
  /** Active resume template. */
  templateId: ResumeTemplateId;
  /** Active spacing density rhythm. */
  density: SpacingDensity;
  /** Whether 1-page budget constraint is enforced. */
  onePageFit: boolean;
  /** Whether the tailored target badge appears in the header. */
  showTargetBadge: boolean;
  /** Handler when candidate switches design template. */
  onTemplateChange: (template: ResumeTemplateId) => void;
  /** Handler when candidate fine-tunes spacing density. */
  onDensityChange: (density: SpacingDensity) => void;
  /** Handler when candidate toggles 1-page fit constraint. */
  onOnePageFitToggle: (enabled: boolean) => void;
  /** Handler when candidate toggles target badge display. */
  onShowTargetBadgeToggle: (show: boolean) => void;
  /** Optional error message from PDF rendering. */
  error?: string | null;
}

export const PdfPreviewCanvas: React.FC<PdfPreviewCanvasProps> = ({
  blobUrl,
  isGenerating,
  filename,
  onDownload,
  templateId,
  density,
  onePageFit,
  showTargetBadge,
  onTemplateChange,
  onDensityChange,
  onOnePageFitToggle,
  onShowTargetBadgeToggle,
  error,
}) => {
  const [zoomLevel, setZoomLevel] = useState<number>(100);

  const handleOpenInNewTab = () => {
    if (blobUrl) {
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="pdf-preview-canvas-container" role="region" aria-label="Live Vector PDF Preview">
      {/* Top Styling & Fine-Tuning Controls */}
      <div className="pdf-canvas-toolbar">
        {/* Template Selector */}
        <div className="canvas-control-row">
          <div className="canvas-control-group">
            <span className="canvas-control-label">Template:</span>
            <div className="template-pill-buttons" role="radiogroup" aria-label="Resume Template">
              {(['modern', 'classic', 'minimalist', 'compact'] as ResumeTemplateId[]).map((tId) => (
                <button
                  key={tId}
                  type="button"
                  role="radio"
                  aria-checked={templateId === tId}
                  className={`template-pill ${templateId === tId ? 'template-pill-active' : ''}`}
                  onClick={() => onTemplateChange(tId)}
                  disabled={isGenerating}
                >
                  {tId === 'modern' && '✨ Modern'}
                  {tId === 'classic' && '🏛️ Classic'}
                  {tId === 'minimalist' && '📄 Minimalist'}
                  {tId === 'compact' && '⚡ Compact'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Spacing Density & Page Budget Controls */}
        <div className="canvas-control-row canvas-control-row-secondary">
          <div className="canvas-control-group">
            <span className="canvas-control-label">Density:</span>
            <div className="density-pill-buttons" role="radiogroup" aria-label="Spacing Density">
              {(['tight', 'standard', 'relaxed'] as SpacingDensity[]).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={density === d}
                  className={`density-pill ${density === d ? 'density-pill-active' : ''}`}
                  onClick={() => onDensityChange(d)}
                  disabled={isGenerating}
                  title={
                    d === 'tight'
                      ? 'Tight vertical spacing for dense 1-page budgets'
                      : d === 'standard'
                      ? 'Balanced professional spacing'
                      : 'Relaxed breathing room for senior profiles'
                  }
                >
                  {d === 'tight' ? 'Tight' : d === 'standard' ? 'Standard' : 'Relaxed'}
                </button>
              ))}
            </div>
          </div>

          <div className="canvas-toggles-group">
            <label className="canvas-checkbox-label">
              <input
                type="checkbox"
                checked={onePageFit}
                onChange={(e) => onOnePageFitToggle(e.target.checked)}
                disabled={isGenerating}
              />
              <span>1-Page Fit</span>
            </label>

            <label className="canvas-checkbox-label">
              <input
                type="checkbox"
                checked={showTargetBadge}
                onChange={(e) => onShowTargetBadgeToggle(e.target.checked)}
                disabled={isGenerating}
              />
              <span>Target Badge</span>
            </label>
          </div>
        </div>

        {/* Canvas Navigation & Zoom Header */}
        <div className="canvas-meta-bar">
          <div className="canvas-zoom-group">
            <span className="zoom-label">Zoom:</span>
            <button
              type="button"
              className={`zoom-btn ${zoomLevel === 75 ? 'zoom-btn-active' : ''}`}
              onClick={() => setZoomLevel(75)}
              title="75% Zoom"
            >
              75%
            </button>
            <button
              type="button"
              className={`zoom-btn ${zoomLevel === 100 ? 'zoom-btn-active' : ''}`}
              onClick={() => setZoomLevel(100)}
              title="100% (Fit) Zoom"
            >
              100%
            </button>
            <button
              type="button"
              className={`zoom-btn ${zoomLevel === 125 ? 'zoom-btn-active' : ''}`}
              onClick={() => setZoomLevel(125)}
              title="125% Zoom"
            >
              125%
            </button>
          </div>

          <div className="canvas-meta-actions">
            {onePageFit ? (
              <span className="budget-status-pill budget-status-active" title="792pt budget enforced">
                ✓ 1-Page Budget
              </span>
            ) : (
              <span className="budget-status-pill budget-status-multi" title="Comprehensive multi-page resume">
                📄 Multi-Page
              </span>
            )}

            <button
              type="button"
              className="btn-canvas-popout"
              onClick={handleOpenInNewTab}
              disabled={!blobUrl}
              title="Open full vector PDF in browser tab"
            >
              ↗ Popout
            </button>

            <button
              type="button"
              className="btn-canvas-download"
              onClick={onDownload}
              disabled={isGenerating || !blobUrl}
              title={`Download ${filename}`}
            >
              ⬇ Download PDF
            </button>
          </div>
        </div>
      </div>

      {/* Embedded PDF Stage */}
      <div className="pdf-stage-wrapper">
        {isGenerating && (
          <div className="pdf-generating-overlay" role="status" aria-live="polite">
            <div className="canvas-spinner" />
            <span>Rendering vector PDF layout...</span>
          </div>
        )}

        {error && (
          <div className="pdf-render-error" role="alert">
            <span>⚠️ {error}</span>
          </div>
        )}

        {blobUrl ? (
          <div
            className="pdf-viewport"
            style={{
              transform: `scale(${zoomLevel / 100})`,
              transformOrigin: 'top center',
            }}
          >
            <iframe
              src={blobUrl}
              title="Interactive Vector PDF Preview"
              className="pdf-iframe-frame"
            />
          </div>
        ) : (
          <div className="pdf-placeholder-stage">
            <p>Select or generate a resume to load the interactive vector preview canvas.</p>
          </div>
        )}
      </div>

      <div className="pdf-canvas-footer-tip">
        <span>💡 Tip: If content spills onto page 2, toggle <strong>1-Page Fit</strong> or select <strong>Tight</strong> density.</span>
      </div>
    </div>
  );
};
