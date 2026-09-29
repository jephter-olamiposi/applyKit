/**
 * @fileoverview Test suite for Live Vector PDF Preview Canvas component (ADR-0031).
 *
 * Verifies interactive controls, template switching, density adjustments,
 * zoom scaling, budget status indicators, and download triggers.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PdfPreviewCanvas } from '../sidepanel/components/PdfPreviewCanvas.js';
import type { ResumeTemplateId, SpacingDensity } from '@applykit/domain';

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('PdfPreviewCanvas Component Test Suite', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders interactive toolbar with zoom, template, and density controls', () => {
    act(() => {
      root.render(
        <PdfPreviewCanvas
          blobUrl="blob:chrome-extension://test-id/resume.pdf"
          isGenerating={false}
          filename="resume-canonical.pdf"
          onDownload={vi.fn()}
          templateId="modern"
          density="standard"
          onePageFit={true}
          showTargetBadge={true}
          onTemplateChange={vi.fn()}
          onDensityChange={vi.fn()}
          onOnePageFitToggle={vi.fn()}
          onShowTargetBadgeToggle={vi.fn()}
        />
      );
    });

    // Check zoom controls
    expect(container.textContent).toContain('75%');
    expect(container.textContent).toContain('100%');
    expect(container.textContent).toContain('125%');

    // Check template pills
    expect(container.textContent).toContain('Modern');
    expect(container.textContent).toContain('Classic');
    expect(container.textContent).toContain('Minimalist');
    expect(container.textContent).toContain('Compact');

    // Check density pills
    expect(container.textContent).toContain('Tight');
    expect(container.textContent).toContain('Standard');
    expect(container.textContent).toContain('Relaxed');

    // Check 1-page budget badge
    expect(container.textContent).toContain('1-Page Budget');

    // Check embedded iframe
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('src')).toBe('blob:chrome-extension://test-id/resume.pdf');
  });

  it('triggers onTemplateChange when switching resume design templates', () => {
    const onTemplateChange = vi.fn();

    act(() => {
      root.render(
        <PdfPreviewCanvas
          blobUrl="blob:chrome-extension://test-id/resume.pdf"
          isGenerating={false}
          filename="resume.pdf"
          onDownload={vi.fn()}
          templateId="modern"
          density="standard"
          onePageFit={false}
          showTargetBadge={true}
          onTemplateChange={onTemplateChange}
          onDensityChange={vi.fn()}
          onOnePageFitToggle={vi.fn()}
          onShowTargetBadgeToggle={vi.fn()}
        />
      );
    });

    const compactBtn = Array.from(container.querySelectorAll('.template-pill')).find((b) =>
      b.textContent?.includes('Compact')
    ) as HTMLButtonElement;

    expect(compactBtn).toBeDefined();
    act(() => {
      compactBtn.click();
    });

    expect(onTemplateChange).toHaveBeenCalledWith('compact');
  });

  it('triggers onDensityChange when switching spacing density', () => {
    const onDensityChange = vi.fn();

    act(() => {
      root.render(
        <PdfPreviewCanvas
          blobUrl="blob:chrome-extension://test-id/resume.pdf"
          isGenerating={false}
          filename="resume.pdf"
          onDownload={vi.fn()}
          templateId="classic"
          density="standard"
          onePageFit={true}
          showTargetBadge={true}
          onTemplateChange={vi.fn()}
          onDensityChange={onDensityChange}
          onOnePageFitToggle={vi.fn()}
          onShowTargetBadgeToggle={vi.fn()}
        />
      );
    });

    const tightBtn = Array.from(container.querySelectorAll('.density-pill')).find((b) =>
      b.textContent?.includes('Tight')
    ) as HTMLButtonElement;

    expect(tightBtn).toBeDefined();
    act(() => {
      tightBtn.click();
    });

    expect(onDensityChange).toHaveBeenCalledWith('tight');
  });

  it('triggers onOnePageFitToggle and onShowTargetBadgeToggle on checkbox change', () => {
    const onOnePageFitToggle = vi.fn();
    const onShowTargetBadgeToggle = vi.fn();

    act(() => {
      root.render(
        <PdfPreviewCanvas
          blobUrl="blob:chrome-extension://test-id/resume.pdf"
          isGenerating={false}
          filename="resume.pdf"
          onDownload={vi.fn()}
          templateId="modern"
          density="standard"
          onePageFit={false}
          showTargetBadge={true}
          onTemplateChange={vi.fn()}
          onDensityChange={vi.fn()}
          onOnePageFitToggle={onOnePageFitToggle}
          onShowTargetBadgeToggle={onShowTargetBadgeToggle}
        />
      );
    });

    const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
    expect(checkboxes.length).toBe(2);

    act(() => {
      checkboxes[0]!.click();
    });
    expect(onOnePageFitToggle).toHaveBeenCalledWith(true);

    act(() => {
      checkboxes[1]!.click();
    });
    expect(onShowTargetBadgeToggle).toHaveBeenCalledWith(false);
  });

  it('triggers onDownload when clicking the download button', () => {
    const onDownload = vi.fn();

    act(() => {
      root.render(
        <PdfPreviewCanvas
          blobUrl="blob:chrome-extension://test-id/resume.pdf"
          isGenerating={false}
          filename="resume-final.pdf"
          onDownload={onDownload}
          templateId="modern"
          density="standard"
          onePageFit={true}
          showTargetBadge={true}
          onTemplateChange={vi.fn()}
          onDensityChange={vi.fn()}
          onOnePageFitToggle={vi.fn()}
          onShowTargetBadgeToggle={vi.fn()}
        />
      );
    });

    const downloadBtn = container.querySelector('.btn-canvas-download') as HTMLButtonElement;
    expect(downloadBtn).not.toBeNull();
    act(() => {
      downloadBtn.click();
    });

    expect(onDownload).toHaveBeenCalled();
  });

  it('displays loading overlay while generating PDF blob', () => {
    act(() => {
      root.render(
        <PdfPreviewCanvas
          blobUrl={null}
          isGenerating={true}
          filename="resume.pdf"
          onDownload={vi.fn()}
          templateId="modern"
          density="standard"
          onePageFit={true}
          showTargetBadge={true}
          onTemplateChange={vi.fn()}
          onDensityChange={vi.fn()}
          onOnePageFitToggle={vi.fn()}
          onShowTargetBadgeToggle={vi.fn()}
        />
      );
    });

    expect(container.querySelector('.pdf-generating-overlay')).not.toBeNull();
    expect(container.textContent).toContain('Rendering vector PDF');
  });
});
