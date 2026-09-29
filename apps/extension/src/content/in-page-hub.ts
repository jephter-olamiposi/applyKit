/**
 * @fileoverview In-Page Floating Assistant Hub & Active Field Pills (Phase 17).
 *
 * Implements Simplify-style in-page ergonomics through an isolated Shadow DOM root:
 * 1. Isolated Shadow DOM: Zero style pollution between host ATS page and ApplyKit UI.
 * 2. Active Field Focus Pill: Floating [⚡ Fill Value] or [💡 Draft Answer] directly adjacent to inputs.
 * 3. Bottom-Right Floating Hub: Discreet [⚡ ApplyKit · X Fields Detected] badge with 1-click execution.
 * 4. Submission Hard Gate: Strictly forbidden from triggering form submissions.
 * 5. Isolated Context: All LLM requests execute in the background service worker.
 */

import type { CandidateProfile } from '@applykit/domain';
import { simulateTextInput } from './action-interpreter.js';
import type {
  GetCandidateProfileResponse,
  ExecuteOneClickAutoFillResponse,
  AnswerAdHocQuestionResponse,
} from '../messages/contracts.js';

export const IN_PAGE_HUB_HOST_ID = 'applykit-inpage-hub-host';

interface CachedFieldInfo {
  type: 'standard' | 'essay' | 'file_resume';
  label: string;
  suggestedValue?: string;
}

let activeProfileCache: CandidateProfile | null = null;
let hostElement: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let activeTargetElement: HTMLElement | null = null;
let fieldPillContainer: HTMLElement | null = null;
let floatingHubContainer: HTMLElement | null = null;
let essayPopoverContainer: HTMLElement | null = null;
let focusHideTimeout: any = null;

/**
 * Encapsulated CSS stylesheet injected into the Shadow DOM root.
 * Completely immune to host page CSS resets and prevents leakage to host DOM.
 */
const HUB_STYLES = `
  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.4;
    color: #f8fafc;
    box-sizing: border-box;
  }

  *, *::before, *::after {
    box-sizing: border-box;
  }

  /* Floating Bottom-Right Action Hub */
  .applykit-floating-hub {
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 2147483646;
    display: flex;
    align-items: center;
    gap: 8px;
    background: #0f172a;
    border: 1px solid rgba(59, 130, 246, 0.5);
    border-radius: 9999px;
    padding: 6px 14px 6px 10px;
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
    backdrop-filter: blur(12px);
    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    animation: hubSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes hubSlideUp {
    from {
      opacity: 0;
      transform: translateY(16px) scale(0.96);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .hub-badge-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    background: linear-gradient(135deg, #2563eb, #3b82f6);
    border-radius: 50%;
    color: #ffffff;
    font-size: 13px;
    font-weight: bold;
    flex-shrink: 0;
  }

  .hub-label {
    font-size: 12px;
    font-weight: 600;
    color: #f1f5f9;
    white-space: nowrap;
  }

  .hub-action-btn {
    appearance: none;
    background: #2563eb;
    color: #ffffff;
    border: none;
    border-radius: 9999px;
    padding: 4px 12px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, transform 0.1s ease;
    white-space: nowrap;
  }

  .hub-action-btn:hover {
    background: #1d4ed8;
    transform: scale(1.02);
  }

  .hub-action-btn:active {
    transform: scale(0.98);
  }

  .hub-action-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .hub-close-btn {
    appearance: none;
    background: transparent;
    border: none;
    color: #94a3b8;
    cursor: pointer;
    font-size: 14px;
    padding: 2px 4px;
    margin-left: 2px;
    border-radius: 4px;
    transition: color 0.15s ease;
  }

  .hub-close-btn:hover {
    color: #f8fafc;
  }

  /* Active Field Focus Pill */
  .applykit-field-pill {
    position: absolute;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 6px;
    background: #1e293b;
    border: 1px solid #3b82f6;
    border-radius: 6px;
    padding: 4px 10px;
    box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
    font-size: 11px;
    font-weight: 600;
    color: #f8fafc;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s ease;
    animation: pillFadeIn 0.2s ease;
  }

  @keyframes pillFadeIn {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .applykit-field-pill:hover {
    background: #2563eb;
    border-color: #60a5fa;
    transform: translateY(-1px);
  }

  .applykit-field-pill.filled {
    background: #065f46;
    border-color: #10b981;
    color: #a7f3d0;
  }

  /* Essay Assistant Anchored Popover */
  .applykit-essay-popover {
    position: absolute;
    z-index: 2147483647;
    width: 380px;
    max-width: 90vw;
    background: #0f172a;
    border: 1px solid #3b82f6;
    border-radius: 10px;
    box-shadow: 0 14px 35px rgba(0, 0, 0, 0.5);
    padding: 14px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    animation: popoverFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes popoverFadeIn {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .essay-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 8px;
    border-bottom: 1px solid #334155;
    padding-bottom: 6px;
  }

  .essay-title {
    font-size: 12px;
    font-weight: 700;
    color: #38bdf8;
  }

  .essay-question-text {
    font-size: 11px;
    color: #94a3b8;
    margin-bottom: 10px;
    font-style: italic;
    max-height: 48px;
    overflow-y: auto;
  }

  .essay-textarea {
    width: 100%;
    min-height: 100px;
    max-height: 200px;
    background: #1e293b;
    border: 1px solid #475569;
    border-radius: 6px;
    color: #f8fafc;
    font-size: 12px;
    line-height: 1.45;
    padding: 8px;
    resize: vertical;
    font-family: inherit;
    margin-bottom: 10px;
  }

  .essay-textarea:focus {
    outline: none;
    border-color: #38bdf8;
  }

  .essay-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .btn-insert {
    background: #10b981;
    color: #ffffff;
    border: none;
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .btn-insert:hover {
    background: #059669;
  }

  .btn-cancel {
    background: transparent;
    color: #94a3b8;
    border: 1px solid #475569;
    border-radius: 6px;
    padding: 6px 10px;
    font-size: 11px;
    cursor: pointer;
  }

  .btn-cancel:hover {
    color: #f8fafc;
    background: #1e293b;
  }
`;

/**
 * Safely inserts simulated text input into either a standard input/textarea or a rich text element.
 */
function applyTextToElement(element: HTMLElement, text: string): void {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    simulateTextInput(element, text);
  } else {
    element.focus();
    element.textContent = text;
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }
}

/**
 * Retrieves the candidate profile from background service worker cache.
 */
async function fetchCandidateProfile(): Promise<CandidateProfile | null> {
  if (activeProfileCache) return activeProfileCache;

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    try {
      const res = await new Promise<GetCandidateProfileResponse>((resolve) => {
        chrome.runtime.sendMessage({ type: 'GET_CANDIDATE_PROFILE' }, (r) => {
          resolve(r as GetCandidateProfileResponse);
        });
      });
      if (res && res.profile) {
        activeProfileCache = res.profile;
        return activeProfileCache;
      }
    } catch {
      // In isolated test runner or offline, return null
    }
  }

  return null;
}

/**
 * Classifies an active form field to determine its semantic role and matching candidate value.
 */
function inspectTargetField(el: HTMLElement, profile: CandidateProfile | null): CachedFieldInfo | null {
  const tagName = el.tagName.toLowerCase();
  const inputType = el instanceof HTMLInputElement ? (el.type || 'text').toLowerCase() : '';

  // Skip buttons, submits, passwords, and hidden inputs (Submission Hard Gate)
  if (inputType === 'submit' || inputType === 'button' || inputType === 'hidden' || inputType === 'password') {
    return null;
  }

  // Resume or CV file upload inputs
  if (inputType === 'file') {
    return {
      type: 'file_resume',
      label: 'Resume / CV File',
    };
  }

  // Derive field identifier cues from attributes and accessible labels
  const nameAttr = (el.getAttribute('name') || '').toLowerCase();
  const idAttr = (el.getAttribute('id') || '').toLowerCase();
  const placeholderAttr = (el.getAttribute('placeholder') || '').toLowerCase();
  const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();

  let parentLabel = '';
  if (el.id) {
    try {
      const labelEl = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (labelEl) parentLabel = (labelEl.textContent || '').toLowerCase();
    } catch {
      // Ignore invalid selector edge cases
    }
  }
  if (!parentLabel && el.closest('label')) {
    parentLabel = (el.closest('label')?.textContent || '').toLowerCase();
  }

  const combined = `${nameAttr} ${idAttr} ${placeholderAttr} ${ariaLabel} ${parentLabel}`.trim();

  // Long textareas or essay question prompts
  if (tagName === 'textarea' || el.getAttribute('role') === 'textbox' || el.getAttribute('contenteditable') === 'true') {
    const isShortInput = combined.includes('address') || combined.includes('location');
    if (!isShortInput) {
      return {
        type: 'essay',
        label: parentLabel || placeholderAttr || ariaLabel || nameAttr || 'Application Question',
      };
    }
  }

  if (!profile) return null;

  // Standard deterministic fields
  if (combined.includes('first') && combined.includes('name')) {
    return { type: 'standard', label: 'First Name', suggestedValue: profile.identity.legalFirstName };
  }
  if (combined.includes('last') && combined.includes('name')) {
    return { type: 'standard', label: 'Last Name', suggestedValue: profile.identity.legalLastName };
  }
  if (combined.includes('email')) {
    return { type: 'standard', label: 'Email', suggestedValue: profile.identity.email };
  }
  if (combined.includes('phone') || combined.includes('mobile') || combined.includes('tel')) {
    return { type: 'standard', label: 'Phone', suggestedValue: profile.identity.phone };
  }
  if (combined.includes('linkedin')) {
    return { type: 'standard', label: 'LinkedIn', suggestedValue: profile.links.linkedin };
  }
  if (combined.includes('github')) {
    return { type: 'standard', label: 'GitHub', suggestedValue: profile.links.github };
  }
  if (combined.includes('portfolio') || combined.includes('website')) {
    return { type: 'standard', label: 'Portfolio', suggestedValue: profile.links.portfolio };
  }
  if (combined.includes('city')) {
    return { type: 'standard', label: 'City', suggestedValue: profile.identity.location?.city };
  }
  if (combined.includes('country')) {
    return { type: 'standard', label: 'Country', suggestedValue: profile.identity.location?.country };
  }

  return null;
}

/**
 * Creates and mounts the active field pill above or beside the currently focused element.
 */
function positionFieldPill(target: HTMLElement, info: CachedFieldInfo, doc: Document): void {
  if (!shadowRoot || !fieldPillContainer) return;

  const rect = target.getBoundingClientRect();
  const scrollTop = window.scrollY || doc.documentElement.scrollTop || 0;
  const scrollLeft = window.scrollX || doc.documentElement.scrollLeft || 0;

  // Position 6px above the top-left of the target element
  const top = rect.top + scrollTop - 30;
  const left = rect.left + scrollLeft;

  fieldPillContainer.style.top = `${Math.max(10, top)}px`;
  fieldPillContainer.style.left = `${Math.max(10, left)}px`;
  fieldPillContainer.style.display = 'flex';
  fieldPillContainer.classList.remove('filled');

  if (info.type === 'standard' && info.suggestedValue) {
    fieldPillContainer.innerHTML = `<span>⚡ Fill ${info.label}: <strong>${info.suggestedValue}</strong></span>`;
    fieldPillContainer.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      applyTextToElement(target, info.suggestedValue!);
      fieldPillContainer!.classList.add('filled');
      fieldPillContainer!.innerHTML = `<span>✓ Filled ${info.label}</span>`;
      setTimeout(() => {
        if (fieldPillContainer) fieldPillContainer.style.display = 'none';
      }, 1500);
    };
  } else if (info.type === 'essay') {
    fieldPillContainer.innerHTML = `<span>💡 Draft Answer with ApplyKit</span>`;
    fieldPillContainer.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      openEssayAssistantPopover(target, info.label, doc);
    };
  } else if (info.type === 'file_resume') {
    fieldPillContainer.innerHTML = `<span>📄 Attach Tailored Resume PDF</span>`;
    fieldPillContainer.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      target.style.outline = '2px dashed #3b82f6';
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL_TAB', tab: 'tailor' }, () => {});
      }
      fieldPillContainer!.classList.add('filled');
      fieldPillContainer!.innerHTML = `<span>⚡ Opened Tailoring Studio</span>`;
      setTimeout(() => {
        if (fieldPillContainer) fieldPillContainer.style.display = 'none';
        target.style.outline = '';
        target.style.outlineOffset = '';
      }, 2500);
    };
  }
}

/**
 * Opens the in-page essay assistant popover anchored to an essay question or textarea.
 */
function openEssayAssistantPopover(target: HTMLElement, questionLabel: string, doc: Document): void {
  if (!shadowRoot || !essayPopoverContainer) return;

  if (fieldPillContainer) fieldPillContainer.style.display = 'none';

  const rect = target.getBoundingClientRect();
  const scrollTop = window.scrollY || doc.documentElement.scrollTop || 0;
  const scrollLeft = window.scrollX || doc.documentElement.scrollLeft || 0;

  essayPopoverContainer.style.top = `${rect.bottom + scrollTop + 8}px`;
  essayPopoverContainer.style.left = `${Math.max(10, rect.left + scrollLeft)}px`;
  essayPopoverContainer.style.display = 'block';

  essayPopoverContainer.innerHTML = `
    <div class="essay-header">
      <span class="essay-title">💡 ApplyKit Essay Copilot</span>
      <button type="button" class="hub-close-btn" id="btn-popover-close">✕</button>
    </div>
    <div class="essay-question-text">"${questionLabel}"</div>
    <textarea class="essay-textarea" id="essay-draft-box" placeholder="Synthesizing verified response from candidate evidence..."></textarea>
    <div class="essay-actions">
      <button type="button" class="btn-cancel" id="btn-popover-cancel">Dismiss</button>
      <button type="button" class="btn-insert" id="btn-popover-insert" disabled>Insert into Field</button>
    </div>
  `;

  const draftBox = essayPopoverContainer.querySelector<HTMLTextAreaElement>('#essay-draft-box');
  const insertBtn = essayPopoverContainer.querySelector<HTMLButtonElement>('#btn-popover-insert');
  const closeBtn = essayPopoverContainer.querySelector<HTMLButtonElement>('#btn-popover-close');
  const cancelBtn = essayPopoverContainer.querySelector<HTMLButtonElement>('#btn-popover-cancel');

  const closePopover = () => {
    if (essayPopoverContainer) essayPopoverContainer.style.display = 'none';
  };

  closeBtn?.addEventListener('click', closePopover);
  cancelBtn?.addEventListener('click', closePopover);

  insertBtn?.addEventListener('click', () => {
    if (draftBox && draftBox.value) {
      applyTextToElement(target, draftBox.value);
      closePopover();
    }
  });

  // Query background service worker for verified ad-hoc answer
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    chrome.runtime.sendMessage(
      {
        type: 'ANSWER_AD_HOC_QUESTION',
        question: questionLabel,
        tone: 'concise',
      },
      (res: AnswerAdHocQuestionResponse) => {
        if (draftBox && insertBtn) {
          if (res && res.success && res.answerText) {
            draftBox.value = res.answerText;
            insertBtn.disabled = false;
          } else {
            draftBox.value = res?.error || 'Unable to draft answer automatically. Please verify candidate profile.';
          }
        }
      }
    );
  }
}

/**
 * Initializes and mounts the In-Page Floating Hub and Field Pills on the current document.
 *
 * @param doc Target document (defaults to active window document).
 */
export function initInPageHub(doc: Document = document): void {
  // Guard against re-initialization
  if (doc.getElementById(IN_PAGE_HUB_HOST_ID)) return;

  hostElement = doc.createElement('div');
  hostElement.id = IN_PAGE_HUB_HOST_ID;
  hostElement.style.all = 'initial';

  shadowRoot = hostElement.attachShadow({ mode: 'open' });

  // Inject encapsulated styles
  const style = doc.createElement('style');
  style.textContent = HUB_STYLES;
  shadowRoot.appendChild(style);

  // Field Pill Container
  fieldPillContainer = doc.createElement('div');
  fieldPillContainer.className = 'applykit-field-pill';
  fieldPillContainer.style.display = 'none';
  shadowRoot.appendChild(fieldPillContainer);

  // Essay Popover Container
  essayPopoverContainer = doc.createElement('div');
  essayPopoverContainer.className = 'applykit-essay-popover';
  essayPopoverContainer.style.display = 'none';
  shadowRoot.appendChild(essayPopoverContainer);

  // Floating Hub Container (Bottom-Right Badge)
  floatingHubContainer = doc.createElement('div');
  floatingHubContainer.className = 'applykit-floating-hub';
  floatingHubContainer.innerHTML = `
    <span class="hub-badge-icon">⚡</span>
    <span class="hub-label">ApplyKit Ready</span>
    <button type="button" class="hub-action-btn" id="btn-hub-autofill">1-Click Auto-Fill</button>
    <button type="button" class="hub-close-btn" id="btn-hub-dismiss" title="Dismiss">✕</button>
  `;
  shadowRoot.appendChild(floatingHubContainer);

  const autofillBtn = floatingHubContainer.querySelector<HTMLButtonElement>('#btn-hub-autofill');
  const dismissBtn = floatingHubContainer.querySelector<HTMLButtonElement>('#btn-hub-dismiss');

  autofillBtn?.addEventListener('click', () => {
    if (!autofillBtn) return;
    autofillBtn.disabled = true;
    autofillBtn.textContent = 'Filling...';

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(
        { type: 'EXECUTE_ONE_CLICK_AUTO_FILL' },
        (res: ExecuteOneClickAutoFillResponse) => {
          if (res && res.success) {
            autofillBtn.textContent = `Filled ${res.report?.executedCount || 'Form'} ✓`;
            setTimeout(() => {
              autofillBtn.disabled = false;
              autofillBtn.textContent = '1-Click Auto-Fill';
            }, 3000);
          } else {
            autofillBtn.textContent = 'Check Side Panel';
            setTimeout(() => {
              autofillBtn.disabled = false;
              autofillBtn.textContent = '1-Click Auto-Fill';
            }, 3000);
          }
        }
      );
    }
  });

  dismissBtn?.addEventListener('click', () => {
    if (floatingHubContainer) {
      floatingHubContainer.style.display = 'none';
    }
  });

  doc.body.appendChild(hostElement);

  // Pre-cache candidate profile
  fetchCandidateProfile();

  // Listen to focus changes across the document
  doc.addEventListener('focusin', async (e) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (focusHideTimeout) clearTimeout(focusHideTimeout);

    activeTargetElement = target;
    const profile = await fetchCandidateProfile();
    const info = inspectTargetField(target, profile);

    if (info) {
      positionFieldPill(target, info, doc);
    } else {
      if (fieldPillContainer) fieldPillContainer.style.display = 'none';
    }
  });

  doc.addEventListener('focusout', () => {
    focusHideTimeout = setTimeout(() => {
      if (fieldPillContainer) {
        fieldPillContainer.style.display = 'none';
      }
    }, 300);
  });
}

/**
 * Completely unmounts the In-Page Hub and tears down the Shadow DOM container.
 *
 * @param doc Target document.
 */
export function unmountInPageHub(doc: Document = document): void {
  const existingHost = doc.getElementById(IN_PAGE_HUB_HOST_ID);
  if (existingHost) {
    existingHost.remove();
  }
  hostElement = null;
  shadowRoot = null;
  activeTargetElement = null;
  fieldPillContainer = null;
  floatingHubContainer = null;
  essayPopoverContainer = null;
}
