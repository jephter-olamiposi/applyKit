/**
 * @fileoverview Unit and DOM interaction tests for In-Page Inspector & Visual Review Overlay (Phase 10).
 *
 * Verifies:
 * 1. Synchronized element attention highlights and smooth scroll dispatch.
 * 2. Floating attention callout positioning and DOM cleanup.
 * 3. In-page review badge injection beside planned inputs.
 * 4. 100% non-invasive teardown with zero residual styles or markers.
 *
 * @vitest-environment happy-dom
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  highlightTargetElement,
  clearTargetHighlight,
  renderInPageReviewBadges,
  removeInPageReviewBadges,
} from '../content/in-page-inspector.js';
import type { DryRunPlan, PlanId, ActionId } from '@applykit/domain';

describe('In-Page Form Field Inspector & Visual Review Overlay (Phase 10)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.innerHTML = '';
    clearTargetHighlight(document);
  });

  describe('highlightTargetElement', () => {
    it('returns false when target element cannot be found', () => {
      const result = highlightTargetElement(document, '#non-existent-input');
      expect(result).toBe(false);
    });

    it('applies attention styling and scrolls element into view', () => {
      const input = document.createElement('input');
      input.id = 'first-name';
      input.style.outline = 'none';
      input.scrollIntoView = vi.fn();
      document.body.appendChild(input);

      const result = highlightTargetElement(document, '#first-name');
      expect(result).toBe(true);

      // Verify attention highlight styles
      expect(input.style.outline).toContain('3px');
      expect(input.style.outline).toContain('solid');
      expect(input.style.outlineOffset).toBe('3px');
      expect(input.scrollIntoView).toHaveBeenCalledWith({
        behavior: 'smooth',
        block: 'center',
      });
    });

    it('mounts floating attention callout when label is provided', () => {
      const input = document.createElement('input');
      input.id = 'email-field';
      input.getBoundingClientRect = vi.fn().mockReturnValue({
        top: 100,
        left: 50,
        width: 200,
        height: 30,
      });
      document.body.appendChild(input);

      highlightTargetElement(document, '#email-field', 'Candidate Email');

      const callout = document.querySelector('.applykit-focus-callout');
      expect(callout).not.toBeNull();
      expect(callout?.textContent).toBe('ApplyKit: Candidate Email');
    });

    it('clears previous highlight before highlighting a new target', () => {
      const inputA = document.createElement('input');
      inputA.id = 'field-a';
      inputA.style.outline = '1px dotted black';
      const initialOutlineA = inputA.style.outline;
      document.body.appendChild(inputA);

      const inputB = document.createElement('input');
      inputB.id = 'field-b';
      document.body.appendChild(inputB);

      highlightTargetElement(document, '#field-a', 'Field A');
      expect(inputA.style.outline).toContain('3px');

      highlightTargetElement(document, '#field-b', 'Field B');
      // inputA should be restored to its original outline
      expect(inputA.style.outline).toBe(initialOutlineA);
      expect(inputB.style.outline).toContain('3px');
    });
  });

  describe('clearTargetHighlight', () => {
    it('restores original element styles and cleans up callouts', () => {
      const input = document.createElement('input');
      input.id = 'phone-field';
      input.style.outline = '2px dashed red';
      input.style.outlineOffset = '1px';
      input.style.boxShadow = 'none';
      const initialOutline = input.style.outline;
      input.getBoundingClientRect = vi.fn().mockReturnValue({ top: 10, left: 10 });
      document.body.appendChild(input);

      highlightTargetElement(document, '#phone-field', 'Phone');
      expect(document.querySelector('.applykit-focus-callout')).not.toBeNull();

      clearTargetHighlight(document);

      // Verify original styles are restored
      expect(input.style.outline).toBe(initialOutline);
      expect(input.style.outlineOffset).toBe('1px');
      expect(input.style.boxShadow).toBe('none');

      // Callout element must be completely removed
      expect(document.querySelector('.applykit-focus-callout')).toBeNull();
    });

    it('cleans up any orphaned callout nodes', () => {
      const orphan = document.createElement('div');
      orphan.className = 'applykit-focus-callout';
      orphan.textContent = 'Orphaned';
      document.body.appendChild(orphan);

      clearTargetHighlight(document);
      expect(document.querySelector('.applykit-focus-callout')).toBeNull();
    });
  });

  describe('renderInPageReviewBadges and removeInPageReviewBadges', () => {
    const mockPlan: DryRunPlan = {
      id: 'plan-1' as PlanId,
      formId: 'form-1',
      formUrl: 'https://example.com/apply',
      detectedAts: 'greenhouse',
      actions: [
        {
          id: 'action-1' as ActionId,
          action: {
            actionType: 'fill_text',
            selector: '#first_name',
            value: 'Jane',
            description: 'Fill First Name',
            requiresUserConfirmation: false,
          },
          currentValue: '',
          candidateValueUsed: 'Jane',
          confidence: 0.95,
          diffExplanation: 'Empty -> Jane',
          riskLevel: 'low',
          userConfirmed: true,
          sourceEvidenceTitle: 'Candidate Identity (Verified Profile)',
        },
        {
          id: 'action-2' as ActionId,
          action: {
            actionType: 'fill_text',
            selector: '#last_name',
            value: 'Doe',
            description: 'Fill Last Name',
            requiresUserConfirmation: false,
          },
          currentValue: '',
          candidateValueUsed: 'Doe',
          confidence: 0.95,
          diffExplanation: 'Empty -> Doe',
          riskLevel: 'low',
          userConfirmed: true,
          sourceEvidenceTitle: 'Candidate Identity (Verified Profile)',
        },
        {
          id: 'action-3' as ActionId,
          action: {
            actionType: 'fill_text',
            selector: '#missing_input',
            value: 'Value',
            description: 'Missing Input',
            requiresUserConfirmation: false,
          },
          currentValue: '',
          candidateValueUsed: 'Value',
          confidence: 0.9,
          diffExplanation: 'Empty -> Value',
          riskLevel: 'low',
          userConfirmed: true,
        },
      ],
      skippedFields: [],
      stats: {
        totalActions: 3,
        lowRiskCount: 3,
        mediumRiskCount: 0,
        highRiskCount: 0,
        requiresConfirmationCount: 0,
        unmappedRequiredCount: 0,
      },
      createdAt: new Date().toISOString(),
      isApproved: true,
    };

    it('mounts preview badges adjacent to matching input elements', () => {
      const container = document.createElement('div');
      const input1 = document.createElement('input');
      input1.id = 'first_name';
      const input2 = document.createElement('input');
      input2.id = 'last_name';

      container.appendChild(input1);
      container.appendChild(input2);
      document.body.appendChild(container);

      const count = renderInPageReviewBadges(document, mockPlan);
      // 2 elements matched out of 3 actions
      expect(count).toBe(2);

      const badges = document.querySelectorAll('.applykit-preview-badge');
      expect(badges.length).toBe(2);

      expect(badges[0]?.textContent).toContain('Jane');
      expect(badges[0]?.getAttribute('data-applykit-preview-id')).toBe('action-1');
      expect(badges[1]?.textContent).toContain('Doe');
      expect(badges[1]?.getAttribute('data-applykit-preview-id')).toBe('action-2');

      // Verify style tag was injected into head
      expect(document.getElementById('applykit-inpage-styles')).not.toBeNull();
    });

    it('completely removes all badges and injected styles on teardown', () => {
      const container = document.createElement('div');
      const input1 = document.createElement('input');
      input1.id = 'first_name';
      container.appendChild(input1);
      document.body.appendChild(container);

      renderInPageReviewBadges(document, mockPlan);
      expect(document.querySelectorAll('.applykit-preview-badge').length).toBe(1);
      expect(document.getElementById('applykit-inpage-styles')).not.toBeNull();

      removeInPageReviewBadges(document);
      // Badges and style tags must be completely eliminated
      expect(document.querySelectorAll('.applykit-preview-badge').length).toBe(0);
      expect(document.getElementById('applykit-inpage-styles')).toBeNull();
    });
  });
});
