/**
 * @fileoverview In-Page Floating Assistant Hub & Active Field Pills.
 *
 * Implements Simplify-style in-page ergonomics through an isolated Shadow DOM root:
 * 1. Isolated Shadow DOM: Zero style pollution between host ATS page and ApplyKit UI.
 * 2. Active Field Focus Pill: Floating [Fill Value] or [Draft Answer] control placed next to
 *    the focused input.
 * 3. Bottom-Right Floating Hub: Discreet [ApplyKit · X Fields Detected] badge with one-click
 *    execution.
 * 4. Submission Hard Gate: Strictly forbidden from triggering form submissions.
 * 5. Isolated Context: All LLM requests execute in the background service worker.
 */

import type { CandidateProfile } from '@applykit/domain';
import { simulateTextInput } from './action-interpreter.js';
import { escapeXmlEntities } from './extractor.js';
import { inspectPageForms } from './form-crawler.js';
import { annotatePageWidgetsOnce } from './page-widget-bridge.js';
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
let fieldPillContainer: HTMLElement | null = null;
let floatingHubContainer: HTMLElement | null = null;
let essayPopoverContainer: HTMLElement | null = null;
let focusInListener: ((event: Event) => void) | null = null;
let focusOutListener: ((event: Event) => void) | null = null;
let focusHideTimeout: any = null;

/**
 * Encapsulated CSS stylesheet injected into the Shadow DOM root.
 * Completely immune to host page CSS resets and prevents leakage to host DOM.
 */
const HUB_STYLES = `
  :host {
    --bg: #f6f6f3; --surface: #ffffff; --surface-2: #efefeb; --border: #e2e2dc; --border-strong: #c9c9c1;
    --text: #1c1c1a; --text-2: #45453f; --muted: #74746b;
    --accent: #1f5d52; --accent-hover: #184a41; --accent-text: #1f5d52; --on-accent: #ffffff;
    --success: #2c7a4b; --success-text: #23663e; --warning: #a86a00; --warning-text: #8a5700; --danger: #b3261e; --danger-text: #9c2019;
  }
  @media (prefers-color-scheme: dark) {
    :host {
      --bg: #151514; --surface: #1d1d1b; --surface-2: #262623; --border: #33332f; --border-strong: #4a4a44;
      --text: #ecece8; --text-2: #c9c9c2; --muted: #9b9b92;
      --accent: #7cc4b2; --accent-hover: #93d1c1; --accent-text: #8fd0bf; --on-accent: #0f211c;
      --success: #6cc08b; --success-text: #84cf9f; --warning: #e2b65c; --warning-text: #ecc679; --danger: #ef8a7f; --danger-text: #f3a197;
    }
  }

  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    font-size: 13px;
    line-height: 1.4;
    color: var(--text);
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
    background: var(--bg);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    border-radius: 9999px;
    padding: 6px 14px 6px 10px;
    box-shadow: 0 2px 8px color-mix(in srgb, var(--text) 12%, transparent);
    backdrop-filter: none;
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

  .hub-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text);
    white-space: nowrap;
  }

  .hub-action-btn {
    appearance: none;
    background: var(--accent);
    color: var(--on-accent);
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
    background: var(--accent);
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
    color: var(--muted);
    cursor: pointer;
    font-size: 14px;
    padding: 2px 4px;
    margin-left: 2px;
    border-radius: 4px;
    transition: color 0.15s ease;
  }

  .hub-close-btn:hover {
    color: var(--text);
  }

  /* Field pill: sits in the field's top-right corner so it never covers the label above. */
  .applykit-field-pill {
    position: absolute;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    gap: 6px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    padding: 3px 8px;
    font-size: 11.5px;
    font-weight: 600;
    color: var(--accent-text);
    cursor: pointer;
    white-space: nowrap;
    max-width: 260px;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 1px 3px color-mix(in srgb, var(--text) 10%, transparent);
    animation: pillFadeIn 0.15s ease;
  }

  @keyframes pillFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .applykit-field-pill:hover {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, var(--surface));
  }

  .applykit-field-pill.filled {
    background: color-mix(in srgb, var(--success) 12%, var(--surface));
    border-color: var(--success);
    color: var(--success-text);
  }

  /* Answer writer, anchored under the question it answers. */
  .applykit-essay-popover {
    position: absolute;
    z-index: 2147483647;
    width: 420px;
    max-width: calc(100vw - 20px);
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border-strong);
    border-radius: 10px;
    box-shadow: 0 8px 24px color-mix(in srgb, var(--text) 14%, transparent);
    padding: 14px;
    animation: pillFadeIn 0.15s ease;
  }

  .essay-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 8px;
    margin-bottom: 10px;
  }

  .essay-title {
    font-size: 13px;
    font-weight: 700;
    color: var(--text);
  }

  .essay-question-text {
    font-size: 12px;
    color: var(--text-2);
    margin-top: 2px;
    max-height: 54px;
    overflow-y: auto;
    line-height: 1.4;
  }

  .essay-row {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
  }

  .essay-notes-input,
  .essay-tone-select {
    box-sizing: border-box;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    color: var(--text);
    font: inherit;
    font-size: 12px;
    padding: 6px 8px;
    outline: none;
  }

  .essay-notes-input { flex: 1; min-width: 0; }
  .essay-tone-select { flex: 0 0 auto; cursor: pointer; }

  .essay-notes-input:focus,
  .essay-tone-select:focus,
  .essay-textarea:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 20%, transparent);
  }

  .essay-status {
    font-size: 12px;
    color: var(--muted);
    margin-bottom: 8px;
    min-height: 16px;
    line-height: 1.4;
  }

  .essay-status.error { color: var(--danger-text); }
  .essay-status.good { color: var(--success-text); }
  .essay-status.warn { color: var(--warning-text); }

  .essay-textarea {
    width: 100%;
    box-sizing: border-box;
    min-height: 120px;
    max-height: 240px;
    background: var(--surface);
    border: 1px solid var(--border-strong);
    border-radius: 6px;
    color: var(--text);
    font: inherit;
    font-size: 12.5px;
    line-height: 1.5;
    padding: 8px 10px;
    resize: vertical;
    margin-bottom: 8px;
    outline: none;
  }

  .essay-textarea[aria-busy="true"] { color: var(--muted); }

  .essay-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
  }

  .essay-char-count { font-size: 11.5px; color: var(--muted); }
  .essay-char-count.over { color: var(--danger-text); font-weight: 600; }

  .essay-buttons-group { display: flex; gap: 6px; }

  .btn-generate,
  .btn-insert,
  .btn-cancel {
    border-radius: 6px;
    padding: 6px 12px;
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  .btn-insert {
    background: var(--accent);
    color: var(--on-accent);
    border: 1px solid var(--accent);
  }

  .btn-insert:hover:not(:disabled) { background: var(--accent-hover); }

  .btn-generate,
  .btn-cancel {
    background: var(--surface);
    color: var(--text);
    border: 1px solid var(--border-strong);
  }

  .btn-generate:hover:not(:disabled),
  .btn-cancel:hover { background: var(--surface-2); }

  .btn-generate:disabled,
  .btn-insert:disabled { opacity: 0.55; cursor: not-allowed; }
`;

/** A question's text without the required-field marks pages add ("*", "(required)"). */
function cleanQuestionLabel(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/\s*\*+\s*$/, '')
    .replace(/\s*\((?:required|optional)\)\s*$/i, '')
    .trim();
}

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

  // The label as the page writes it. It used to be lowercased before being sent as the
  // question, so "What attracted you to Northwind?" reached the drafter as
  // "what attracted you to northwind?*" and the company in it was missed.
  let rawLabel = '';
  if (el.id) {
    try {
      const labelEl = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (labelEl) rawLabel = labelEl.textContent || '';
    } catch {
      // Ignore invalid selector edge cases
    }
  }
  if (!rawLabel && el.closest('label')) {
    rawLabel = el.closest('label')?.textContent || '';
  }
  if (!rawLabel) {
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      rawLabel = labelledBy
        .split(/\s+/)
        .map((id) => el.ownerDocument.getElementById(id)?.textContent || '')
        .join(' ');
    }
  }
  rawLabel = cleanQuestionLabel(rawLabel);
  const parentLabel = rawLabel.toLowerCase();

  const combined = `${nameAttr} ${idAttr} ${placeholderAttr} ${ariaLabel} ${parentLabel}`.trim();

  // Long textareas or essay question prompts
  if (tagName === 'textarea' || el.getAttribute('role') === 'textbox' || el.getAttribute('contenteditable') === 'true') {
    const isShortInput = combined.includes('address') || combined.includes('location');
    if (!isShortInput) {
      return {
        type: 'essay',
        label: rawLabel || cleanQuestionLabel(el.getAttribute('aria-label') || el.getAttribute('placeholder') || '') || 'Application question',
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

  // Inside the field's top-right corner. Placing it above the field covered the label of
  // the question (and on dense forms, the field before it).
  fieldPillContainer.style.display = 'flex';
  fieldPillContainer.style.visibility = 'hidden';
  fieldPillContainer.style.top = '0px';
  fieldPillContainer.style.left = '0px';
  fieldPillContainer.classList.remove('filled');

  if (info.type === 'standard' && info.suggestedValue) {
    setFieldPillContent(fieldPillContainer, 'Fill ', info.label, info.suggestedValue);
    fieldPillContainer.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      applyTextToElement(target, info.suggestedValue!);
      fieldPillContainer!.classList.add('filled');
      setFieldPillContent(fieldPillContainer!, 'Filled ', info.label);
      setTimeout(() => {
        if (fieldPillContainer) fieldPillContainer.style.display = 'none';
      }, 1500);
    };
  } else if (info.type === 'essay') {
    setFieldPillContent(fieldPillContainer, 'Draft with ApplyKit');
    fieldPillContainer.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      openEssayAssistantPopover(target, info.label, doc);
    };
  } else if (info.type === 'file_resume') {
    setFieldPillContent(fieldPillContainer, 'Attach tailored resume PDF');
    fieldPillContainer.onclick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      target.style.outline = '2px dashed #1f5d52';
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: 'OPEN_SIDEPANEL_TAB', tab: 'tailor_resume' }, () => {});
      }

      fieldPillContainer!.classList.add('filled');
      setFieldPillContent(fieldPillContainer!, 'Opened your resume');
      setTimeout(() => {
        if (fieldPillContainer) fieldPillContainer.style.display = 'none';
        target.style.outline = '';
        target.style.outlineOffset = '';
      }, 2500);
    };
  }

  // Measure after the text is set, then pin to the field's top-right corner.
  const pillWidth = fieldPillContainer.offsetWidth || 160;
  const pillHeight = fieldPillContainer.offsetHeight || 22;
  const inset = rect.height >= pillHeight + 8 ? 4 : 0;
  const top = rect.height >= pillHeight + 8 ? rect.top + scrollTop + inset : rect.top + scrollTop - pillHeight - 2;
  const left = Math.max(rect.left + scrollLeft, rect.right + scrollLeft - pillWidth - inset);
  fieldPillContainer.style.top = `${Math.max(4, top)}px`;
  fieldPillContainer.style.left = `${Math.max(4, left)}px`;
  fieldPillContainer.style.visibility = 'visible';
}

/**
 * Renders field-pill labels as text nodes so imported profile and page metadata
 * cannot become executable markup inside the isolated UI.
 */
function setFieldPillContent(container: HTMLElement, prefix: string, label = '', value?: string): void {
  container.replaceChildren();
  const text = container.ownerDocument.createElement('span');
  text.append(container.ownerDocument.createTextNode(prefix), container.ownerDocument.createTextNode(label));
  if (value !== undefined) {
    text.append(container.ownerDocument.createTextNode(': '));
    const strong = container.ownerDocument.createElement('strong');
    strong.textContent = value;
    text.append(strong);
  }
  container.append(text);
}

/** The page's own character limit for a field, when it sets one. */
function fieldMaxLength(target: HTMLElement): number | undefined {
  const value = (target as HTMLInputElement | HTMLTextAreaElement).maxLength;
  return typeof value === 'number' && value > 0 && value < 100_000 ? value : undefined;
}

let essayKeyListener: ((event: KeyboardEvent) => void) | null = null;

/**
 * Opens the answer writer under an open question. It drafts from the candidate's resume
 * through the same checked drafter as the side panel, keeps to the field's character
 * limit, and only writes into the field when the candidate presses "Use this answer".
 */
function openEssayAssistantPopover(target: HTMLElement, questionLabel: string, doc: Document): void {
  if (!shadowRoot || !essayPopoverContainer) return;
  const popover = essayPopoverContainer;

  if (fieldPillContainer) fieldPillContainer.style.display = 'none';

  const maxLength = fieldMaxLength(target);
  const existingValue = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
    ? target.value
    : (target.textContent || '').trim();

  popover.setAttribute('role', 'dialog');
  popover.setAttribute('aria-label', 'Draft an answer');
  popover.innerHTML = `
    <div class="essay-header">
      <div>
        <div class="essay-title">Draft an answer</div>
        <div class="essay-question-text">${escapeXmlEntities(questionLabel)}</div>
      </div>
      <button type="button" class="hub-close-btn" id="btn-popover-close" aria-label="Close">×</button>
    </div>
    <div class="essay-row">
      <input type="text" class="essay-notes-input" id="essay-user-notes" aria-label="Anything to mention (optional)" placeholder="Anything to mention? (optional)" />
      <select class="essay-tone-select" id="essay-tone-select" aria-label="Style">
        <option value="plain">Plain</option>
        <option value="concise">Shorter</option>
        <option value="star">A story (STAR)</option>
        <option value="bullets">Bullet points</option>
      </select>
    </div>
    <div class="essay-status" id="essay-status-msg" role="status">${existingValue ? 'This is what the field has now. Edit it here, or write a new draft.' : ''}</div>
    <textarea class="essay-textarea" id="essay-draft-box" aria-label="Your answer" placeholder="Your answer will appear here.">${escapeXmlEntities(existingValue)}</textarea>
    <div class="essay-actions">
      <span class="essay-char-count" id="essay-char-count"></span>
      <div class="essay-buttons-group">
        <button type="button" class="btn-generate" id="btn-popover-generate">${existingValue ? 'Write a draft' : 'Write again'}</button>
        <button type="button" class="btn-insert" id="btn-popover-insert" disabled>Use this answer</button>
      </div>
    </div>
  `;

  // Under the field, kept inside the viewport horizontally; above it when there is no room below.
  popover.style.display = 'block';
  popover.style.visibility = 'hidden';
  const rect = target.getBoundingClientRect();
  const scrollTop = window.scrollY || doc.documentElement.scrollTop || 0;
  const scrollLeft = window.scrollX || doc.documentElement.scrollLeft || 0;
  const width = popover.offsetWidth || 420;
  const height = popover.offsetHeight || 320;
  const viewportWidth = doc.documentElement.clientWidth || window.innerWidth;
  const left = Math.min(Math.max(10, rect.left), Math.max(10, viewportWidth - width - 10)) + scrollLeft;
  const roomBelow = window.innerHeight - rect.bottom;
  const top = roomBelow < height + 16 && rect.top > height + 16 ? rect.top + scrollTop - height - 8 : rect.bottom + scrollTop + 8;
  popover.style.left = `${left}px`;
  popover.style.top = `${top}px`;
  popover.style.visibility = 'visible';

  const draftBox = popover.querySelector<HTMLTextAreaElement>('#essay-draft-box');
  const userNotesInput = popover.querySelector<HTMLInputElement>('#essay-user-notes');
  const toneSelect = popover.querySelector<HTMLSelectElement>('#essay-tone-select');
  const generateBtn = popover.querySelector<HTMLButtonElement>('#btn-popover-generate');
  const statusMsg = popover.querySelector<HTMLDivElement>('#essay-status-msg');
  const charCount = popover.querySelector<HTMLSpanElement>('#essay-char-count');
  const insertBtn = popover.querySelector<HTMLButtonElement>('#btn-popover-insert');
  const closeBtn = popover.querySelector<HTMLButtonElement>('#btn-popover-close');

  const setStatus = (text: string, tone: '' | 'error' | 'good' | 'warn' = '') => {
    if (!statusMsg) return;
    statusMsg.className = `essay-status${tone ? ` ${tone}` : ''}`;
    statusMsg.textContent = text;
  };

  const updateCharCount = () => {
    if (!draftBox || !charCount) return;
    const length = draftBox.value.length;
    const over = maxLength !== undefined && length > maxLength;
    charCount.textContent = maxLength !== undefined ? `${length} / ${maxLength} characters` : `${length} characters`;
    charCount.classList.toggle('over', over);
    if (insertBtn) insertBtn.disabled = draftBox.value.trim().length === 0 || over;
  };
  updateCharCount();
  draftBox?.addEventListener('input', updateCharCount);

  const closePopover = () => {
    popover.style.display = 'none';
    if (essayKeyListener) doc.removeEventListener('keydown', essayKeyListener, true);
    essayKeyListener = null;
    target.focus({ preventScroll: true });
  };

  if (essayKeyListener) doc.removeEventListener('keydown', essayKeyListener, true);
  essayKeyListener = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && popover.style.display !== 'none') {
      event.stopPropagation();
      closePopover();
    }
  };
  doc.addEventListener('keydown', essayKeyListener, true);

  closeBtn?.addEventListener('click', closePopover);

  insertBtn?.addEventListener('click', () => {
    if (draftBox && draftBox.value.trim()) {
      applyTextToElement(target, draftBox.value.trim());
      closePopover();
    }
  });

  const runGeneration = () => {
    if (!generateBtn || !draftBox) return;
    generateBtn.disabled = true;
    if (insertBtn) insertBtn.disabled = true;
    generateBtn.textContent = 'Writing...';
    draftBox.setAttribute('aria-busy', 'true');
    setStatus('Writing from your resume. This takes a few seconds.');

    const notes = userNotesInput?.value.trim() || undefined;
    const tone = (toneSelect?.value as 'plain' | 'concise' | 'star' | 'bullets') || 'plain';

    const finish = () => {
      generateBtn.disabled = false;
      generateBtn.textContent = 'Write again';
      draftBox.removeAttribute('aria-busy');
      updateCharCount();
    };

    // The drafter may ask the model twice (draft, then a corrected draft), so allow for both.
    const safetyTimeout = setTimeout(() => {
      if (generateBtn.disabled) {
        finish();
        setStatus('That took too long. Check your connection, or the AI key in Settings.', 'error');
      }
    }, 120000);

    if (typeof chrome === 'undefined' || !chrome.runtime?.sendMessage) {
      clearTimeout(safetyTimeout);
      finish();
      return;
    }

    chrome.runtime.sendMessage(
      {
        type: 'ANSWER_AD_HOC_QUESTION',
        question: questionLabel,
        tone,
        userNotes: notes,
        ...(maxLength !== undefined ? { maxLength } : {}),
      },
      (res: AnswerAdHocQuestionResponse) => {
        clearTimeout(safetyTimeout);
        if (chrome.runtime.lastError) {
          finish();
          setStatus('ApplyKit was reloaded. Refresh this page and try again.', 'error');
          return;
        }
        if (res && res.success && res.answerText) {
          draftBox.value = res.answerText;
          finish();
          setStatus(res.notes || 'Drafted from your resume. Read it, edit anything, then use it.', 'good');
          draftBox.focus();
        } else if (res?.draftText) {
          // Not every line passed the check: show the draft and say what to look at.
          draftBox.value = res.draftText;
          finish();
          const problems = (res.problems ?? []).slice(0, 3).join(' ');
          setStatus(`Check this before using it. ${problems}`.trim(), 'warn');
          draftBox.focus();
        } else {
          finish();
          setStatus(res?.error || 'Could not draft an answer. Check your profile, or the AI key in Settings.', 'error');
        }
      }
    );
  };

  generateBtn?.addEventListener('click', runGeneration);

  // An empty field means the candidate clicked "Draft" to get one, so start right away.
  if (!existingValue) {
    runGeneration();
  } else {
    draftBox?.focus();
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
    <span class="hub-label">ApplyKit</span>
    <button type="button" class="hub-action-btn" id="btn-hub-autofill">Fill this form</button>
    <button type="button" class="hub-close-btn" id="btn-hub-dismiss" title="Dismiss">×</button>
  `;
  shadowRoot.appendChild(floatingHubContainer);

  const autofillBtn = floatingHubContainer.querySelector<HTMLButtonElement>('#btn-hub-autofill');
  const dismissBtn = floatingHubContainer.querySelector<HTMLButtonElement>('#btn-hub-dismiss');

  autofillBtn?.addEventListener('click', async () => {
    if (!autofillBtn) return;
    autofillBtn.disabled = true;
    autofillBtn.textContent = 'Filling...';

    const resetBtn = (text: string) => {
      autofillBtn.textContent = text;
      setTimeout(() => {
        autofillBtn.disabled = false;
        autofillBtn.textContent = 'Fill this form';
      }, 3000);
    };

    // Safety timeout: Never leave the button stuck on 'Filling...'
    const safetyTimer = setTimeout(() => {
      if (autofillBtn.disabled && autofillBtn.textContent === 'Filling...') {
        resetBtn('Open ApplyKit');
      }
    }, 150000); // Drafting open questions with AI can take a while per question.

    try {
      // Tag React dropdowns with their options first, as the side panel scan does.
      await annotatePageWidgetsOnce();
      const forms = inspectPageForms(doc);
      const activeForm = forms[0];

      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage(
          {
            type: 'EXECUTE_ONE_CLICK_AUTO_FILL',
            form: activeForm,
            options: {
              pacingDelayMs: 60,
              highlightElements: true,
            },
          },
          (res: ExecuteOneClickAutoFillResponse) => {
            clearTimeout(safetyTimer);
            if (chrome.runtime.lastError) {
              resetBtn('Retry');
              return;
            }
            if (res && res.success) {
              resetBtn(`Filled ${res.report?.executedCount ?? 0}. Now check it`);
            } else {
              resetBtn('Open ApplyKit');
            }
          }
        );
      } else {
        clearTimeout(safetyTimer);
        resetBtn('Unavailable');
      }
    } catch {
      clearTimeout(safetyTimer);
      resetBtn('Open ApplyKit');
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
  focusInListener = async (e: Event) => {
    const target = e.target as HTMLElement | null;
    if (!target) return;

    if (focusHideTimeout) clearTimeout(focusHideTimeout);

    const profile = await fetchCandidateProfile();
    const info = inspectTargetField(target, profile);

    if (info) {
      positionFieldPill(target, info, doc);
    } else {
      if (fieldPillContainer) fieldPillContainer.style.display = 'none';
    }
  };
  doc.addEventListener('focusin', focusInListener);

  focusOutListener = () => {
    focusHideTimeout = setTimeout(() => {
      if (fieldPillContainer) {
        fieldPillContainer.style.display = 'none';
      }
    }, 300);
  };
  doc.addEventListener('focusout', focusOutListener);
}

/**
 * Completely unmounts the In-Page Hub and tears down the Shadow DOM container.
 *
 * @param doc Target document.
 */
export function unmountInPageHub(doc: Document = document): void {
  if (focusInListener) doc.removeEventListener('focusin', focusInListener);
  if (focusOutListener) doc.removeEventListener('focusout', focusOutListener);
  focusInListener = null;
  focusOutListener = null;
  if (essayKeyListener) doc.removeEventListener('keydown', essayKeyListener, true);
  essayKeyListener = null;
  const existingHost = doc.getElementById(IN_PAGE_HUB_HOST_ID);
  if (existingHost) {
    existingHost.remove();
  }
  hostElement = null;
  shadowRoot = null;
  fieldPillContainer = null;
  floatingHubContainer = null;
  essayPopoverContainer = null;
}
