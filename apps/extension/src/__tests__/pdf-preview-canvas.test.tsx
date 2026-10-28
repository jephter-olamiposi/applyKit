/**
 * @fileoverview Test suite for Live Vector PDF Preview Canvas component (ADR-0031).
 *
 * Verifies the layout choices (style, spacing, one page, job title), the busy state,
 * and the download buttons.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PdfPreviewCanvas } from '../sidepanel/components/PdfPreviewCanvas.js';

/** Picks an option in a React-controlled select the way a person would. */
function choose(select: HTMLSelectElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

/** Finds the select whose label reads `label`. */
function selectLabelled(container: HTMLElement, label: string): HTMLSelectElement {
  const host = Array.from(container.querySelectorAll('label')).find((el) => el.textContent?.startsWith(label));
  const select = host?.querySelector('select');
  if (!select) throw new Error(`No select labelled ${label}`);
  return select;
}

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

  it('shows the style, spacing, and download controls', () => {
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

    for (const label of ['Modern', 'Classic', 'Minimalist', 'Compact', 'Tight', 'Standard', 'Relaxed']) {
      expect(container.textContent).toContain(label);
    }
    expect(container.textContent).toContain('Fit on one page');
    expect(container.textContent).toContain('Download PDF');
    expect(container.querySelector('[aria-label="Resume preview"]')).not.toBeNull();
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

    act(() => {
      choose(selectLabelled(container, 'Style'), 'compact');
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

    act(() => {
      choose(selectLabelled(container, 'Spacing'), 'tight');
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
    expect(container.textContent).toContain('Updating the preview');
  });
});
